"""Graph data is unreachable until actor, course, roster and scope are authorized."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.dependencies import agent_access, auth, learner_access
from backend.dependencies.auth import ActiveUser
from backend.routers import learner_memory as routes
from learner_memory import service, settings


def course():
    return {
        "id": "course-a", "_etag": "revision-1", "status": "active",
        "createdById": "teacher-a", "teacherIds": ["teacher-b"],
        "studentIds": ["student-a", "student-b"],
        "memory_scope": {"tenant_id": "tenant-a", "institute_id": "institute-a"},
        "curriculum_binding": {"curriculum_id": "curriculum-a", "curriculum_version": "1"},
        "graph_memory_mode": "authoritative",
    }


@pytest.fixture
def boundary(monkeypatch):
    fake = Mock()
    fake.read_scope_registry.return_value = {
        "tenant_id": "tenant-a", "institute_id": "institute-a",
        "administrator_ids": ["admin-a"],
    }
    fake.current_scope.side_effect = lambda scope: scope
    monkeypatch.setattr(settings, "get_memory_settings", lambda: settings.MemorySettings(enabled=True))
    monkeypatch.setattr(service, "get_service", lambda: fake)
    load_agent = Mock(return_value=course())
    monkeypatch.setattr(agent_access, "load_agent", load_agent)
    monkeypatch.setattr(agent_access, "student_assignment_ids", Mock(return_value=[]))
    monkeypatch.setattr(auth, "load_profile", Mock(side_effect=lambda uid: {
        "id": uid, "status": "active", "role": "student",
    }))
    monkeypatch.setattr(learner_access, "load_target_profile", Mock(side_effect=lambda uid: {
        "id": uid, "status": "active", "role": "student",
    }))
    return SimpleNamespace(service=fake, load_agent=load_agent)


def actor(identity, role="student"):
    return ActiveUser(id=identity, status="active", role=role)


def test_cross_student_is_denied_before_any_query(boundary):
    with pytest.raises(HTTPException) as denied:
        learner_access.resolve_learner_access("course-a", "student-b", actor("student-a"))
    assert denied.value.status_code == 403
    boundary.load_agent.assert_not_called()
    boundary.service.read_scope_registry.assert_not_called()
    boundary.service.current_scope.assert_not_called()


@pytest.mark.parametrize("user", [
    actor("teacher-outsider", "teacher"), actor("admin-outsider", "admin"),
    actor("admin-outsider", "superadmin"), actor("student-outsider"),
])
def test_roles_do_not_bypass_scope_or_roster(boundary, user):
    target = user.id if user.role == "student" else "student-a"
    with pytest.raises(HTTPException) as denied:
        learner_access.resolve_learner_access("course-a", target, user)
    assert denied.value.status_code == 403
    boundary.service.current_scope.assert_not_called()
    boundary.service.get_snapshot.assert_not_called()


@pytest.mark.parametrize("role,identity", [("student", "student-a"), ("teacher", "teacher-a"), ("admin", "admin-a")])
def test_authorized_actor_gets_complete_server_scope(boundary, role, identity):
    access = learner_access.resolve_learner_access("course-a", "student-a", actor(identity, role))
    assert access.scope.model_dump() == {
        "tenant_id": "tenant-a", "institute_id": "institute-a", "course_id": "course-a",
        "student_id": "student-a", "curriculum_id": "curriculum-a",
        "curriculum_version": "1", "learning_epoch": 1,
    }
    assert access.actor.id == identity
    assert access.mode == "authoritative"


def test_missing_institute_never_uses_display_string(boundary):
    record = course()
    record["memory_scope"] = {"tenant_id": "tenant-a"}
    record["institution"] = "Example Institute"
    boundary.load_agent.return_value = record
    with pytest.raises(HTTPException):
        learner_access.resolve_learner_access("course-a", "student-a", actor("student-a"))
    boundary.service.read_scope_registry.assert_not_called()
    boundary.service.current_scope.assert_not_called()


def test_registry_must_match_both_namespaces(boundary):
    boundary.service.read_scope_registry.return_value["institute_id"] = "institute-b"
    with pytest.raises(HTTPException) as denied:
        learner_access.resolve_learner_access("course-a", "student-a", actor("student-a"))
    assert denied.value.status_code == 403
    boundary.service.current_scope.assert_not_called()


@pytest.mark.parametrize("profile", [
    None,
    {"id": "student-a", "role": "student", "status": "disabled"},
    {"id": "student-a", "role": "teacher", "status": "active"},
    {"id": "student-b", "role": "student", "status": "active"},
])
def test_teacher_target_must_be_active_canonical_student(boundary, monkeypatch, profile):
    monkeypatch.setattr(learner_access, "load_target_profile", Mock(return_value=profile))
    with pytest.raises(HTTPException) as denied:
        learner_access.resolve_learner_access("course-a", "student-a", actor("teacher-a", "teacher"))
    assert denied.value.status_code == 403
    boundary.service.current_scope.assert_not_called()


def test_invitation_alias_resolves_only_to_current_canonical_user(boundary, monkeypatch):
    record = course()
    record["studentIds"] = ["invitation-a"]
    boundary.load_agent.return_value = record
    monkeypatch.setattr(agent_access, "student_assignment_ids", lambda uid: ["invitation-a"] if uid == "student-a" else [])
    access = learner_access.resolve_learner_access("course-a", "student-a", actor("student-a"))
    assert access.scope.student_id == "student-a"
    with pytest.raises(HTTPException):
        learner_access.resolve_learner_access("course-a", "student-b", actor("student-b"))


def test_missing_auth_rejects_before_course_or_memory_query(boundary, monkeypatch):
    monkeypatch.setattr(auth, "verify_token", lambda _token: None)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        response = client.get("/api/agents/course-a/learners/student-a/memory")
    assert response.status_code == 401
    boundary.load_agent.assert_not_called()
    assert not boundary.service.mock_calls


def test_disabled_feature_is_zero_io(monkeypatch):
    monkeypatch.setattr(settings, "get_memory_settings", lambda: settings.MemorySettings())
    load = Mock(side_effect=AssertionError("No database access while disabled"))
    monkeypatch.setattr(agent_access, "load_agent", load)
    with pytest.raises(HTTPException) as denied:
        learner_access.resolve_learner_access("course-a", "student-a", actor("student-a"))
    assert denied.value.status_code == 404
    load.assert_not_called()


def test_student_cannot_enter_teacher_depth_mode(boundary):
    with pytest.raises(HTTPException) as denied:
        routes.get_learner_context("course-a", "student-a", actor("student-a"), mode="individual")
    assert denied.value.status_code == 403
    boundary.load_agent.assert_not_called()


def test_config_requires_scoped_admin_before_course_query(boundary):
    body = routes.MemoryConfigurationUpdate(
        graph_memory_mode="off", memory_scope=course()["memory_scope"],
        curriculum_binding=course()["curriculum_binding"], revision="revision-1",
    )
    with pytest.raises(HTTPException) as denied:
        routes.update_memory_configuration("course-a", body, actor("admin-outsider", "admin"))
    assert denied.value.status_code == 403
    boundary.load_agent.assert_not_called()


def test_course_scope_cannot_be_reassigned(boundary):
    record = deepcopy(course())
    record["memory_scope"]["institute_id"] = "institute-b"
    boundary.load_agent.return_value = record
    body = routes.MemoryConfigurationUpdate(
        graph_memory_mode="off", memory_scope=course()["memory_scope"],
        curriculum_binding=course()["curriculum_binding"], revision="revision-1",
    )
    with pytest.raises(HTTPException) as denied:
        routes.update_memory_configuration("course-a", body, actor("admin-a", "admin"))
    assert denied.value.status_code == 409


def test_cohort_does_not_turn_directory_failure_into_empty_class(boundary, monkeypatch):
    monkeypatch.setattr(learner_access, "load_target_profile", Mock(side_effect=RuntimeError("directory unavailable")))
    with pytest.raises(RuntimeError, match="directory unavailable"):
        learner_access.resolve_course_roster("course-a", actor("teacher-a", "teacher"))
    boundary.service.cohort.assert_not_called()


def test_cohort_only_counts_active_explicit_roster(boundary, monkeypatch):
    def profile(identity):
        return {
            "id": identity, "role": "student",
            "status": "active" if identity == "student-a" else "disabled",
        }
    monkeypatch.setattr(learner_access, "load_target_profile", profile)
    accesses = learner_access.resolve_course_roster("course-a", actor("teacher-a", "teacher"))
    assert [access.scope.student_id for access in accesses] == ["student-a"]


def test_inactive_principal_is_denied_before_memory_query(boundary, monkeypatch):
    monkeypatch.setattr(auth, "verify_token", lambda _token: {"sub": "student-a"})
    monkeypatch.setattr(auth, "load_profile", lambda _user: {"id": "student-a", "role": "student", "status": "disabled"})
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        response = client.get(
            "/api/agents/course-a/learners/student-a/memory",
            headers={"Authorization": "Bearer synthetic"},
        )
    assert response.status_code == 403
    boundary.load_agent.assert_not_called()
    assert not boundary.service.mock_calls
