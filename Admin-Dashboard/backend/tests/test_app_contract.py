import asyncio
import hashlib
import json
from dataclasses import replace
from threading import Event
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from admin_backend.app import create_app
from admin_backend.core.contracts import DashboardRepository
from admin_backend.core.settings import ConfigurationError, clear_settings_cache
from admin_backend.dependencies import get_services


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def test_complete_openapi_and_ordered_routes_match_pre_refactor_baseline(admin_services):
    app = create_app(admin_services)
    routes = [
        {"path": route.path, "methods": sorted(route.methods or ())}
        for route in app.routes if hasattr(route, "methods")
    ]
    assert len(routes) == 47
    assert digest(routes) == "c0d2a1f40763e17123c1110996e30daa7b09763888cf54c6319698776040c2d8"
    assert digest(app.openapi()) == "978d733bd0041e2b6cbcf902c3ca9344cb1f0d0bdcde6edd7f341db5eca2e6fa"


def test_factory_uses_injected_services_without_constructing_adapters(monkeypatch, admin_services):
    from admin_backend import app as assembly

    build = Mock(side_effect=AssertionError("Live adapters must not be constructed"))
    monkeypatch.setattr(assembly, "build_services", build)
    app = create_app(admin_services)
    admin_services.queries.list_agents.return_value = [{"id": "course-test"}]
    with TestClient(app) as client:
        assert client.get("/api/dashboard/health").json() == {
            "status": "ok", "service": "ekalaiva-dashboard",
        }
        assert client.get("/api/dashboard/agents").json() == {
            "agents": [{"id": "course-test"}], "count": 1,
        }
        assert client.get("/api/directory").json() == []
    build.assert_not_called()


def test_factories_and_dependency_overrides_do_not_share_services(admin_services):
    first = create_app(admin_services)
    other_queries = Mock(spec=DashboardRepository)
    other_queries.list_agents.return_value = [{"id": "other-course"}]
    other_services = replace(admin_services, queries=other_queries)
    second = create_app(other_services)
    assert first.state.services is not second.state.services
    with TestClient(first) as first_client, TestClient(second) as second_client:
        assert first_client.get("/api/dashboard/agents").json()["count"] == 0
        assert second_client.get("/api/dashboard/agents").json()["count"] == 1
        first.dependency_overrides[get_services] = lambda: other_services
        assert first_client.get("/api/dashboard/agents").json()["count"] == 1
        first.dependency_overrides.clear()
        assert first_client.get("/api/dashboard/agents").json()["count"] == 0


def test_injection_does_not_bypass_startup_validation(monkeypatch, admin_services):
    monkeypatch.delenv("LOGGING_AGENT_NAME")
    with pytest.raises(ConfigurationError, match="LOGGING_AGENT_NAME"):
        with TestClient(create_app(admin_services)):
            pytest.fail("Startup accepted missing core configuration")


def test_evaluator_lifecycle_cancels_only_its_injected_worker(monkeypatch, admin_services):
    for key, value in {
        "EVAL_ENABLED": "true",
        "AZURE_AI_SEARCH_ENDPOINT": "https://search.example.invalid",
        "COMMON_INDEX_NAME": "test-index",
        "AZURE_EVAL_MODEL": "test-evaluation",
    }.items():
        monkeypatch.setenv(key, value)
    clear_settings_cache()
    started = Event()
    stopped = Event()

    async def worker(runtime):
        assert runtime.eval_enabled
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(admin_services.evaluation, "run_periodic", worker)
    with pytest.raises(RuntimeError, match="exit test context"):
        with TestClient(create_app(admin_services)) as client:
            assert started.wait(2)
            assert client.get("/api/dashboard/health").status_code == 200
            raise RuntimeError("exit test context")
    assert stopped.wait(2)
    admin_services.evaluation.backend().evaluate_and_store_groundedness.assert_not_called()


def test_quota_wire_contract_bounds_and_costs(admin_services):
    admin_services.queries.get_image_quota_config.return_value = {"medium": 2, "low": 4}
    admin_services.queries.set_image_quota_config.return_value = {"medium": 2, "low": 4}
    with TestClient(create_app(admin_services)) as client:
        expected = {
            "limits": {"medium": 2, "low": 4},
            "costPerImageUsd": {"medium": 0.0551, "low": 0.0065},
            "estimatedWeeklyUsdPerStudent": 0.1362,
            "estimatedMonthlyUsdPerStudent": 0.59,
        }
        assert client.get("/api/dashboard/image-quota").json() == expected
        assert client.put("/api/dashboard/image-quota", json={"medium": 2}).json() == expected
        assert client.put("/api/dashboard/image-quota", json={}).status_code == 400
        for value in (-1, 1001):
            assert client.put("/api/dashboard/image-quota", json={"low": value}).status_code == 422
        assert client.put("/api/dashboard/image-quota", json={"low": 0}).status_code == 200
        assert client.put("/api/dashboard/image-quota", json={"low": 1000}).status_code == 200
    assert admin_services.queries.set_image_quota_config.call_args_list[0].args == ({"medium": 2},)


