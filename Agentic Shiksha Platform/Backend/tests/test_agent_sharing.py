from copy import deepcopy
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from backend import main
from azure_services.persistence import cosmos_db
from backend.dependencies import auth
from backend.dependencies.auth import ActiveUser, get_current_active_user


@pytest.fixture
def sharing(monkeypatch):
    agent = {
        "id": "course-example",
        "agentName": "course-Example",
        "courseName": "Example",
        "createdById": "creator-1",
        "teacherIds": ["creator-1", "teacher-1"],
        "studentIds": ["student-1"],
    }
    find_agent = Mock(side_effect=lambda _code: deepcopy(agent))

    def add_member(_agent_id, user_id, member_type):
        field = "teacherIds" if member_type == "teacher" else "studentIds"
        agent[field].append(user_id)
        return deepcopy(agent)

    add_agent_member = Mock(side_effect=add_member)
    invalidate = Mock()
    monkeypatch.setattr(auth, "verify_token", lambda _token: {"sub": "student-1"})
    monkeypatch.setattr(auth, "load_profile", lambda user_id: {"id": user_id, "role": "student", "status": "active"})
    monkeypatch.setattr(cosmos_db, "get_student_assignment_ids", lambda user_id: [user_id])
    monkeypatch.setattr(cosmos_db, "find_agent_by_manage_code", find_agent)
    monkeypatch.setattr(cosmos_db, "add_agent_member", add_agent_member)
    monkeypatch.setattr(main, "_invalidate_agent_list_caches", invalidate)
    client = TestClient(main.app)
    client.cookies.set("session", "test-session")
    return client, find_agent, add_agent_member, invalidate


@pytest.mark.parametrize(
    ("user_id", "role"),
        [
            ("creator-1", "teacher"),
            ("teacher-1", "teacher"),
            ("student-1", "student"),
            ("admin-1", "admin"),
            ("superadmin-1", "superadmin"),
        ],
)
def test_existing_access_opens_ta_without_membership_write(sharing, monkeypatch, user_id, role):
    client, find_agent, add_member, invalidate = sharing
    monkeypatch.setattr(auth, "verify_token", lambda _token: {"sub": user_id})
    monkeypatch.setattr(auth, "load_profile", lambda _user_id: {"id": user_id, "role": role, "status": "active"})

    response = client.post("/api/agents/connect-by-code", json={"code": " abc123 "})

    assert response.status_code == 200
    assert response.json() == {
        "agent_id": "course-example",
        "agent_name": "course-Example",
        "course_name": "Example",
        "already_joined": True,
    }
    find_agent.assert_called_once_with("ABC123")
    add_member.assert_not_called()
    invalidate.assert_not_called()


def test_new_teacher_joins_once_and_subsequent_visit_opens(sharing, monkeypatch):
    client, _find_agent, add_member, invalidate = sharing
    monkeypatch.setattr(auth, "verify_token", lambda _token: {"sub": "new-user"})
    monkeypatch.setattr(auth, "load_profile", lambda _user_id: {"id": "new-user", "role": "teacher", "status": "active"})

    first = client.post("/api/agents/connect-by-code", json={"code": "ABC123"})
    second = client.post("/api/agents/connect-by-code", json={"code": "ABC123"})

    assert first.status_code == second.status_code == 200
    assert first.json()["already_joined"] is False
    assert second.json()["already_joined"] is True
    assert first.json()["agent_id"] == second.json()["agent_id"] == "course-example"
    add_member.assert_called_once_with("course-example", "new-user", member_type="teacher")
    invalidate.assert_called_once_with(
        "new-user", invalidate_teacher_scope=True,
    )


def test_unassigned_student_cannot_self_enroll_using_a_shared_code(sharing, monkeypatch):
    client, _find_agent, add_member, invalidate = sharing
    monkeypatch.setattr(auth, "verify_token", lambda _token: {"sub": "unassigned-student"})

    response = client.post("/api/agents/connect-by-code", json={"code": "ABC123"})

    assert response.status_code == 403
    assert "not assigned" in response.json()["detail"]
    add_member.assert_not_called()
    invalidate.assert_not_called()


