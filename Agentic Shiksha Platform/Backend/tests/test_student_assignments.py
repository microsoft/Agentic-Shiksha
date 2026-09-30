from copy import deepcopy
from unittest.mock import Mock

import pytest
from azure.core import MatchConditions
from azure.cosmos.exceptions import CosmosHttpResponseError, CosmosResourceNotFoundError
from fastapi.testclient import TestClient

from backend import main
from azure_services.persistence import cosmos_db
from backend.dependencies import agent_access, auth
from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.routers import agent_membership
from utils import course_materials


@pytest.fixture
def assignments(monkeypatch):
    agents = {
        "course-one": {
            "id": "course-one", "agentId": "course-one", "name": "Course One",
            "createdById": "teacher-1", "teacherIds": ["teacher-1"], "studentIds": ["student-1"],
            "status": "active", "_etag": "revision-1", "departmentId": "engineering",
        },
        "course-two": {
            "id": "course-two", "agentId": "course-two", "name": "Course Two",
            "createdById": "teacher-1", "teacherIds": ["teacher-1"], "studentIds": [],
            "status": "active", "_etag": "revision-1", "departmentId": "engineering",
        },
    }
    users = [
        {"id": uid, "role": "student", "status": "active", "displayName": name,
         "email": f"{uid}@example.com", "institute": "Example Institute", "department": "Engineering"}
        for uid, name in [("student-1", "Student One"), ("student-2", "Student Two")]
    ]
    invites = [{
        "id": "invite-3", "role": "student", "status": "invited", "name": "Student Three",
        "email": "student-3@example.com", "institute": "Example Institute", "department": "Engineering",
    }]
    container = Mock()

    def read_item(*, item, partition_key):
        assert item == partition_key
        if item not in agents:
            raise CosmosResourceNotFoundError(message="not found")
        return deepcopy(agents[item])

    def patch_item(*, item, partition_key, patch_operations, etag, match_condition):
        assert item == partition_key
        assert match_condition == MatchConditions.IfNotModified
        if agents[item]["_etag"] != etag:
            raise CosmosHttpResponseError(status_code=412, message="Conflict")
        assert [operation["path"] for operation in patch_operations] == ["/studentIds", "/updatedAt"]
        for operation in patch_operations:
            agents[item][operation["path"].removeprefix("/")] = deepcopy(operation["value"])
        agents[item]["_etag"] += "-next"
        return deepcopy(agents[item])

    container.read_item.side_effect = read_item
    container.patch_item.side_effect = patch_item
    monkeypatch.setattr(cosmos_db, "_get_agents_container", lambda: container)
    monkeypatch.setattr(cosmos_db, "list_student_assignment_candidates", lambda: (deepcopy(users), deepcopy(invites)))
    monkeypatch.setattr(cosmos_db, "get_student_assignment_ids", lambda uid: [uid])
    invalidate = Mock()
    monkeypatch.setattr(main, "_invalidate_agent_list_caches", invalidate)
    monkeypatch.setattr(course_materials, "load_course", lambda name: read_item(item=name, partition_key=name))
    monkeypatch.setattr(course_materials, "load_setup", lambda _name: {"sessionUuid": "example-session"})
    original_overrides = main.app.dependency_overrides.copy()
    main.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="admin-1", role="admin", status="active")
    yield TestClient(main.app), agents, users, invites, container, invalidate
    main.app.dependency_overrides.clear()
    main.app.dependency_overrides.update(original_overrides)


def sign_in(client, user_id, role="student"):
    client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id=user_id, role=role, status="active")


def test_rosters_are_independent_and_include_invited_students(assignments):
    client, _agents, _users, _invites, container, _invalidate = assignments
    first = client.get("/api/agents/course-one/students")
    second = client.get("/api/agents/course-two/students")
    assert first.status_code == second.status_code == 200
    assert first.json()["student_ids"] == ["student-1"]
    assert second.json()["student_ids"] == []
    assert first.json()["revision"] == "revision-1"
    students = {student["user_id"]: student for student in first.json()["students"]}
    assert set(students) == {"student-1", "student-2", "invite-3"}
    assert students["invite-3"]["status"] == "invited"
    container.patch_item.assert_not_called()


