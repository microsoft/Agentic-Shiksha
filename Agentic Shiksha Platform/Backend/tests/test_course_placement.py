from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from azure.core import MatchConditions
from azure.cosmos.exceptions import CosmosHttpResponseError, CosmosResourceNotFoundError
from fastapi import FastAPI
from fastapi.testclient import TestClient

from azure_services.persistence import cosmos_db
from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.routers import course_placement


URL = "/api/agents/course-one/placement"
UPDATE = {"institute": "New Institute", "department": "New Department", "revision": "revision-1"}


@pytest.fixture
def placement(monkeypatch):
    document = {
        "id": "course-one", "_etag": "revision-1", "courseName": "Physics",
        "institute": "Course Institute", "institution": "Legacy Institute",
        "department": "Physics", "departmentId": "legacy-department-id",
        "createdById": "teacher-1", "teacherIds": ["teacher-1", "teacher-2"],
        "studentIds": ["student-1"], "status": "active",
        "createdBy": {"institute": "Creator Institute", "department": "Creator Department"},
        "metadata": {"keep": ["unchanged"]},
    }
    load = Mock(side_effect=lambda _agent_id: deepcopy(document))
    container = Mock()

    def patch_item(*, item, partition_key, patch_operations, etag, match_condition):
        assert item == partition_key == document["id"]
        assert etag == document["_etag"]
        assert match_condition == MatchConditions.IfNotModified
        assert [operation["path"] for operation in patch_operations] == [
            "/institute", "/department", "/departmentId",
        ]
        assert all(operation["op"] == "set" for operation in patch_operations)
        for operation in patch_operations:
            document[operation["path"].removeprefix("/")] = operation["value"]
        document["_etag"] = "revision-2"
        return deepcopy(document)

    container.patch_item.side_effect = patch_item
    get_container = Mock(return_value=container)
    invalidate = Mock()
    profile = Mock(side_effect=AssertionError("Placement must not infer profile affiliations"))
    live_storage = Mock(side_effect=AssertionError("Live storage is forbidden in this test"))
    monkeypatch.setattr(course_placement, "load_agent", load)
    monkeypatch.setattr(course_placement, "_get_agents_container", get_container)
    monkeypatch.setattr(course_placement, "_invalidate_placement_cache", invalidate)
    monkeypatch.setattr(cosmos_db, "get_user_profile", profile)
    monkeypatch.setattr(cosmos_db, "get_cosmos_client", live_storage)
    app = FastAPI()
    app.include_router(course_placement.router)
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(
        id="admin-1", role="admin", status="active",
    )
    with TestClient(app) as client:
        yield SimpleNamespace(
            client=client, document=document, load=load, container=container,
            get_container=get_container, invalidate=invalidate,
        )
    profile.assert_not_called()
    live_storage.assert_not_called()


def requests(client):
    return [client.get(URL), client.put(URL, json=UPDATE)]


@pytest.mark.parametrize("role", ["admin", "superadmin"])
def test_admins_read_and_conditionally_patch_only_placement(placement, role):
    p = placement
    p.client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(
        id="admin-1", role=role, status="active",
    )
    original = deepcopy(p.document)
    response = p.client.get(URL)
    assert response.status_code == 200
    assert response.json() == {
        "agent_id": "course-one", "institute": "Course Institute",
        "department": "Physics", "revision": "revision-1",
    }
    p.get_container.assert_not_called()
    p.invalidate.assert_not_called()
    response = p.client.put(URL, json={
        "institute": "  New Institute  ", "department": " New Department ",
        "revision": " revision-1 ",
    })
    assert response.status_code == 200
    assert response.json() == {
        "agent_id": "course-one", "institute": "New Institute",
        "department": "New Department", "revision": "revision-2",
    }
    assert p.document == {
        **original, "institute": "New Institute", "department": "New Department",
        "departmentId": "", "_etag": "revision-2",
    }
    p.container.patch_item.assert_called_once()
    p.invalidate.assert_called_once_with()
    assert p.client.get(URL).json() == response.json()
    p.container.patch_item.assert_called_once()


@pytest.mark.parametrize("role", ["student", "teacher"])
def test_non_admins_cannot_read_or_write(placement, role):
    p = placement
    p.client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(
        id="teacher-1" if role == "teacher" else "student-1", role=role, status="active",
    )
    assert [response.status_code for response in requests(p.client)] == [403, 403]
    p.load.assert_not_called()
    p.get_container.assert_not_called()
    p.invalidate.assert_not_called()


def test_absent_authentication_is_unauthorized(placement):
    p = placement
    p.client.app.dependency_overrides.clear()
    assert [response.status_code for response in requests(p.client)] == [401, 401]
    p.load.assert_not_called()
    p.get_container.assert_not_called()


@pytest.mark.parametrize(("fields", "expected"), [
    ({}, ("", "")),
    ({"institute": "Course Institute"}, ("", "")),
    ({"department": "Physics"}, ("", "")),
    ({"institution": " Legacy Institute ", "department": " Physics "}, ("Legacy Institute", "Physics")),
    ({"institute": "", "institution": "Legacy Institute", "department": "Physics"}, ("Legacy Institute", "Physics")),
])
def test_only_complete_explicit_pairs_are_returned(placement, fields, expected):
    p = placement
    for key in ("institute", "institution", "department"):
        p.document.pop(key)
    p.document.update(fields)
    original = deepcopy(p.document)
    response = p.client.get(URL)
    assert response.status_code == 200
    assert response.json() == {
        "agent_id": "course-one", "institute": expected[0],
        "department": expected[1], "revision": "revision-1",
    }
    assert p.document == original
    p.get_container.assert_not_called()
    p.invalidate.assert_not_called()