def test_link_still_requires_authentication(sharing, monkeypatch):
    client, find_agent, add_member, invalidate = sharing
    client.cookies.clear()

    response = client.post("/api/agents/connect-by-code", json={"code": "ABC123"})

    assert response.status_code == 401
    find_agent.assert_not_called()
    add_member.assert_not_called()
    invalidate.assert_not_called()


@pytest.mark.parametrize("session", [None, {}, {"sub": ""}])
def test_invalid_session_cannot_resolve_a_shared_ta(sharing, monkeypatch, session):
    client, find_agent, add_member, invalidate = sharing
    monkeypatch.setattr(auth, "verify_token", lambda _token: session)

    response = client.post("/api/agents/connect-by-code", json={"code": "ABC123"})

    assert response.status_code == 401
    find_agent.assert_not_called()
    add_member.assert_not_called()
    invalidate.assert_not_called()


def test_unknown_code_does_not_create_membership(sharing):
    client, find_agent, add_member, invalidate = sharing
    find_agent.side_effect = None
    find_agent.return_value = None

    response = client.post("/api/agents/connect-by-code", json={"code": "ZZZ999"})

    assert response.status_code == 404
    add_member.assert_not_called()
    invalidate.assert_not_called()


def test_agent_removed_during_join_does_not_report_success(sharing, monkeypatch):
    client, _find_agent, add_member, invalidate = sharing
    monkeypatch.setattr(auth, "verify_token", lambda _token: {"sub": "new-user"})
    monkeypatch.setattr(auth, "load_profile", lambda _user_id: {"id": "new-user", "role": "teacher", "status": "active"})
    add_member.side_effect = None
    add_member.return_value = None

    response = client.post("/api/agents/connect-by-code", json={"code": "ABC123"})

    assert response.status_code == 404
    add_member.assert_called_once_with("course-example", "new-user", member_type="teacher")
    invalidate.assert_not_called()


@pytest.fixture
def shared_conversation(monkeypatch):
    thread = {
        "id": "thread-1", "userId": "owner-1", "agentId": "course-example",
        "title": "Shared lesson", "createdAt": "2026-01-01T10:00:00.000Z",
    }
    messages = [{
        "id": "reply-1", "threadId": "thread-1", "userId": "owner-1",
        "role": "assistant", "content": "The shared explanation.",
        "createdAt": "2026-01-01T10:01:00.000Z", "isLatest": True,
        "metadata": {"contentBlocks": [{"type": "text", "content": "The shared explanation."}]},
    }]
    threads_container = Mock()
    threads_container.read_item.side_effect = lambda **_kwargs: deepcopy(thread)

    def store_thread(*, body, **_kwargs):
        thread.clear()
        thread.update(deepcopy(body))

    threads_container.replace_item.side_effect = store_thread
    threads_container.upsert_item.side_effect = store_thread
    threads_container.query_items.side_effect = lambda **kwargs: (
        [deepcopy(thread)] if thread.get("shareToken") == kwargs["parameters"][0]["value"] else []
    )
    messages_container = Mock()

    def query_messages(*, query, parameters, partition_key, **_kwargs):
        assert partition_key == "owner-1"
        params = {item["name"]: item["value"] for item in parameters}
        selected = [message for message in messages if message["threadId"] == params["@threadId"]]
        if "@sharedMessageIds" in params:
            assert "ARRAY_CONTAINS(@sharedMessageIds, c.id)" in query
            selected = [message for message in selected if message["id"] in params["@sharedMessageIds"]]
        if "@sharedAt" in params:
            assert "c.createdAt <= @sharedAt" in query
            selected = [message for message in selected if message["createdAt"] <= params["@sharedAt"]]
        if "c.isLatest" in query:
            selected = [message for message in selected if message.get("isLatest", True)]
        selected.sort(key=lambda message: message["createdAt"])
        if query.startswith("SELECT VALUE c.id"):
            return [message["id"] for message in selected]
        return deepcopy(selected)

    messages_container.query_items.side_effect = query_messages
    monkeypatch.setattr(cosmos_db, "_get_containers", lambda: (threads_container, messages_container))
    main.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="owner-1", role="teacher", status="active")
    monkeypatch.setattr(main, "_sign_generated_images", lambda result: result)
    client = TestClient(main.app)
    original_post = client.post

    def share_post(url, **kwargs):
        if "/share" in url and "json" not in kwargs:
            kwargs["json"] = {"message_ids": [message["id"] for message in messages if message.get("isLatest", True)] or ["not-saved"]}
        return original_post(url, **kwargs)

    client.post = share_post
    yield client, thread, messages, messages_container
    main.app.dependency_overrides.pop(get_current_active_user, None)


