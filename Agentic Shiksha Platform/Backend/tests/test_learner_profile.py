from copy import deepcopy
from datetime import datetime
import secrets
from types import SimpleNamespace
from unittest.mock import Mock, patch

import jwt
import pytest
from azure.core.exceptions import ServiceRequestError
from azure.cosmos.exceptions import CosmosHttpResponseError, CosmosResourceNotFoundError
from fastapi.testclient import TestClient

from azure_services.persistence import cosmos_db
from backend.dependencies import agent_access
from backend.dependencies.auth import get_current_active_user
from backend.schemas.learner_profile import LearnerLearningResponse, LearnerProfileResponse


with patch("msal.PublicClientApplication"):
    import auth as session_auth
    from backend import main


URL = "/api/learner-profile"


@pytest.fixture
def profile_api(monkeypatch):
    records = {
        "student-1": {
            "id": "student-1", "userId": "student-1", "role": "student", "status": "active",
            "fullName": "Example Learner", "displayName": "Example", "nickname": "Learner",
            "email": "user@example.com", "authProvider": "microsoft",
            "workFunction": "Student", "preferences": "Visual explanations",
            "customInstructions": "Original preferences", "learningProfile": '{"goals":["circuits"]}',
            "department": "Engineering", "college": "Example College", "institute": "Example College",
            "language": "Telugu", "currentLocation": "Example City", "interests": "Electronics",
            "passionateAbout": "Learning", "onboardingCompleted": True,
            "affiliations": [{"institute": "Example College", "department": "Engineering"}],
            "activeAffiliation": 0, "unrecognizedFutureField": {"keep": [1, 2]},
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-02T00:00:00Z",
        },
        "student-2": {
            "id": "student-2", "userId": "student-2", "role": "student", "status": "active",
            "customInstructions": "Another learner's preferences",
            "updatedAt": "2026-01-03T00:00:00Z",
        },
    }
    container = Mock()

    def read_item(*, item, partition_key):
        assert item == partition_key
        if item not in records:
            raise CosmosResourceNotFoundError(message="Missing example profile")
        return deepcopy(records[item])

    def patch_item(*, item, partition_key, patch_operations):
        assert item == partition_key
        assert [operation["path"] for operation in patch_operations] == [
            "/customInstructions", "/updatedAt",
        ]
        assert all(operation["op"] == "set" for operation in patch_operations)
        if item not in records:
            raise CosmosResourceNotFoundError(message="Missing example profile")
        for operation in patch_operations:
            records[item][operation["path"].removeprefix("/")] = deepcopy(operation["value"])
        return deepcopy(records[item])

    container.read_item.side_effect = read_item
    container.patch_item.side_effect = patch_item
    monkeypatch.setattr(cosmos_db, "get_cosmos_client", Mock())
    monkeypatch.setattr(cosmos_db, "_users_container", container)
    monkeypatch.setattr(session_auth, "JWT_SECRET", secrets.token_hex(32))
    monkeypatch.delitem(main.app.dependency_overrides, get_current_active_user, raising=False)

    def token(user_id):
        return session_auth.create_session_token(user_id, "Example", "user@example.com")

    client = TestClient(main.app)
    client.cookies.set("session", token("student-1"))
    yield SimpleNamespace(client=client, records=records, container=container, token=token)
    client.close()


def request_profile(api, method, suffix=""):
    kwargs = {"json": {"customInstructions": "Updated preferences"}} if method == "put" else {}
    return api.client.request(method, URL + suffix, **kwargs)


def test_routes_are_registered_with_typed_responses():
    routes = [route for route in main.app.routes if getattr(route, "path", None) == URL]

    assert {method for route in routes for method in route.methods} == {"GET", "PUT"}
    assert all(route.response_model is LearnerProfileResponse for route in routes)


