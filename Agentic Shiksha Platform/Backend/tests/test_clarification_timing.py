from concurrent.futures import ThreadPoolExecutor
import json
import threading
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.routers.clarification import router
from utils import clarification_registry as registry


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(registry, "time", Mock(monotonic=lambda: now[0], time=lambda: now[0] + 1_700_000_000))
    yield now
    with registry._changed:
        registry._pending.clear()
        registry._changed.notify_all()


@pytest.fixture
def clarification(clock):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="student-1", role="student", status="active")
    clarify_id = registry.register("student-1", 2)
    return TestClient(app), clarify_id, clock


def test_answer_window_has_a_separate_ten_second_decision_window(clarification):
    client, clarify_id, clock = clarification
    first = client.get(f"/api/clarify/{clarify_id}")
    assert first.status_code == 200
    data = first.json()
    assert data["phase"] == "answering"
    assert data["answer_deadline_ms"] - data["server_now_ms"] == 60_000
    assert data["decision_deadline_ms"] - data["answer_deadline_ms"] == 10_000
    assert first.headers["cache-control"] == "private, no-store"
    clock[0] += 60
    assert client.get(f"/api/clarify/{clarify_id}").json()["phase"] == "decision"
    clock[0] += 9.999
    assert client.get(f"/api/clarify/{clarify_id}").status_code == 200
    clock[0] += .001
    assert client.get(f"/api/clarify/{clarify_id}").status_code == 410


def test_more_time_resets_sixty_seconds_and_retains_saved_answers(clarification):
    client, clarify_id, clock = clarification
    draft = [{"answer": "Home appliance"}, {"answer": ""}]
    assert client.patch(f"/api/clarify/{clarify_id}", json={"answers": draft}).status_code == 200
    clock[0] += 65
    response = client.post(f"/api/clarify/{clarify_id}/extend", json={"revision": 0})
    assert response.status_code == 200
    result = response.json()
    assert result["revision"] == 1
    assert result["phase"] == "answering"
    assert result["answer_deadline_ms"] - result["server_now_ms"] == 60_000
    assert result["decision_deadline_ms"] - result["server_now_ms"] == 70_000
    assert result["answers"] == draft
    clock[0] += 60
    assert client.get(f"/api/clarify/{clarify_id}").json()["phase"] == "decision"


def test_repeated_extension_request_does_not_add_time_twice(clarification):
    client, clarify_id, clock = clarification
    assert client.post(f"/api/clarify/{clarify_id}/extend", json={"revision": 0}).status_code == 409
    clock[0] += 60
    assert client.post(f"/api/clarify/{clarify_id}/extend", json={"revision": 0}).status_code == 200
    clock[0] += 60
    assert client.post(f"/api/clarify/{clarify_id}/extend", json={"revision": 0}).status_code == 409
    assert client.post(f"/api/clarify/{clarify_id}/extend", json={"revision": 1}).status_code == 200


@pytest.mark.parametrize("offset", [0, 60, 69.999])
def test_answers_or_defaults_can_resume_during_either_window(clarification, offset):
    client, clarify_id, clock = clarification
    clock[0] += offset
    answers = [{"answer": "Industrial control"}, {"answer": ""}]
    response = client.post(f"/api/clarify/{clarify_id}", json={"answers": answers})
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "answers": 2}
    assert registry.wait(clarify_id) == answers
    assert client.post(f"/api/clarify/{clarify_id}", json={"answers": answers}).status_code == 410


def test_expiration_keeps_partial_answers_for_defaults(clarification):
    client, clarify_id, clock = clarification
    answers = [{"answer": "Solar system"}, {"answer": ""}]
    client.patch(f"/api/clarify/{clarify_id}", json={"answers": answers})
    clock[0] += 70
    assert registry.wait(clarify_id) == answers
    assert client.get(f"/api/clarify/{clarify_id}").status_code == 410


def test_no_choice_and_no_answers_returns_defaults(clarification):
    _client, clarify_id, clock = clarification
    clock[0] += 70
    assert registry.wait(clarify_id) is None


def test_live_wait_does_not_resume_at_sixty_and_extension_wakes_it_safely(clock, monkeypatch):
    clarify_id = registry.register("student-1", 1)
    sleeping = threading.Event()
    original_wait = registry._changed.wait

    def observed_wait(timeout):
        sleeping.set()
        return original_wait(timeout)

    monkeypatch.setattr(registry._changed, "wait", observed_wait)
    with ThreadPoolExecutor(max_workers=1) as pool:
        waiting = pool.submit(registry.wait, clarify_id)
        assert sleeping.wait(1)
        try:
            clock[0] += 60
            assert not waiting.done()
            sleeping.clear()
            registry.extend(clarify_id, "student-1", 0)
            assert sleeping.wait(1)
            clock[0] += 10
            assert not waiting.done()
            registry.submit(clarify_id, "student-1", [{"answer": "Selected"}])
            assert waiting.result(timeout=1) == [{"answer": "Selected"}]
        finally:
            registry.cancel(clarify_id)