def test_analytics_feedback_and_progress_use_injected_queries(admin_services):
    queries = admin_services.queries
    queries.courses_overview.return_value = ([{"agentId": "course-test"}], 7)
    queries.today_stats.return_value = {"rounds": 3}
    queries.per_student_token_usage.return_value = [{"userId": "learner", "totalTokens": 42}]
    queries.agent_overview.return_value = {"student_count": 1}
    queries.agent_usage_stats.return_value = {"active_students": 1}
    queries.student_detail.return_value = None
    queries.list_feedback.return_value = [{"id": "feedback-test"}]
    queries.get_feedback_stats.return_value = {"count": 1}
    with TestClient(create_app(admin_services)) as client:
        assert client.get("/api/dashboard/overview/courses").json() == {
            "courses": [{"agentId": "course-test"}], "uniqueTotalUsers": 7,
        }
        assert client.get("/api/dashboard/overview/tokens").json() == {"tokens": {}}
        assert client.get("/api/dashboard/overview/tokens/per-student?agent_id=course-test").json() == {
            "students": [{"userId": "learner", "totalTokens": 42}],
        }
        assert client.get("/api/dashboard/overview/today?start_date=2026-09-01&end_date=2026-09-02").json() == {
            "rounds": 3,
        }
        assert client.get("/api/dashboard/agents/course-test/overview").json() == {
            "student_count": 1, "usage": {"active_students": 1},
        }
        assert client.get("/api/dashboard/agents/course-test/students/missing").status_code == 404
        assert client.get("/api/dashboard/feedback?limit=1").json() == {
            "feedback": [{"id": "feedback-test"}], "count": 1, "stats": {"count": 1},
        }
    queries.today_stats.assert_called_once_with(start_date="2026-09-01", end_date="2026-09-02")
    queries.per_student_token_usage.assert_called_once_with(agent_id="course-test")
    queries.list_feedback.assert_called_once_with(limit=1)


@pytest.mark.parametrize("url", [
    "http://teststorage.blob.core.windows.net/feedback-attachments/a.png",
    "https://elsewhere.blob.core.windows.net/feedback-attachments/a.png",
    "https://teststorage.blob.core.windows.net@elsewhere.invalid/feedback-attachments/a.png",
    "https://teststorage.blob.core.windows.net/private/a.png",
    "https://teststorage.blob.core.windows.net/feedback-attachments/../private.png",
    "https://teststorage.blob.core.windows.net/feedback-attachments",
])
def test_attachment_policy_rejects_before_downloading(admin_services, url):
    with TestClient(create_app(admin_services)) as client:
        assert client.get("/api/dashboard/blob/proxy", params={"url": url}).status_code == 400
    admin_services.attachments.download.assert_not_called()


def test_attachment_stream_preserves_media_type_and_headers(admin_services):
    with TestClient(create_app(admin_services)) as client:
        response = client.get("/api/dashboard/blob/proxy", params={
            "url": "https://teststorage.blob.core.windows.net/feedback-attachments-v1/a.png",
        })
    assert response.content == b"offline-image"
    assert response.headers["content-type"] == "image/png"
    assert response.headers["content-length"] == "13"
    assert response.headers["cache-control"] == "public, max-age=86400"
    admin_services.attachments.download.assert_called_once_with("feedback-attachments-v1", "a.png")


@pytest.mark.parametrize(("is_new", "affiliation_added", "status"), [
    (True, False, 201), (False, True, 200), (False, False, 200),
])
def test_directory_invitation_status_and_flags(admin_services, is_new, affiliation_added, status):
    admin_services.queries.invite_user.return_value = (
        {"id": "user-test", "email": "user@example.com", "fullName": "Example"},
        is_new, affiliation_added,
    )
    with TestClient(create_app(admin_services)) as client:
        response = client.post("/api/directory", json={"email": "user@example.com"})
    assert response.status_code == status
    assert response.json()["affiliationAdded"] is affiliation_added
    assert response.json()["alreadyExists"] is (not is_new and not affiliation_added)
    assert response.json()["name"] == "Example"