def test_shared_chat_excludes_later_messages_even_with_backdated_timestamps(shared_conversation):
    client, thread, messages, _container = shared_conversation
    response = client.post("/api/chat/thread/thread-1/share?user_id=owner-1")
    assert response.status_code == 200
    token = response.json()["share_token"]
    original_metadata = deepcopy(messages[0]["metadata"])

    messages.extend([
        {**messages[0], "id": "later-user", "role": "user", "content": "Private follow-up.", "createdAt": "2099-01-01T00:00:00.000Z"},
        {**messages[0], "id": "later-assistant", "content": "Private later answer."},
    ])
    messages[0]["isLatest"] = False
    thread["title"] = "Private later title"

    public = client.get(f"/api/shared/{token}")

    assert public.status_code == 200
    assert [message["id"] for message in public.json()["messages"]] == ["reply-1"]
    assert public.json()["messages"][0]["metadata"] == original_metadata
    assert public.json()["thread"]["title"] == "Shared lesson"
    assert "Private" not in public.text


def test_legacy_shared_chat_stops_at_original_share_time(shared_conversation):
    client, thread, messages, container = shared_conversation
    thread.update(shareToken="example-existing-share", sharedAt="2026-01-01T10:02:00.000Z")
    messages.append({**messages[0], "id": "private-reply", "content": "Private later answer.", "createdAt": "2026-01-01T10:03:00.000Z"})

    response = client.get("/api/shared/example-existing-share")

    assert response.status_code == 200
    assert [message["id"] for message in response.json()["messages"]] == ["reply-1"]
    parameters = container.query_items.call_args.kwargs["parameters"]
    assert {"name": "@sharedAt", "value": thread["sharedAt"]} in parameters


def test_syncing_and_copying_link_do_not_extend_its_boundary(shared_conversation):
    client, thread, messages, _container = shared_conversation
    token = client.post("/api/chat/thread/thread-1/share?user_id=owner-1").json()["share_token"]
    messages.append({**messages[0], "id": "private-reply", "content": "Private later answer."})

    cosmos_db.sync_threads_batch([{"id": "thread-1", "agentId": "course-example", "name": "Renamed later"}], "owner-1")
    copied_token = client.post("/api/chat/thread/thread-1/share?user_id=owner-1").json()["share_token"]

    assert copied_token == token
    assert thread["sharedMessageIds"] == ["reply-1"]
    assert thread["sharedTitle"] == "Shared lesson"
    assert [message["id"] for message in client.get(f"/api/shared/{token}").json()["messages"]] == ["reply-1"]


def test_revocation_removes_shared_boundary_and_resharing_captures_new_point(shared_conversation):
    client, thread, messages, _container = shared_conversation
    token = client.post("/api/chat/thread/thread-1/share?user_id=owner-1").json()["share_token"]
    messages.append({**messages[0], "id": "new-reply", "content": "A later explanation."})

    assert client.delete("/api/chat/thread/thread-1/share?user_id=owner-1").json()["success"] is True
    assert client.get(f"/api/shared/{token}").status_code == 404
    assert "sharedMessageIds" not in thread
    assert "sharedTitle" not in thread
    new_token = client.post("/api/chat/thread/thread-1/share?user_id=owner-1").json()["share_token"]

    assert new_token != token
    assert thread["sharedMessageIds"] == ["reply-1", "new-reply"]