@pytest.mark.parametrize("state", ["missing", "null", "empty"])
def test_get_returns_blank_for_missing_null_or_empty_instructions(profile_api, state):
    profile = profile_api.records["student-1"]
    profile.pop("updatedAt")
    if state == "missing":
        profile.pop("customInstructions")
    else:
        profile["customInstructions"] = None if state == "null" else ""

    response = profile_api.client.get(URL)

    assert response.status_code == 200
    assert response.json() == {"customInstructions": "", "updatedAt": None}
    assert response.headers["cache-control"] == "private, no-store"
    profile_api.container.patch_item.assert_not_called()
    profile_api.container.upsert_item.assert_not_called()


@pytest.mark.parametrize("role", ["student", "teacher", "admin", "superadmin"])
@pytest.mark.parametrize("method", ["get", "put"])
def test_active_accounts_can_only_access_their_own_profile(profile_api, role, method):
    profile_api.records["student-1"]["role"] = role
    other_before = deepcopy(profile_api.records["student-2"])

    response = request_profile(profile_api, method, "?user_id=student-2")

    assert response.status_code == 200
    assert set(response.json()) == {"customInstructions", "updatedAt"}
    assert response.json()["customInstructions"] == (
        "Original preferences" if method == "get" else "Updated preferences"
    )
    assert profile_api.records["student-2"] == other_before
    assert all(call.kwargs["item"] == "student-1" for call in profile_api.container.read_item.call_args_list)
    if method == "put":
        assert profile_api.container.patch_item.call_args.kwargs["item"] == "student-1"


