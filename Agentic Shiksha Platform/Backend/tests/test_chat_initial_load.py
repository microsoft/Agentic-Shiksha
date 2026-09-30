from unittest.mock import Mock
import json

import pytest
from fastapi.testclient import TestClient

from backend import main
from azure_services.persistence import cosmos_db
from backend.dependencies import agent_access, auth


def test_chat_stream_usage_event_keeps_request_payload_available(monkeypatch):
    class FakeAgent:
        def start_chat_stream(self, **_kwargs):
            yield "message_block", json.dumps({"content": "Hello from the agent."}), "conversation-1"
            yield "usage", json.dumps({"total_tokens": 2, "rounds": 1}), "conversation-1"
            yield "done", "", "conversation-1"

    persisted_usage_event_ids = []
    monkeypatch.setattr(auth, "verify_token", lambda _token: {"sub": "example-user"})
    monkeypatch.setattr(auth, "load_profile", lambda _uid: {"id": "example-user", "role": "student", "status": "active"})
    monkeypatch.setattr(agent_access, "load_agent", lambda name: {"id": name, "studentIds": ["example-user"]})
    monkeypatch.setattr(main, "_load_setup_json", lambda _agent_id: {})
    monkeypatch.setattr(main, "get_general_agent", lambda **_kwargs: FakeAgent())
    monkeypatch.setattr(main, "with_suggested_queries", lambda stream, _agent, _text: stream)
    monkeypatch.setattr(main, "_record_inferred_progress", lambda **_kwargs: None)
    monkeypatch.setattr(
        main,
        "_persist_stream_token_usage",
        lambda **kwargs: persisted_usage_event_ids.append(kwargs["usage_event_id"]),
    )

    response = TestClient(main.app).post(
        "/api/agents/course-example/chat/stream",
        headers={"Authorization": "Bearer example-session"},
        json={
            "text": "Hello",
            "user_id": "example-user",
            "inject_profile": False,
            "usage_event_id": "usage-1",
        },
    )

    assert response.status_code == 200
    assert '"type": "message_block"' in response.text
    assert '"type": "usage"' in response.text
    assert '"type": "done"' in response.text
    assert '"type": "error"' not in response.text
    assert persisted_usage_event_ids == ["usage-1"]


@pytest.fixture
def answer_depth_agent(monkeypatch):
    agent = Mock()
    events = [("done", "", "conversation-1")]
    agent.start_chat_stream.side_effect = lambda **_kwargs: iter(events)
    agent.continue_chat_stream.side_effect = lambda **_kwargs: iter(events)
    monkeypatch.setattr(auth, "verify_token", lambda _token: {"sub": "example-user"})
    monkeypatch.setattr(auth, "load_profile", lambda _uid: {"id": "example-user", "role": "student", "status": "active"})
    monkeypatch.setattr(agent_access, "load_agent", lambda name: {"id": name, "studentIds": ["example-user"]})
    monkeypatch.setattr(main, "_load_setup_json", lambda _agent_id: {})
    monkeypatch.setattr(main, "get_general_agent", lambda **_kwargs: agent)
    monkeypatch.setattr(main, "with_suggested_queries", lambda stream, _agent, _text: stream)
    monkeypatch.setattr(main, "_record_inferred_progress", lambda **_kwargs: None)
    return agent


@pytest.mark.parametrize("transport", ["stream", "agui"])
@pytest.mark.parametrize("continuation", [False, True])
@pytest.mark.parametrize("depth", [None, "quick", "balanced", "detailed"])
def test_chat_answer_depth_is_validated_and_forwarded(answer_depth_agent, transport, continuation, depth):
    payload = {
        "text": "Explain voltage.",
        "user_id": "example-user",
        "inject_profile": False,
    }
    if depth is not None:
        payload["answer_depth"] = depth
    if continuation:
        payload["thread_id"] = "conversation-1"
    response = TestClient(main.app).post(
        f"/api/agents/course-example/chat/{transport}",
        headers={"Authorization": "Bearer example-test-token"},
        json=payload,
    )
    assert response.status_code == 200
    method = answer_depth_agent.continue_chat_stream if continuation else answer_depth_agent.start_chat_stream
    method.assert_called_once()
    assert method.call_args.kwargs["answer_depth"] == (depth or "balanced")
    assert method.call_args.kwargs["user_text"] == "Explain voltage."
    assert method.call_args.kwargs["user_id"] == "example-user"