def test_save_replaces_roster_persistently_without_changing_other_agent_or_teachers(assignments):
    client, agents, *_unused, invalidate = assignments
    response = client.put("/api/agents/course-one/students", json={
        "student_ids": [" student-2 ", "invite-3", "student-2"], "revision": "revision-1",
    })
    assert response.status_code == 200
    assert response.json() == {
        "agent_id": "course-one", "student_ids": ["student-2", "invite-3"], "revision": "revision-1-next",
    }
    assert agents["course-one"]["teacherIds"] == ["teacher-1"]
    assert agents["course-two"]["studentIds"] == []
    assert client.get("/api/agents/course-one/students").json()["student_ids"] == ["student-2", "invite-3"]
    invalidate.assert_called_once_with(None, invalidate_teacher_scope=False)


def test_empty_roster_revokes_every_student(assignments):
    client, agents, *_unused = assignments
    assert client.put("/api/agents/course-one/students", json={
        "student_ids": [], "revision": "revision-1",
    }).status_code == 200
    assert agents["course-one"]["studentIds"] == []
    sign_in(client, "student-1")
    assert client.post("/api/agents/course-one/chat/start", json={"text": "Hello"}).status_code == 403


@pytest.mark.parametrize("student_ids", [["teacher-1"], ["unknown"], [""], [123], "student-1"])
def test_invalid_rosters_do_not_write(assignments, student_ids):
    client, _agents, _users, _invites, container, invalidate = assignments
    response = client.put("/api/agents/course-one/students", json={
        "student_ids": student_ids, "revision": "revision-1",
    })
    assert response.status_code == 422
    container.patch_item.assert_not_called()
    invalidate.assert_not_called()


def test_extra_write_fields_are_rejected(assignments):
    response = assignments[0].put("/api/agents/course-one/students", json={
        "student_ids": [], "revision": "revision-1", "teacherIds": ["student-1"],
    })
    assert response.status_code == 422
    assignments[4].patch_item.assert_not_called()


@pytest.mark.parametrize("role", ["student", "teacher"])
@pytest.mark.parametrize("method", ["get", "put"])
def test_only_admins_can_read_or_replace_student_rosters(assignments, role, method):
    client = assignments[0]
    sign_in(client, "teacher-1" if role == "teacher" else "student-1", role)
    kwargs = {"json": {"student_ids": [], "revision": "revision-1"}} if method == "put" else {}
    assert getattr(client, method)("/api/agents/course-one/students", **kwargs).status_code == 403
    assignments[4].read_item.assert_not_called()


def test_superadmin_can_assign_students(assignments):
    client = assignments[0]
    sign_in(client, "superadmin-1", "superadmin")
    assert client.put("/api/agents/course-one/students", json={
        "student_ids": ["student-2"], "revision": "revision-1",
    }).status_code == 200


def test_missing_session_and_inactive_account_are_rejected(assignments, monkeypatch):
    client = assignments[0]
    client.app.dependency_overrides.clear()
    assert client.get("/api/agents/course-one/students").status_code == 401
    monkeypatch.setattr(auth, "verify_token", lambda _token: {"sub": "admin-1"})
    monkeypatch.setattr(auth, "load_profile", lambda _uid: {"id": "admin-1", "role": "admin", "status": "disabled"})
    assert client.get("/api/agents/course-one/students", headers={"Authorization": "Bearer example"}).status_code == 403
    assignments[4].read_item.assert_not_called()


def test_missing_agent_returns_404(assignments):
    assert assignments[0].get("/api/agents/missing/students").status_code == 404


@pytest.mark.parametrize("concurrent", [False, True])
def test_stale_revision_cannot_overwrite_roster(assignments, concurrent):
    client, agents, _users, _invites, container, invalidate = assignments
    if concurrent:
        container.patch_item.side_effect = CosmosHttpResponseError(status_code=412, message="private database details")
    else:
        agents["course-one"]["_etag"] = "new-revision"
    response = client.put("/api/agents/course-one/students", json={
        "student_ids": ["student-2"], "revision": "revision-1",
    })
    assert response.status_code == 409
    assert agents["course-one"]["studentIds"] == ["student-1"]
    assert "private" not in response.text
    invalidate.assert_not_called()


def test_directory_failure_does_not_look_like_empty_roster(assignments, monkeypatch):
    monkeypatch.setattr(cosmos_db, "list_student_assignment_candidates", Mock(side_effect=RuntimeError("private details")))
    response = assignments[0].get("/api/agents/course-one/students")
    assert response.status_code == 503
    assert "private" not in response.text


def test_write_failure_is_not_success(assignments):
    assignments[4].patch_item.side_effect = RuntimeError("private details")
    response = assignments[0].put("/api/agents/course-one/students", json={
        "student_ids": ["student-2"], "revision": "revision-1",
    })
    assert response.status_code == 503
    assert "private" not in response.text
    assignments[5].assert_not_called()