def test_directory_and_course_business_errors_keep_http_statuses(admin_services):
    with TestClient(create_app(admin_services)) as client:
        assert client.patch("/api/directory/missing", json={"name": "Example"}).status_code == 404
        assert client.delete("/api/directory/missing").status_code == 404
        assert client.get("/api/user/missing").status_code == 404
        assert client.get("/api/dashboard/agents/missing/teachers").status_code == 404
        assert client.post(
            "/api/dashboard/agents/course/transfer-ownership", json={"new_owner_id": "   "},
        ).json() == {"detail": "new_owner_id is required"}
        assert client.post(
            "/api/dashboard/agents/course/teachers", json={"teacher_ids": "not-a-list"},
        ).status_code == 400


def test_chat_sse_order_aliases_headers_and_error_redaction(admin_services):
    events = [
        ("thread_id", "conversation-new", "conversation-new"),
        ("message_block_start", "", "conversation-new"),
        ("message_block_delta", '{"delta":"hello"}', "conversation-new"),
        ("message_block", '{"content":"hello"}', "conversation-new"),
        ("delta", "plain", "conversation-new"),
        ("error", "upstream-private-text", "conversation-new"),
        ("done", "", "conversation-new"),
    ]
    stream = Mock(return_value=iter(events))
    services = replace(admin_services, chat_stream=stream)
    with TestClient(create_app(services)) as client:
        assert client.options("/api/dashboard/logging-agent/chat/stream").json() == {}
        assert client.post("/api/dashboard/logging-agent/chat/stream", json={}).status_code == 400
        response = client.post("/api/dashboard/logging-agent/chat/stream", json={
            "text": "Hello", "thread_id": "preferred", "conversation_id": "other",
        })
    stream.assert_called_once_with("Hello", "preferred")
    decoded = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
    assert [event["type"] for event in decoded] == [event[0] for event in events]
    assert all(event["thread_id"] == event["conversation_id"] == "conversation-new" for event in decoded)
    assert decoded[2]["delta"] == "hello"
    assert decoded[3]["content"] == "hello"
    assert decoded[5]["error"] == "Internal error"
    assert "upstream-private-text" not in response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["connection"] == "keep-alive"
    assert response.headers["x-accel-buffering"] == "no"


def test_evaluation_endpoints_call_only_injected_backend(admin_services):
    backend = admin_services.evaluation.backend()
    backend._retrieve_context_from_search.return_value = "offline context"
    admin_services.queries.get_groundedness_evaluation.return_value = None
    with TestClient(create_app(admin_services)) as client:
        assert client.post("/api/dashboard/evaluation/groundedness", json={
            "query": "q", "response": "r", "method": None,
        }).json() == {"ok": True, "groundedness_score": 4}
        assert client.post("/api/dashboard/evaluation/rag", json={
            "query": "q", "response": "r", "session_uuid": "session-test",
        }).json() == {"ok": True, "overall_score": 3}
        assert client.post("/api/dashboard/evaluation/rag", json={
            "query": "q", "response": "r",
        }).status_code == 400
        assert client.post("/api/dashboard/evaluation/groundedness/trigger", json={}).status_code == 400
        assert client.get("/api/dashboard/evaluation/groundedness/missing?session_id=test").status_code == 404
        # Keep the pre-existing dynamic-route precedence, rather than silently fixing it.
        assert client.get("/api/dashboard/evaluation/groundedness/all").status_code == 422
    backend.evaluate_groundedness.assert_called_once_with(
        query="q", response="r", session_uuid=None, context=None, method="auto",
    )
    backend.evaluate_rag_metrics.assert_called_once_with(query="q", response="r", context="offline context")


def test_research_routes_schedule_injected_jobs_and_keep_already_running_guard(admin_services):
    store = admin_services.research.storage
    with TestClient(create_app(admin_services)) as client:
        response = client.post("/api/dashboard/directory/institutes/research", json={
            "name": " Example Institute ", "instructions": "offline",
        })
        assert response.json() == {"status": "researching", "institute": "Example Institute"}
        assert store.save_institute_research.call_args_list[0].args[1]["status"] == "researching"
        assert store.save_institute_research.call_args_list[1].args[1]["status"] == "completed"
        store.get_institute_research.return_value = {"status": "researching"}
        assert client.post("/api/dashboard/directory/institutes/research", json={
            "name": "Example Institute",
        }).json()["status"] == "already_researching"
        assert client.post("/api/dashboard/directory/departments/research", json={
            "institute": "Example Institute", "department": " ",
        }).status_code == 400
    admin_services.research.respond.assert_called_once()