def test_empty_shared_boundary_never_includes_later_messages(shared_conversation):
    client, thread, messages, container = shared_conversation
    initial_message = deepcopy(messages[0])
    messages.clear()
    token = cosmos_db.create_share_token_for_thread("thread-1", "owner-1")
    assert thread["sharedMessageIds"] == []
    messages.append(initial_message)
    container.query_items.reset_mock()

    response = client.get(f"/api/shared/{token}")

    assert response.status_code == 200
    assert response.json()["messages"] == []
    container.query_items.assert_not_called()


@pytest.mark.parametrize("shared_at", [None, "", "not-a-date", "2026-01-01T10:02:00"])
def test_legacy_link_without_valid_boundary_fails_closed(shared_conversation, shared_at):
    client, thread, _messages, container = shared_conversation
    thread.update(shareToken="example-existing-share", sharedAt=shared_at)

    response = client.get("/api/shared/example-existing-share")

    assert response.status_code == 200
    assert response.json()["messages"] == []
    container.query_items.assert_not_called()


def test_shared_boundary_read_failure_does_not_fall_back_to_live_history(shared_conversation):
    client, _thread, _messages, container = shared_conversation
    token = client.post("/api/chat/thread/thread-1/share?user_id=owner-1").json()["share_token"]
    container.query_items.side_effect = RuntimeError("internal-storage-detail")

    response = client.get(f"/api/shared/{token}")

    assert response.status_code == 500
    assert response.json() == {"detail": "Unable to load shared chat"}


def test_share_waits_for_the_expected_assistant_message(shared_conversation):
    _client, thread, _messages, _container = shared_conversation
    with pytest.raises(ValueError, match="finished saving"):
        cosmos_db.create_share_token_for_thread("thread-1", "owner-1", expected_message_ids=["reply-1", "unsaved-reply"])
    assert "shareToken" not in thread


def test_explicit_refresh_includes_only_the_confirmed_selection(shared_conversation):
    _client, thread, messages, _container = shared_conversation
    token = cosmos_db.create_share_token_for_thread("thread-1", "owner-1", expected_message_ids=["reply-1"])
    messages.extend([
        {**messages[0], "id": "reply-2", "content": "A response the owner selected."},
        {**messages[0], "id": "private-reply", "content": "Not selected."},
    ])
    assert cosmos_db.create_share_token_for_thread("thread-1", "owner-1") == token
    assert thread["sharedMessageIds"] == ["reply-1"]
    refreshed = cosmos_db.create_share_token_for_thread(
        "thread-1", "owner-1", expected_message_ids=["reply-1", "reply-2"], refresh=True,
    )
    assert refreshed == token
    assert thread["sharedMessageIds"] == ["reply-1", "reply-2"]


def test_share_requires_authenticated_owner(shared_conversation):
    client, thread, _messages, _container = shared_conversation
    main.app.dependency_overrides.clear()
    assert client.post("/api/chat/thread/thread-1/share?user_id=owner-1").status_code == 401
    main.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="outsider", role="teacher", status="active")
    assert client.post("/api/chat/thread/thread-1/share?user_id=owner-1").status_code == 403
    assert client.delete("/api/chat/thread/thread-1/share?user_id=owner-1").status_code == 403
    assert "shareToken" not in thread


def test_refresh_route_includes_confirmed_answer_without_rotating_link(shared_conversation):
    client, thread, messages, _container = shared_conversation
    token = client.post("/api/chat/thread/thread-1/share?user_id=owner-1").json()["share_token"]
    messages.append({**messages[0], "id": "reply-2", "content": "New answer"})
    response = client.post("/api/chat/thread/thread-1/share", json={"message_ids": ["reply-1", "reply-2"], "refresh": True})
    assert response.status_code == 200
    assert response.json()["share_token"] == token
    assert thread["sharedMessageIds"] == ["reply-1", "reply-2"]


def test_new_share_requires_a_confirmed_nonempty_selection(shared_conversation):
    client, thread, _messages, _container = shared_conversation
    assert client.post("/api/chat/thread/thread-1/share", json={"message_ids": []}).status_code == 422
    assert client.post("/api/chat/thread/thread-1/share", json={"message_ids": ["unsaved"]}).status_code == 409
    assert "shareToken" not in thread