def test_promoted_invitation_is_shown_once_under_active_identity(assignments):
    client, agents, _users, invites, *_unused = assignments
    agents["course-one"]["studentIds"] = ["old-invite", "student-1", "deleted-student"]
    invites.append({
        "id": "old-invite", "role": "student", "status": "promoted",
        "oauthUserId": "student-1", "email": "student-1@example.com",
    })
    response = client.get("/api/agents/course-one/students")
    assert response.status_code == 200
    assert response.json()["student_ids"] == ["student-1", "deleted-student"]
    students = {student["user_id"]: student for student in response.json()["students"]}
    assert "old-invite" not in students
    assert students["deleted-student"]["status"] == "unavailable"


@pytest.mark.parametrize("endpoint", ["start", "continue", "stream", "agui"])
def test_unassigned_student_cannot_chat_by_direct_url_or_spoofed_body(assignments, monkeypatch, endpoint):
    client = assignments[0]
    sign_in(client, "student-2")
    create_agent = Mock()
    monkeypatch.setattr(main, "get_general_agent", create_agent)
    response = client.post(f"/api/agents/course-one/chat/{endpoint}", json={
        "text": "Hello", "user_id": "student-1", "user_profile": {"role": "admin"},
    })
    assert response.status_code == 403
    assert "not assigned" in response.json()["detail"]
    create_agent.assert_not_called()


@pytest.mark.parametrize("path", [
    "/api/agents/course-one/details", "/api/agents/course-one/tools",
    "/api/agents/setup/course-one", "/api/agents/image/course-one",
    "/api/agents/course-one/course-curriculum",
    "/api/agents/course-one/conversation-starters",
    "/api/agents/course-one/progress/student-2",
    "/api/conversations/example-conversation?agent_name=course-one",
])
def test_unassigned_student_cannot_read_ta_resources(assignments, path):
    client = assignments[0]
    sign_in(client, "student-2")
    assert client.get(path).status_code == 403


def test_unassigned_student_cannot_use_ta_for_title_generation(assignments, monkeypatch):
    client = assignments[0]
    sign_in(client, "student-2")
    create_agent = Mock()
    monkeypatch.setattr(main, "get_general_agent", create_agent)
    assert client.post("/api/chat/generate-title", json={
        "agent_name": "course-one", "user_message": "Hello",
    }).status_code == 403
    create_agent.assert_not_called()


@pytest.mark.parametrize("user_id,role", [("student-1", "student"), ("teacher-1", "teacher"), ("admin-1", "admin")])
def test_authorized_chat_still_works(assignments, monkeypatch, user_id, role):
    client = assignments[0]
    sign_in(client, user_id, role)
    ga = Mock()
    ga.start_chat.return_value = ("Example answer", "conversation-1")
    monkeypatch.setattr(main, "get_general_agent", Mock(return_value=ga))
    response = client.post("/api/agents/course-one/chat/start", json={"text": "Hello"})
    assert response.status_code == 200
    assert response.json()["reply"] == "Example answer"


def test_revocation_applies_on_the_next_chat_request(assignments, monkeypatch):
    client, agents, *_unused = assignments
    sign_in(client, "student-1")
    ga = Mock()
    ga.start_chat.return_value = ("Example answer", "conversation-1")
    monkeypatch.setattr(main, "get_general_agent", Mock(return_value=ga))
    assert client.post("/api/agents/course-one/chat/start", json={"text": "Hello"}).status_code == 200
    agents["course-one"]["studentIds"] = []
    assert client.post("/api/agents/course-one/chat/start", json={"text": "Hello"}).status_code == 403
    ga.start_chat.assert_called_once()


def test_student_cannot_manage_roster_using_admin_requester_id(assignments):
    client = assignments[0]
    sign_in(client, "student-2")
    assert client.post("/api/agents/course-one/members?requester_id=admin-1", json={
        "user_id": "student-2", "member_type": "student",
    }).status_code == 403
    assert client.delete("/api/agents/course-one/members/student-1?requester_id=admin-1").status_code == 403


def test_teacher_cannot_bypass_admin_only_student_assignments(assignments):
    client = assignments[0]
    sign_in(client, "teacher-1", "teacher")
    assert client.post("/api/agents/course-one/members", json={
        "user_id": "student-2", "member_type": "student",
    }).status_code == 403
    assert client.delete("/api/agents/course-one/members/student-1").status_code == 403