def test_bearer_authentication_uses_verified_identity(profile_api):
    profile_api.client.cookies.clear()

    response = profile_api.client.get(
        URL + "?user_id=student-1",
        headers={"Authorization": f"Bearer {profile_api.token('student-2')}"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "customInstructions": "Another learner's preferences", "updatedAt": "2026-01-03T00:00:00Z",
    }


def test_save_get_and_clear_preserve_every_unrelated_field(profile_api):
    profile = profile_api.records["student-1"]
    profile.pop("customInstructions")
    before = deepcopy(profile)

    for instructions in ["Use worked examples.", "Prefer brief answers.", ""]:
        saved = profile_api.client.put(URL, json={"customInstructions": instructions})

        assert saved.status_code == 200
        assert saved.headers["cache-control"] == "private, no-store"
        assert saved.json() == {"customInstructions": instructions, "updatedAt": profile["updatedAt"]}
        assert datetime.fromisoformat(saved.json()["updatedAt"].replace("Z", "+00:00")).tzinfo is not None
        loaded = profile_api.client.get(URL)
        assert loaded.json() == saved.json()
        assert {
            key: value for key, value in profile.items() if key not in {"customInstructions", "updatedAt"}
        } == {key: value for key, value in before.items() if key != "updatedAt"}
    profile_api.container.upsert_item.assert_not_called()
    profile_api.container.replace_item.assert_not_called()


@pytest.mark.parametrize("instructions", [" \n\t ", 'తెలుగు "examples"\n', "x" * 20000])
def test_instructions_are_saved_verbatim_without_a_new_length_cap(profile_api, instructions):
    response = profile_api.client.put(URL, json={"customInstructions": instructions})

    assert response.status_code == 200
    assert response.json()["customInstructions"] == instructions
    assert profile_api.records["student-1"]["customInstructions"] == instructions


def test_atomic_patch_preserves_an_unrelated_concurrent_change(profile_api):
    patch_record = profile_api.container.patch_item.side_effect

    def concurrent_patch(**kwargs):
        profile_api.records["student-1"]["unrecognizedFutureField"] = {"concurrently": "updated"}
        return patch_record(**kwargs)

    profile_api.container.patch_item.side_effect = concurrent_patch

    response = profile_api.client.put(URL, json={"customInstructions": ""})

    assert response.status_code == 200
    assert profile_api.records["student-1"]["unrecognizedFutureField"] == {"concurrently": "updated"}


@pytest.mark.parametrize("method", ["get", "put"])
def test_unauthenticated_requests_are_rejected_before_storage_access(profile_api, method):
    profile_api.client.cookies.clear()

    assert request_profile(profile_api, method).status_code == 401
    profile_api.container.read_item.assert_not_called()
    profile_api.container.patch_item.assert_not_called()


@pytest.mark.parametrize("method", ["get", "put"])
@pytest.mark.parametrize("claims", [None, {}, {"sub": ""}, {"sub": " "}, {"sub": 123}, {"sub": "student-1", "exp": 0}])
def test_invalid_sessions_are_rejected(profile_api, method, claims):
    token = (
        jwt.encode(claims, session_auth.JWT_SECRET, algorithm="HS256")
        if claims is not None else "invalid-session"
    )
    profile_api.client.cookies.set("session", token)

    assert request_profile(profile_api, method).status_code == 401
    profile_api.container.read_item.assert_not_called()
    profile_api.container.patch_item.assert_not_called()


def test_forged_token_is_rejected(profile_api):
    profile_api.client.cookies.set("session", jwt.encode(
        {"sub": "student-1"}, secrets.token_hex(32), algorithm="HS256",
    ))

    assert profile_api.client.get(URL).status_code == 401
    profile_api.container.read_item.assert_not_called()


@pytest.mark.parametrize("method", ["get", "put"])
@pytest.mark.parametrize("account_state", ["disabled", "invited", "missing", "mismatched", "invalid-role"])
def test_only_existing_active_matching_accounts_are_allowed(profile_api, method, account_state):
    profile = profile_api.records["student-1"]
    if account_state == "missing":
        del profile_api.records["student-1"]
    elif account_state == "mismatched":
        profile["id"] = "student-2"
    elif account_state == "invalid-role":
        profile["role"] = "unrecognized-role"
    else:
        profile["status"] = account_state

    assert request_profile(profile_api, method).status_code == 403
    profile_api.container.patch_item.assert_not_called()


@pytest.mark.parametrize("payload", [
    None, [], "not an object",
    {}, {"customInstructions": None}, {"customInstructions": 123}, {"customInstructions": True},
    {"customInstructions": []}, {"customInstructions": {}},
    {"customInstructions": "Example", "user_id": "student-2"},
    {"customInstructions": "Example", "role": "admin"},
    {"customInstructions": "Example", "onboardingCompleted": False},
    {"customInstructions": "Example", "updatedAt": "client-controlled"},
])
def test_invalid_or_extra_write_fields_are_rejected(profile_api, payload):
    before = deepcopy(profile_api.records)

    assert profile_api.client.put(URL, json=payload).status_code == 422
    assert profile_api.records == before
    profile_api.container.patch_item.assert_not_called()


def test_read_failures_are_not_disguised_as_blank_preferences(profile_api, caplog):
    profile_api.container.read_item.side_effect = [
        deepcopy(profile_api.records["student-1"]),
        RuntimeError("private storage diagnostic"),
    ]

    response = profile_api.client.get(URL)

    assert response.status_code == 503
    assert response.json() == {"detail": "Learner profile could not be loaded. Please retry."}
    assert "private storage diagnostic" not in response.text + caplog.text


@pytest.mark.parametrize("value", [123, False, {"private": "invalid record"}])
def test_invalid_persisted_instructions_return_a_generic_error(profile_api, value, caplog):
    profile_api.records["student-1"]["customInstructions"] = value

    response = profile_api.client.get(URL)

    assert response.status_code == 503
    assert response.json() == {"detail": "Learner profile could not be loaded. Please retry."}
    assert "invalid record" not in response.text + caplog.text


@pytest.mark.parametrize("failure", [
    RuntimeError("private storage diagnostic"),
    CosmosHttpResponseError(status_code=429, message="private storage diagnostic"),
])
def test_failed_writes_never_report_success_or_log_private_details(profile_api, failure, caplog):
    before = deepcopy(profile_api.records)
    profile_api.container.patch_item.side_effect = failure

    response = profile_api.client.put(URL, json={"customInstructions": ""})

    assert response.status_code == 503
    assert response.json() == {"detail": "Learner profile could not be saved. Please retry."}
    assert profile_api.records == before
    assert profile_api.container.patch_item.call_count == 1
    assert "private storage diagnostic" not in response.text + caplog.text


@pytest.mark.parametrize("saved", [
    None, {}, {"id": "student-1", "updatedAt": "2026-01-01T00:00:00Z"},
    {"id": "student-1", "customInstructions": ""},
    {"id": "student-1", "customInstructions": "", "updatedAt": None},
    {"id": "student-1", "customInstructions": "not-cleared", "updatedAt": "2026-01-01T00:00:00Z"},
    {"id": "student-2", "customInstructions": "", "updatedAt": "2026-01-01T00:00:00Z"},
])
def test_unconfirmed_or_mismatched_write_results_are_failures(profile_api, saved):
    profile_api.container.patch_item.side_effect = None
    profile_api.container.patch_item.return_value = saved

    assert profile_api.client.put(URL, json={"customInstructions": ""}).status_code == 503


@pytest.mark.parametrize("method", ["get", "put"])
def test_profile_deleted_after_authentication_is_not_recreated(profile_api, method):
    missing = CosmosResourceNotFoundError(message="private missing record")
    if method == "get":
        profile_api.container.read_item.side_effect = [deepcopy(profile_api.records["student-1"]), missing]
    else:
        profile_api.container.patch_item.side_effect = missing

    response = request_profile(profile_api, method)

    assert response.status_code == 404
    assert response.json() == {"detail": "Learner profile not found"}
    profile_api.container.upsert_item.assert_not_called()


@pytest.fixture
def assigned_course(monkeypatch):
    monkeypatch.setattr(agent_access, "load_agent", lambda _agent_id: {
        "id": "course-example", "status": "active", "studentIds": ["student-1"], "createdById": "student-1",
    })


@pytest.mark.parametrize("endpoint", ["stream", "agui"])
@pytest.mark.parametrize("conversation_id", [None, "conversation-example"])
@pytest.mark.parametrize("inline_profile", [False, True])
def test_saved_and_cleared_instructions_reach_existing_chat_transports(
    profile_api, assigned_course, monkeypatch, endpoint, conversation_id, inline_profile,
):
    agent = Mock()
    agent.start_chat_stream.side_effect = lambda **_kwargs: iter([("done", "", "conversation-example")])
    agent.continue_chat_stream.side_effect = agent.start_chat_stream.side_effect
    monkeypatch.setattr(main, "get_general_agent", lambda **_kwargs: agent)
    monkeypatch.setattr(main, "_load_setup_json", lambda _agent_id: None)
    monkeypatch.setattr(main, "with_suggested_queries", lambda stream, *_args: stream)
    monkeypatch.setattr(main, "_record_inferred_progress", lambda **_kwargs: None)

    for instructions in ["Prefer examples.", "Use brief explanations.", ""]:
        saved = profile_api.client.put(URL, json={"customInstructions": instructions})
        assert saved.status_code == 200
        payload = {
            "text": "Explain voltage.", "user_id": "student-1",
            "inject_profile": True, "thread_id": conversation_id,
        }
        if inline_profile:
            payload["user_profile"] = {"customInstructions": saved.json()["customInstructions"]}

        response = profile_api.client.post(f"/api/agents/course-example/chat/{endpoint}", json=payload)

        assert response.status_code == 200
        assert "event: error" not in response.text and "RUN_ERROR" not in response.text
        chat_call = agent.continue_chat_stream if conversation_id else agent.start_chat_stream
        assert chat_call.call_args.kwargs["user_id"] == "student-1"
        assert chat_call.call_args.kwargs["user_profile"]["customInstructions"] == instructions

    payload["inject_profile"] = False
    profile_api.client.post(f"/api/agents/course-example/chat/{endpoint}", json=payload)
    assert chat_call.call_args.kwargs["user_profile"] == {}


def test_existing_progress_contract_and_student_self_scope(profile_api, assigned_course, monkeypatch):
    state = {
        "overall": {"total_topics": 1, "learned": 0, "in_progress": 1, "not_started": 0,
                    "percent": 0, "last_active": "2026-01-01T00:00:00Z"},
        "topics": {"Ohm's law": {"module": "Circuits", "status": "in_progress",
                                "latest_summary": "Still confused about resistance",
                                "last_touched": "2026-01-01T00:00:00Z"}},
        "objectives": {"Explain voltage": {"status": "not_started", "evidence": None}},
        "threshold_concepts": {"Resistance": {"status": "not_started", "misconceptions_addressed": []}},
    }
    ensure = Mock(return_value=state)
    monkeypatch.setattr(cosmos_db, "ensure_learning_state", ensure)
    monkeypatch.setattr(cosmos_db, "get_learning_state", lambda _user, _agent: deepcopy(state))

    response = profile_api.client.get("/api/agents/course-example/progress/student-1")

    assert response.status_code == 200
    body = response.json()
    assert (body["agent_name"], body["user_id"], body["status"]) == ("course-example", "student-1", "ok")
    assert set(body["progress"]) == {
        "overall", "in_progress", "recently_active", "struggle_areas", "threshold_concepts", "topics", "objectives",
    }
    for field in ("overall", "topics", "objectives", "threshold_concepts"):
        assert body["progress"][field] == state[field]
    assert body["progress"]["in_progress"] == [{
        "topic": "Ohm's law", "module": "Circuits", "latest_summary": "Still confused about resistance",
    }]
    assert body["progress"]["recently_active"] == [{
        "topic": "Ohm's law", "module": "Circuits", "status": "in_progress",
        "latest_summary": "Still confused about resistance",
    }]
    assert body["progress"]["struggle_areas"] == [{
        "topic": "Ohm's law", "summary": "Still confused about resistance",
    }]
    assert profile_api.client.get("/api/agents/course-example/progress/student-2").status_code == 403
    ensure.assert_called_once_with("student-1", "course-example")


def test_existing_progress_no_state_is_distinct_from_zero_percent(profile_api, assigned_course, monkeypatch):
    monkeypatch.setattr(cosmos_db, "ensure_learning_state", Mock(return_value=None))
    monkeypatch.setattr(cosmos_db, "get_learning_state", lambda _user, _agent: None)

    response = profile_api.client.get("/api/agents/course-example/progress/student-1")

    assert response.status_code == 200
    assert response.json() == {
        "agent_name": "course-example", "user_id": "student-1", "status": "no_state",
        "message": "No learning state found. Progress tracking begins when the student starts chatting.",
    }


@pytest.fixture
def learner_learning(profile_api, assigned_course, monkeypatch):
    record = {
        "id": "student-1_course-example_state",
        "partitionKey": "student-1", "agent_id": "course-example",
        "topics": {
            "Circuit fundamentals": {"status": "learned", "latest_summary": "Explained current flow."},
            "Electrical safety": {"status": "learned"},
            "Fault diagnosis": {"status": "in_progress", "last_touched": "2026-01-04T00:00:00Z"},
            "Motor control": {"status": "not_started"},
        },
        "threshold_concepts": {
            "Current and potential": {
                "status": "learned", "misconceptions_addressed": ["Voltage is consumed"],
                "misconception_notes": {
                    "Voltage is consumed": {"note": "Distinguished voltage from current.", "recorded_at": "2026-01-04T00:00:00Z"},
                },
            },
            "Fault isolation": {"status": "in_progress"},
        },
        "objectives": {"Use correct units": {"status": "learned", "evidence": "Used units consistently."}},
        "overall": {"percent": 64, "total_topics": 40, "learned": 26},
        "unrelatedPrivateField": "Must not be returned",
    }
    container = Mock()
    container.read_item.side_effect = lambda **_kwargs: deepcopy(record)
    monkeypatch.setattr(cosmos_db, "_get_learning_states_container", Mock(return_value=container))
    monkeypatch.setattr(cosmos_db, "_learning_state_cache", {
        record["id"]: {"id": "another-learner_course-example_state", "topics": {"Stale cached topic": {}}},
    })
    initializer = Mock(side_effect=AssertionError("A profile read must not create progress"))
    monkeypatch.setattr(cosmos_db, "ensure_learning_state", initializer)
    monkeypatch.setattr(agent_access, "student_assignment_ids", Mock(return_value=[]))
    return SimpleNamespace(
        api=profile_api, record=record, container=container, initializer=initializer,
        url=URL + "/learning/course-example",
    )


def test_learning_endpoint_has_a_typed_response():
    route = next(route for route in main.app.routes if getattr(route, "path", None) == URL + "/learning/{agent_id}")
    assert route.response_model is LearnerLearningResponse
    assert route.methods == {"GET"}


@pytest.mark.parametrize("role", ["student", "teacher", "admin", "superadmin"])
def test_learning_snapshot_uses_real_scoped_records_not_cached_percentages(learner_learning, role):
    fixture = learner_learning
    fixture.api.records["student-1"]["role"] = role
    response = fixture.api.client.get(fixture.url + "?user_id=student-2&agent_id=course-other")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    body = response.json()
    assert set(body) == {"user_id", "agent_id", "status", "progress", "learning_preferences"}
    assert (body["user_id"], body["agent_id"], body["status"]) == ("student-1", "course-example", "ok")
    assert body["learning_preferences"] == ["Visual explanations"]
    progress = body["progress"]
    assert set(progress) == {"topics", "threshold_concepts", "objectives"}
    assert len(progress["topics"]) == 4
    assert sum(item["status"] == "learned" for item in progress["topics"].values()) == 2
    assert sum(item["status"] == "in_progress" for item in progress["threshold_concepts"].values()) == 1
    assert sum(item["status"] == "learned" for item in progress["threshold_concepts"].values()) == 1
    assert progress["objectives"]["Use correct units"]["evidence"] == "Used units consistently."
    assert progress["threshold_concepts"]["Current and potential"]["misconception_notes"]["Voltage is consumed"]["note"] == "Distinguished voltage from current."
    assert "unrelatedPrivateField" not in response.text
    assert "Stale cached topic" not in response.text
    assert "customInstructions" not in body
    assert "active_misconceptions" not in body
    fixture.container.read_item.assert_called_once_with(item="student-1_course-example_state", partition_key="student-1")
    fixture.container.upsert_item.assert_not_called()
    fixture.initializer.assert_not_called()


@pytest.mark.parametrize("preferences", [None, "", "  \n "])
def test_learning_preferences_do_not_derive_tags_from_instructions(learner_learning, preferences):
    fixture = learner_learning
    fixture.api.records["student-1"]["preferences"] = preferences
    fixture.api.records["student-1"]["customInstructions"] = "Step by step, with examples and questions."

    response = fixture.api.client.get(fixture.url)

    assert response.status_code == 200
    assert response.json()["learning_preferences"] == []


def test_no_learning_state_is_an_explicit_empty_result_without_a_write(learner_learning):
    fixture = learner_learning
    fixture.container.read_item.side_effect = CosmosResourceNotFoundError(message="No saved state")

    response = fixture.api.client.get(fixture.url)

    assert response.status_code == 200
    assert response.json() == {
        "user_id": "student-1", "agent_id": "course-example", "status": "no_state",
        "progress": None, "learning_preferences": ["Visual explanations"],
    }
    fixture.container.upsert_item.assert_not_called()
    fixture.initializer.assert_not_called()


def test_missing_collections_remain_unavailable_instead_of_zero(learner_learning):
    fixture = learner_learning
    for collection in ("topics", "threshold_concepts", "objectives"):
        fixture.record.pop(collection)

    response = fixture.api.client.get(fixture.url)

    assert response.status_code == 200
    assert response.json()["progress"] == {"topics": None, "threshold_concepts": None, "objectives": None}


@pytest.mark.parametrize(("field", "value"), [
    ("id", "student-2_course-example_state"),
    ("agent_id", "course-other"), ("partitionKey", "student-2"), ("userId", "student-2"),
    ("topics", {"Invalid": {"status": "mastered"}}),
    ("topics", {"Invalid": {"status": "learned", "latest_summary": 123}}),
    ("threshold_concepts", {"Invalid": {"status": "learned", "misconception_notes": []}}),
    ("objectives", {"Invalid": {"status": "learned", "evidence": {"private": "not text"}}}),
])
def test_mismatched_or_invalid_learning_records_fail_closed(learner_learning, field, value, caplog):
    fixture = learner_learning
    fixture.record[field] = value

    response = fixture.api.client.get(fixture.url)

    assert response.status_code == 503
    assert response.json() == {"detail": "Learner learning data could not be loaded. Please retry."}
    assert "not text" not in response.text + caplog.text


def test_invalid_saved_preferences_are_not_an_empty_success(learner_learning):
    fixture = learner_learning
    fixture.api.records["student-1"]["preferences"] = ["unexpected legacy value"]

    assert fixture.api.client.get(fixture.url).status_code == 503


@pytest.mark.parametrize("status_code", [429, 500, 503])
def test_learning_storage_failures_are_not_no_state(learner_learning, status_code, caplog):
    fixture = learner_learning
    fixture.container.read_item.side_effect = CosmosHttpResponseError(
        status_code=status_code, message="private storage diagnostic",
    )

    response = fixture.api.client.get(fixture.url)

    assert response.status_code == 503
    assert response.json() == {"detail": "Learner learning data could not be loaded. Please retry."}
    assert "private storage diagnostic" not in response.text + caplog.text
    fixture.initializer.assert_not_called()


def test_learning_network_failures_are_retryable_not_an_empty_memory(learner_learning, caplog):
    fixture = learner_learning
    fixture.container.read_item.side_effect = ServiceRequestError("private connection diagnostic")

    response = fixture.api.client.get(fixture.url)

    assert response.status_code == 503
    assert response.json() == {"detail": "Learner learning data could not be loaded. Please retry."}
    assert "private connection diagnostic" not in response.text + caplog.text


@pytest.mark.parametrize("account", ["missing-session", "inactive", "unassigned"])
def test_learning_access_is_verified_before_reading_state(learner_learning, account):
    fixture = learner_learning
    if account == "missing-session":
        fixture.api.client.cookies.clear()
    elif account == "inactive":
        fixture.api.records["student-1"]["status"] = "disabled"
    else:
        fixture.api.client.cookies.set("session", fixture.api.token("student-2"))

    response = fixture.api.client.get(fixture.url)

    assert response.status_code == (401 if account == "missing-session" else 403)
    fixture.container.read_item.assert_not_called()


def test_switching_learner_and_ta_changes_the_storage_partition_and_key(learner_learning, monkeypatch):
    fixture = learner_learning
    monkeypatch.setattr(agent_access, "load_agent", lambda agent_id: {
        "id": agent_id, "status": "active", "studentIds": ["student-1", "student-2"],
    })
    first = fixture.api.client.get(fixture.url)
    assert first.status_code == 200
    fixture.api.client.cookies.set("session", fixture.api.token("student-2"))
    fixture.record.update({
        "id": "student-2_course-other_state", "partitionKey": "student-2", "agent_id": "course-other",
        "topics": {"Different topic": {"status": "in_progress"}},
        "threshold_concepts": {}, "objectives": {},
    })

    response = fixture.api.client.get(URL + "/learning/course-other?user_id=student-1")

    assert response.status_code == 200
    assert response.json()["user_id"] == "student-2"
    assert response.json()["agent_id"] == "course-other"
    assert set(response.json()["progress"]["topics"]) == {"Different topic"}
    assert response.json()["learning_preferences"] == []
    assert "Circuit fundamentals" not in response.text
    fixture.container.read_item.assert_called_with(item="student-2_course-other_state", partition_key="student-2")