@pytest.mark.parametrize("transport", ["stream", "agui"])
@pytest.mark.parametrize("depth", [None, "", "Quick", "unlimited", 1, [], {}])
def test_chat_answer_depth_rejects_invalid_values_before_starting_a_stream(answer_depth_agent, transport, depth):
    response = TestClient(main.app).post(
        f"/api/agents/course-example/chat/{transport}",
        headers={"Authorization": "Bearer example-test-token"},
        json={
            "text": "Explain voltage.", "user_id": "example-user",
            "inject_profile": False, "answer_depth": depth,
        },
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "answer_depth must be quick, balanced, or detailed"}
    answer_depth_agent.start_chat_stream.assert_not_called()
    answer_depth_agent.continue_chat_stream.assert_not_called()


def test_recent_message_hydration_uses_bounded_partition_query(monkeypatch):
    captured = {}

    class FakeMessagesContainer:
        def query_items(self, **kwargs):
            captured.update(kwargs)
            return []

    monkeypatch.setattr(
        cosmos_db,
        "_get_containers",
        lambda: (object(), FakeMessagesContainer()),
    )

    assert cosmos_db.get_recent_messages_for_user("user-1", 10) == []
    assert "SELECT TOP 200" in captured["query"]
    assert captured["partition_key"] == "user-1"


@pytest.mark.parametrize(
    ("threads_saved", "messages_saved"),
    [(True, True), (True, False), (False, True), (False, False)],
)
def test_sync_acknowledges_only_complete_writes(monkeypatch, threads_saved, messages_saved):
    threads = Mock()
    threads.read_item.return_value = {}
    messages = Mock()
    if not threads_saved:
        threads.upsert_item.side_effect = RuntimeError("internal-storage-detail")
    if not messages_saved:
        messages.upsert_item.side_effect = RuntimeError("internal-storage-detail")
    monkeypatch.setattr(cosmos_db, "_get_containers", lambda: (threads, messages))
    blocks = [{"type": "text", "content": "Course aims and learning outcomes."}]

    response = TestClient(main.app).post("/api/chat/sync", json={
        "userId": "user-1",
        "threads": [{"id": "thread-1", "agentId": "course-example", "name": "Course aims"}],
        "messages": [{
            "id": "reply-1", "threadId": "thread-1", "role": "assistant", "content": "",
            "metadata": {"contentBlocks": blocks},
        }],
    })

    assert response.status_code == 200
    result = response.json()
    assert result["success"] is (threads_saved and messages_saved)
    assert result["threadsUpserted"] == int(threads_saved)
    assert result["messagesUpserted"] == int(messages_saved)
    assert bool(result["error"]) is not (threads_saved and messages_saved)
    assert "internal-storage-detail" not in response.text
    assert messages.upsert_item.call_args.kwargs["body"]["metadata"]["contentBlocks"] == blocks


def test_sync_failure_response_does_not_expose_storage_exception(monkeypatch):
    monkeypatch.setattr(main, "sync_threads_batch", Mock(side_effect=RuntimeError("internal-storage-detail")))

    response = TestClient(main.app).post("/api/chat/sync", json={
        "userId": "user-1", "threads": [], "messages": [],
    })

    assert response.status_code == 200
    assert response.json()["success"] is False
    assert response.json()["error"]
    assert "internal-storage-detail" not in response.text