def test_unassign_clears_legacy_department_id_without_changing_membership(placement):
    p = placement
    original = deepcopy(p.document)
    response = p.client.put(URL, json={"institute": " ", "department": "", "revision": "revision-1"})
    assert response.status_code == 200
    assert response.json() == {
        "agent_id": "course-one", "institute": "", "department": "", "revision": "revision-2",
    }
    assert p.document == {
        **original, "institute": "", "department": "", "departmentId": "", "_etag": "revision-2",
    }
    assert p.client.get(URL).json() == response.json()


@pytest.mark.parametrize("race", [False, True], ids=["stale-preread", "cosmos-412"])
def test_revision_conflicts_never_overwrite_the_course(placement, race):
    p = placement
    original = deepcopy(p.document)
    body = dict(UPDATE)
    if race:
        p.container.patch_item.side_effect = CosmosHttpResponseError(status_code=412, message="private details")
    else:
        body["revision"] = "old-revision"
    response = p.client.put(URL, json=body)
    assert response.status_code == 409
    assert response.json() == {"detail": course_placement.CONFLICT_DETAIL}
    assert p.document == original
    assert p.container.patch_item.call_count == int(race)
    p.invalidate.assert_not_called()


def test_absent_course_is_not_found(placement):
    p = placement
    p.load.side_effect = CosmosResourceNotFoundError(message="private details")
    assert [response.status_code for response in requests(p.client)] == [404, 404]
    p.get_container.assert_not_called()
    p.invalidate.assert_not_called()


def test_job_documents_are_not_courses_even_with_placement_fields(placement):
    p = placement
    for job_type in ("course_curriculum", None):
        p.document["job_type"] = job_type
        assert [response.status_code for response in requests(p.client)] == [404, 404]
    p.get_container.assert_not_called()
    p.invalidate.assert_not_called()


def test_malformed_saved_mapping_is_not_guessed_or_overwritten(placement):
    p = placement
    original = deepcopy(p.document)
    for field, value in [
        ("institute", {"name": "Institute"}), ("department", ["Physics"]),
        ("institute", None), ("department", 0), ("department", "Physics\n"),
        ("institute", "I" * 201),
    ]:
        p.document.clear()
        p.document.update(deepcopy(original))
        p.document[field] = value
        before = deepcopy(p.document)
        for response in requests(p.client):
            assert response.status_code == 422
            assert response.json() == {"detail": "Saved course placement is invalid"}
        assert p.document == before
    p.document.clear()
    p.document.update(original)
    p.document.pop("institute")
    p.document["institution"] = {"name": "Legacy Institute"}
    assert [response.status_code for response in requests(p.client)] == [422, 422]
    p.get_container.assert_not_called()
    p.invalidate.assert_not_called()


def test_invalid_put_bodies_never_reach_storage(placement):
    p = placement
    invalid_bodies = [
        {**UPDATE, "institute": ""}, {**UPDATE, "department": " "},
        {**UPDATE, "studentIds": ["student-2"]}, {**UPDATE, "teacherIds": []},
        {**UPDATE, "institute": "I" * 201}, {**UPDATE, "department": "D" * 201},
        {**UPDATE, "institute": None}, {**UPDATE, "department": 123},
        {**UPDATE, "institute": "Institute\n"}, {**UPDATE, "department": "\tDepartment"},
        {**UPDATE, "institute": "Institute\u007f"}, {**UPDATE, "department": "Dept\u0085"},
        {**UPDATE, "revision": ""}, {**UPDATE, "revision": 1},
        {**UPDATE, "revision": "revision-1\n"}, {**UPDATE, "revision": "R" * 257},
        {"institute": "Institute", "revision": "revision-1"},
        {"institute": "Institute", "department": "Department"},
    ]
    for body in invalid_bodies:
        assert p.client.put(URL, json=body).status_code == 422
    p.load.assert_not_called()
    p.get_container.assert_not_called()
    p.invalidate.assert_not_called()


@pytest.mark.parametrize("stage", ["read", "patch"])
def test_storage_failures_are_logged_and_sanitized(placement, caplog, stage):
    p = placement
    original = deepcopy(p.document)
    failure = RuntimeError("private storage details")
    if stage == "read":
        p.load.side_effect = failure
        responses = requests(p.client)
        p.get_container.assert_not_called()
    else:
        p.container.patch_item.side_effect = failure
        responses = [p.client.put(URL, json=UPDATE)]
    for response in responses:
        assert response.status_code == 503
        assert response.json() == {"detail": "Course placement is unavailable. Please retry."}
    assert "Teaching assistant placement request failed" in caplog.text
    assert p.document == original
    p.invalidate.assert_not_called()


def test_missing_revisions_and_cache_failures_are_not_silently_accepted(placement):
    p = placement
    p.document.pop("_etag")
    assert [response.status_code for response in requests(p.client)] == [503, 503]
    p.get_container.assert_not_called()
    p.document["_etag"] = "revision-1"
    p.invalidate.side_effect = RuntimeError("private cache details")
    response = p.client.put(URL, json=UPDATE)
    assert response.status_code == 503
    assert response.json() == {"detail": "Course placement is unavailable. Please retry."}
    p.invalidate.assert_called_once()
    assert p.document["_etag"] == "revision-2"