def test_library_uses_session_identity_and_never_falls_back_to_unscoped_agents(assignments, monkeypatch):
    client = assignments[0]
    sign_in(client, "student-1")
    list_agents = Mock(side_effect=RuntimeError("private Cosmos details"))
    azure_fallback = Mock()
    monkeypatch.setattr(main, "list_agents_for_user", list_agents)
    monkeypatch.setattr(main, "AgentCreator", azure_fallback)
    assert client.get("/api/azure/agents/list?user_id=admin-1").status_code == 403
    list_agents.assert_not_called()
    response = client.get("/api/azure/agents/list")
    assert response.status_code == 503
    assert "private" not in response.text
    list_agents.assert_called_once_with(user_id="student-1", user_role="student")
    azure_fallback.assert_not_called()


def test_library_does_not_reuse_a_revoked_student_roster(assignments, monkeypatch):
    client, agents, *_unused = assignments
    sign_in(client, "student-1")
    list_agents = Mock(side_effect=lambda **_kwargs: [
        deepcopy(agent) for agent in agents.values() if "student-1" in agent["studentIds"]
    ])
    monkeypatch.setattr(main, "list_agents_for_user", list_agents)
    monkeypatch.setattr(main, "get_users_batch", lambda _ids: {"teacher-1": {"displayName": "Example Teacher"}})
    assert [agent["id"] for agent in client.get("/api/azure/agents/list").json()] == ["course-one"]
    agents["course-one"]["studentIds"] = []
    assert client.get("/api/azure/agents/list").json() == []
    assert list_agents.call_count == 2


def test_membership_checks_fail_closed_on_storage_failure(assignments, monkeypatch):
    client = assignments[0]
    sign_in(client, "student-2")
    monkeypatch.setattr(cosmos_db, "get_student_assignment_ids", Mock(side_effect=RuntimeError("private details")))
    response = client.post("/api/agents/course-one/chat/start", json={"text": "Hello"})
    assert response.status_code == 503
    assert "private" not in response.text


def test_student_role_does_not_inherit_creator_or_teacher_access(assignments):
    client, agents, *_unused = assignments
    agents["course-one"]["createdById"] = "student-2"
    agents["course-one"]["teacherIds"].append("student-2")
    sign_in(client, "student-2")
    assert client.post("/api/agents/course-one/chat/start", json={"text": "Hello"}).status_code == 403


def test_promoted_invitation_still_grants_access_without_a_roster_migration(assignments, monkeypatch):
    client, agents, *_unused = assignments
    agents["course-one"]["studentIds"] = ["old-invite"]
    monkeypatch.setattr(cosmos_db, "get_student_assignment_ids", lambda uid: [uid, "old-invite"])
    sign_in(client, "student-1")
    assert agent_access.has_agent_access(agents["course-one"], ActiveUser(id="student-1", role="student", status="active"))
    candidates, _aliases = agent_membership.student_directory()
    assert "student-1" in candidates


def test_assignment_identity_lookup_is_parameterized(monkeypatch):
    invitations = Mock()
    invitations.query_items.return_value = ["old-invite"]
    monkeypatch.setattr(cosmos_db, "get_cosmos_client", lambda: None)
    monkeypatch.setattr(cosmos_db, "_invited_users_container", invitations)
    assert cosmos_db.get_student_assignment_ids("oauth-student") == ["oauth-student", "old-invite"]
    kwargs = invitations.query_items.call_args.kwargs
    assert kwargs["parameters"] == [{"name": "@uid", "value": "oauth-student"}]
    assert "oauth-student" not in kwargs["query"]
    assert "c.oauthUserId = @uid" in kwargs["query"]


def test_student_list_queries_only_explicit_active_memberships(monkeypatch):
    container = Mock()
    container.query_items.return_value = []
    monkeypatch.setattr(cosmos_db, "_get_agents_container", lambda: container)
    monkeypatch.setattr(cosmos_db, "get_student_assignment_ids", lambda _uid: ["oauth-student", "old-invite"])
    assert cosmos_db.list_agents_for_user("oauth-student", "student") == []
    kwargs = container.query_items.call_args.kwargs
    assert "c.status = 'active'" in kwargs["query"]
    assert "ARRAY_CONTAINS(c.studentIds, @student0) OR ARRAY_CONTAINS(c.studentIds, @student1)" in kwargs["query"]
    assert {parameter["value"] for parameter in kwargs["parameters"]} == {"oauth-student", "old-invite"}
    assert "department" not in kwargs["query"].lower()