@pytest.mark.parametrize("method,suffix,body", [
    ("get", "", None), ("patch", "", {"answers": [{"answer": ""}, {"answer": ""}]}),
    ("post", "", {"answers": [{"answer": ""}, {"answer": ""}]}),
    ("post", "/extend", {"revision": 0}),
])
def test_clarification_actions_require_the_active_owner(clarification, method, suffix, body):
    client, clarify_id, _clock = clarification
    client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="another-user", role="admin", status="active")
    kwargs = {"json": body} if body is not None else {}
    response = getattr(client, method)(f"/api/clarify/{clarify_id}{suffix}", **kwargs)
    assert response.status_code == 403
    client.app.dependency_overrides.clear()
    assert getattr(client, method)(f"/api/clarify/{clarify_id}{suffix}", **kwargs).status_code == 401


@pytest.mark.parametrize("method,suffix,body", [
    ("patch", "", {"answers": [{"answer": "late"}, {"answer": ""}]}),
    ("post", "", {"answers": [{"answer": "late"}, {"answer": ""}]}),
    ("post", "/extend", {"revision": 0}),
])
def test_late_requests_cannot_resurrect_a_timed_out_clarification(clarification, method, suffix, body):
    client, clarify_id, clock = clarification
    clock[0] += 70
    assert getattr(client, method)(f"/api/clarify/{clarify_id}{suffix}", json=body).status_code == 410
    assert registry.wait(clarify_id) is None


@pytest.mark.parametrize("body", [
    {"answers": []}, {"answers": [{"answer": "missing position"}]},
    {"answers": [{"answer": 7}, {"answer": ""}]},
    {"answers": [{"answer": "x" * 4001}, {"answer": ""}]},
    {"answers": [{"answer": ""}, {"answer": ""}], "user_id": "another-user"},
])
def test_invalid_answers_are_rejected_without_resuming(clarification, body):
    client, clarify_id, _clock = clarification
    assert client.post(f"/api/clarify/{clarify_id}", json=body).status_code == 422
    assert client.get(f"/api/clarify/{clarify_id}").json()["answers"] == []


def test_errors_do_not_claim_answer_delivery_or_expose_internals(clarification, monkeypatch):
    client, clarify_id, _clock = clarification
    monkeypatch.setattr(registry, "submit", Mock(side_effect=RuntimeError("private service details")))
    response = client.post(f"/api/clarify/{clarify_id}", json={"answers": [{"answer": ""}, {"answer": ""}]})
    assert response.status_code == 503
    assert "private" not in response.text


def test_cancel_releases_a_waiter_immediately(monkeypatch):
    clarify_id = registry.register("student-1", 1)
    sleeping = threading.Event()
    original_wait = registry._changed.wait

    def observed_wait(timeout):
        sleeping.set()
        return original_wait(timeout)

    monkeypatch.setattr(registry._changed, "wait", observed_wait)
    with ThreadPoolExecutor(max_workers=1) as pool:
        waiting = pool.submit(registry.wait, clarify_id)
        assert sleeping.wait(1)
        registry.cancel(clarify_id)
        assert waiting.result(timeout=1) is None


def test_active_extensions_are_not_swept_as_abandoned(clock):
    clarify_id = registry.register("student-1", 1)
    for revision in range(6):
        clock[0] += 60
        registry.extend(clarify_id, "student-1", revision)
    registry.register("student-2", 1)
    assert registry.status(clarify_id, "student-1")["revision"] == 6


def test_runtime_registers_owner_and_emits_resume_event(monkeypatch):
    from backend import main
    from harness import runtime

    agent = runtime.GeneralAgent.__new__(runtime.GeneralAgent)
    agent.agent_name = "course-example"
    questions = [{"question": "Which topic?", "options": ["One", "Two", "Three", "Four"]}]
    result = agent._dispatch_tool_call("ask_clarification", json.dumps({"questions": questions}), "call-1", "conversation-1", "student-1")
    event_type, payload, conversation = result["yield_events"][0]
    assert event_type == "clarify"
    clarify_id = json.loads(payload)["clarifyId"]
    try:
        assert registry.status(clarify_id, "student-1")["phase"] == "answering"
        registry.submit(clarify_id, "student-1", [{"answer": "Two"}])
        resumed = list(agent._resolve_clarification(result, conversation))
        assert resumed == [("clarification_done", json.dumps({"clarifyId": clarify_id}), "conversation-1")]
        assert "Two" in result["output"]
        assert not any(route.path == "/api/clarify/{clarify_id}" and route.endpoint.__module__ == main.__name__ for route in main.app.routes)
    finally:
        registry.cancel(clarify_id)


def test_agui_preserves_the_clarification_resume_identity():
    from backend.agui import AGUITranslator

    events = list(AGUITranslator("conversation-1").run([
        ("clarification_done", json.dumps({"clarifyId": "clarify-example"}), "conversation-1"),
    ]))
    assert events[-1] == {"type": "CUSTOM", "name": "clarification_done", "value": {"clarifyId": "clarify-example"}}
