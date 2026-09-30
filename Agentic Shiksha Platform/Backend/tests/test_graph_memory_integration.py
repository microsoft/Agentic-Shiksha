"""Ingress, tool isolation and assessment adapters never delegate state authority."""

import asyncio
import concurrent.futures
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from starlette.requests import Request

from backend.dependencies import agent_access
from backend.dependencies.auth import ActiveUser
from backend.dependencies.learner_access import LearnerAccess
from backend.routers import assessments, chat
from backend.schemas.learner_memory import MemoryScope, ProcessingReceipt
from learner_memory import integration, settings


def memory_context(student="student-a"):
    return integration.MemoryToolContext(
        scope=MemoryScope(
            tenant_id="tenant-a", institute_id="institute-a", course_id="course-a",
            student_id=student, curriculum_id="curriculum-a", curriculum_version="1",
        ),
        actor_id=student, mode="authoritative", event_id="turn-a", agent_version="7",
    )


def request():
    return Request({"type": "http", "headers": [], "method": "POST", "path": "/"})


@pytest.fixture
def memory(monkeypatch):
    context = memory_context()
    user = ActiveUser(id="student-a", role="student", status="active")
    fake = Mock()
    fake.accept_event.return_value = ProcessingReceipt(
        event_id="turn-a", scope=context.scope, sequence=1,
    )
    fake.context.return_value = {"scope_ref": context.scope.partition_key, "nodes": []}
    monkeypatch.setattr(settings, "get_memory_settings", lambda: settings.MemorySettings(enabled=True))
    monkeypatch.setattr(integration, "_service", lambda: fake)
    record = {"id": "course-a", "graph_memory_mode": "authoritative"}
    monkeypatch.setattr(agent_access, "load_agent", Mock(return_value=record))
    monkeypatch.setattr(integration, "resolve_learner_access", Mock(return_value=LearnerAccess(context.scope, user, record, "authoritative")))
    monkeypatch.setattr(integration, "verify_hosted_memory_disabled", Mock(return_value="7"))
    return SimpleNamespace(context=context, user=user, service=fake)


def test_disabled_ingress_has_no_metadata_or_service_io(monkeypatch):
    monkeypatch.setattr(settings, "get_memory_settings", lambda: settings.MemorySettings())
    load = Mock(side_effect=AssertionError("disabled path queried metadata"))
    monkeypatch.setattr(agent_access, "load_agent", load)
    result = integration.capture_chat(
        "course-a", ActiveUser(id="student-a", role="student", status="active"),
        event_id=None, occurred_at=None, text="Hello",
    )
    assert result == (None, None)
    load.assert_not_called()


def test_capture_is_stable_learner_only_input(memory):
    timestamp = datetime(2026, 9, 29, tzinfo=timezone.utc)
    kwargs = dict(event_id="turn-a", occurred_at=timestamp, text="My explanation", thread_id="conversation-a")
    started = datetime.now(timezone.utc)
    first, _ = integration.capture_chat("course-a", memory.user, **kwargs)
    integration.capture_chat("course-a", memory.user, **kwargs)
    calls = memory.service.accept_event.call_args_list
    assert calls[0].args[1].model_dump(exclude={"occurred_at"}) == calls[1].args[1].model_dump(exclude={"occurred_at"})
    assert all(started <= call.args[1].occurred_at <= datetime.now(timezone.utc) for call in calls)
    event = calls[0].args[1]
    assert str(event.source) == "LEARNER_CHAT"
    assert event.answer == "My explanation"
    assert not event.tc_ids and not event.problem_ids
    assert first.scope.student_id == "student-a"


@pytest.mark.parametrize("event_id,moment", [(None, None), (None, datetime.now(timezone.utc))])
def test_enabled_capture_requires_stable_client_identity(memory, event_id, moment):
    with pytest.raises(HTTPException) as denied:
        integration.capture_chat("course-a", memory.user, event_id=event_id, occurred_at=moment, text="answer")
    assert denied.value.status_code == 422
    memory.service.accept_event.assert_not_called()


@pytest.mark.parametrize("client_time", [None, datetime(2000, 1, 1, tzinfo=timezone.utc), datetime(2100, 1, 1, tzinfo=timezone.utc)])
def test_client_clock_cannot_backdate_or_postdate_learner_evidence(memory, client_time):
    started = datetime.now(timezone.utc)
    integration.capture_chat("course-a", memory.user, event_id="turn-a", occurred_at=client_time, text="An answer")
    recorded = memory.service.accept_event.call_args.args[1].occurred_at
    assert started <= recorded <= datetime.now(timezone.utc)


def test_tool_scope_cannot_be_changed_by_model_arguments(memory):
    with pytest.raises(PermissionError):
        integration.validate_tool_context(memory.context, "course-other", "student-a")
    with pytest.raises(PermissionError):
        integration.validate_tool_context(memory.context, "course-a", "student-other")
    with pytest.raises(PermissionError):
        integration.validate_tool_context(None, "course-a", "student-a")
    memory.service.context.assert_not_called()


def test_progress_tool_cannot_write_or_invent_evidence(memory, monkeypatch):
    from agent_tools.custom.update_topic_progress import UpdateTopicProgressTool
    from azure_services.persistence import cosmos_db

    legacy_write = Mock(side_effect=AssertionError("legacy state mutation"))
    monkeypatch.setattr(cosmos_db, "update_topic_in_state", legacy_write)
    output = UpdateTopicProgressTool().execute(
        {"topic": "anything", "status": "learned", "misconceptions_addressed": ["invented"]},
        agent_name="course-a", user_id="student-a", memory_context=memory.context,
    )
    assert output["status"] == "read_only"
    assert "cannot" in output["message"]
    legacy_write.assert_not_called()
    memory.service.accept_event.assert_not_called()


def test_legacy_write_guard_precedes_old_database_access(memory, monkeypatch):
    from azure_services.persistence import cosmos_db

    old_container = Mock(side_effect=AssertionError("legacy container reached"))
    monkeypatch.setattr(cosmos_db, "_get_learning_states_container", old_container)
    for operation in (
        lambda: cosmos_db.save_learning_state("student-a", "course-a", {}),
        lambda: cosmos_db.update_topic_in_state("student-a", "course-a", "topic", "learned"),
        lambda: cosmos_db.delete_learning_state("student-a", "course-a"),
    ):
        with pytest.raises(PermissionError):
            operation()
    old_container.assert_not_called()


def test_quiz_tool_preserves_one_server_instance_for_protocols(memory):
    from agent_tools.custom.add_quiz import AddQuizTool

    memory.service.freeze_assessment.return_value = {
        "quizId": "server-instance", "assessmentInstanceId": "server-instance",
        "curriculumVersion": "1", "title": "Check", "questions": [{"question": "Choose", "options": ["A", "B"]}],
    }
    tool = AddQuizTool()
    args = {"title": "Check", "problem_ids": ["p1"], "questions": []}
    first = tool.execute(args, agent_name="course-a", user_id="student-a", memory_context=memory.context, call_id="call-a")
    second = tool.execute(args, agent_name="course-a", user_id="student-a", memory_context=memory.context, call_id="call-a")
    assert first == second
    assert "correct" not in json.dumps(first)
    assert memory.service.freeze_assessment.call_args_list[0].kwargs["instance_id"] == memory.service.freeze_assessment.call_args_list[1].kwargs["instance_id"]
    assert memory.service.freeze_assessment.call_args.args[0] == memory.context.scope


def test_assessment_submit_ignores_browser_answer_key(memory, monkeypatch):
    from azure_services.persistence import cosmos_db

    access = LearnerAccess(memory.context.scope, memory.user, {}, "authoritative")
    monkeypatch.setattr(assessments, "_access", lambda *_args: access)
    monkeypatch.setattr(assessments, "_service", lambda: memory.service)
    trusted = {
        "created": True, "assetId": "ledger-a", "submittedAt": "2026-09-29T00:00:00Z",
        "score": 0, "totalQuestions": 1, "answers": [{
            "problemId": "p1", "question": "Trusted question", "options": ["A", "B"],
            "selected": [0], "selectedKeys": ["a"], "correct": [1], "reason": "My reasoning",
            "isCorrect": False, "explanation": "Trusted feedback",
        }],
        "receipt": memory.service.accept_event.return_value.model_dump(mode="json"),
    }
    memory.service.submit_assessment.return_value = trusted
    memory.service.public_assessment.return_value = {"title": "Trusted title", "assessmentType": "concept_inventory"}
    save = Mock(return_value=({"id": "asset-a"}, True))
    monkeypatch.setattr(cosmos_db, "create_first_quiz_attempt", save)
    body = assessments.FirstQuizAttemptRequest(
        quizId="instance-a", assessmentInstanceId="instance-a", curriculumVersion="1",
        event_id="submission-a", agentId="course-a", title="Check",
        answers=[{
            "problemId": "p1", "question": "Forged question", "options": ["A", "B"],
            "selected": [0], "correct": [0], "reason": "My reasoning",
            "targetsMisconception": "forged",
        }],
    )
    result = asyncio.run(assessments.submit_first_quiz_attempt(body, request(), memory.user))
    submitted = memory.service.submit_assessment.call_args.args[2]
    assert submitted == [{"problemId": "p1", "selected": [0], "reason": "My reasoning"}]
    assert result["score"] == 0
    assert result["answers"][0]["correct"] == [1]
    assert save.call_args.kwargs["attempt"]["answers"][0]["isCorrect"] is False
    assert save.call_args.kwargs["title"] == "Trusted title"


def test_ingress_failure_occurs_before_stream_open(memory, monkeypatch):
    failure = Mock(side_effect=RuntimeError("private storage detail"))
    monkeypatch.setattr(integration, "_service", lambda: SimpleNamespace(accept_event=failure))
    body = chat.ChatRequest(text="Answer", event_id="turn-a", occurred_at=datetime.now(timezone.utc))
    with pytest.raises(HTTPException) as unavailable:
        chat.prepare_chat("course-a", body, request(), memory.user)
    assert unavailable.value.status_code == 503
    assert "private" not in unavailable.value.detail


def test_catalog_keeps_assessment_identity():
    from agent_tools.a2ui.catalog import COMPONENT_PROPERTIES

    assert {"assessmentInstanceId", "quizId", "curriculumVersion", "serverGraded"} <= set(COMPONENT_PROPERTIES["Quiz"])


def test_shared_harness_parallel_tools_do_not_cache_students(memory):
    from harness.runtime import GeneralAgent

    agent = GeneralAgent.__new__(GeneralAgent)
    agent.agent_name = "course-a"
    before = dict(vars(agent))
    memory.service.context.side_effect = lambda scope, **_kwargs: {"scope_ref": scope.partition_key, "nodes": []}
    calls = [{"name": "get_threshold_concepts", "args": "{}", "call_id": "tool-a"}]
    contexts = [memory_context("student-a"), memory_context("student-b")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(agent._execute_tools_parallel, calls, "conversation", context.scope.student_id, context)
            for context in contexts
        ]
        results = [future.result() for future in futures]
    for context, result in zip(contexts, results):
        assert context.scope.partition_key in result[0]["output"]
        other = contexts[1] if context is contexts[0] else contexts[0]
        assert other.scope.partition_key not in result[0]["output"]
    assert vars(agent) == before


def test_harness_refuses_analytics_tools_in_learner_scope(memory):
    from harness import runtime

    agent = runtime.GeneralAgent.__new__(runtime.GeneralAgent)
    agent.agent_name = "course-a"
    result = agent._dispatch_tool_call(
        "get_student_progress", '{"agent_id":"course-other","user_id":"student-other"}',
        "tool-a", "conversation-a", "student-a", memory.context,
    )
    assert "unavailable in a learner chat" in result["output"]
    memory.service.context.assert_not_called()


def test_conversation_scope_is_server_bound_before_continuation():
    first, second = memory_context("student-a"), memory_context("student-b")
    client = SimpleNamespace(conversations=SimpleNamespace(retrieve=Mock(return_value=SimpleNamespace(
        metadata=integration.conversation_memory_metadata(first),
    ))))
    integration.verify_memory_conversation(client, "conversation-a", first)
    with pytest.raises(PermissionError):
        integration.verify_memory_conversation(client, "conversation-a", second)
    changed_epoch = integration.MemoryToolContext(
        first.scope.model_copy(update={"learning_epoch": 2}), first.actor_id, first.mode, "new-turn",
    )
    with pytest.raises(PermissionError):
        integration.verify_memory_conversation(client, "conversation-a", changed_epoch)


@pytest.mark.parametrize("path", ["stream", "agui", "start", "continue"])
def test_all_chat_transports_capture_before_opening_stream(memory, monkeypatch, path):
    import backend
    from backend.dependencies.auth import get_current_active_user
    from backend.dependencies.agent_access import require_agent_access

    opened = []
    def assert_ingress(request):
        assert memory.service.accept_event.call_count == 1
        assert request.state.memory_context.scope == memory.context.scope
        opened.append(True)

    def streaming(_agent, request, _payload):
        assert_ingress(request)
        return StreamingResponse(iter(["data: {}\n\n"]), media_type="text/event-stream")

    def opening(_agent, _payload, request):
        assert_ingress(request)
        return iter([
            ("message_block", '{"content":"Answer"}', "conversation-a"),
            ("quiz", '{"assessmentInstanceId":"instance-a","quizId":"instance-a","questions":[]}', "conversation-a"),
        ]), "conversation-a", memory.user.id

    main = SimpleNamespace(
        agent_chat_stream=streaming, agent_chat_agui=streaming, _open_agent_stream=opening,
    )
    monkeypatch.setattr(backend, "main", main, raising=False)
    app = FastAPI()
    app.include_router(chat.router)
    app.dependency_overrides[get_current_active_user] = lambda: memory.user
    app.dependency_overrides[require_agent_access] = lambda: None
    body = {
        "text": "My answer", "event_id": "turn-a", "occurred_at": "2026-09-29T00:00:00Z",
    }
    if path == "continue":
        body["conversation_id"] = "conversation-a"
    with TestClient(app) as client:
        response = client.post(f"/api/agents/course-a/chat/{path}", json=body)
    assert response.status_code == 200, response.text
    assert opened == [True]
    if path in {"start", "continue"}:
        assert response.json()["event_id"] == "turn-a"
        assert response.json()["blocks"][0]["assessmentInstanceId"] == "instance-a"
    else:
        assert response.headers["X-Memory-Event-Id"] == "turn-a"


@pytest.mark.parametrize("tool_type", ["memory_search", "memory_search_preview"])
def test_hosted_user_expression_is_not_scope_verification(monkeypatch, tool_type):
    from utils import course_creation

    latest = SimpleNamespace(
        version="7", definition=SimpleNamespace(tools=[SimpleNamespace(type=tool_type, scope="{{$userId}}")])
    )
    fake = SimpleNamespace(agents=SimpleNamespace(get=Mock(return_value=SimpleNamespace(versions=SimpleNamespace(latest=latest)))))
    monkeypatch.setattr(course_creation, "get_creation_client", lambda: fake)
    with pytest.raises(HTTPException) as denied:
        integration.verify_hosted_memory_disabled("course-a")
    assert denied.value.status_code == 409
    latest.definition.tools = []
    assert integration.verify_hosted_memory_disabled("course-a") == "7"


def test_teacher_dispatch_denies_model_scope_change_before_any_query(memory, monkeypatch):
    from teacher_dashboard.logging_agent_tools import execute_scoped_tool
    from backend.dependencies import learner_access

    access = LearnerAccess(
        memory.context.scope, ActiveUser(id="teacher-a", role="teacher", status="active"), {}, "authoritative"
    )
    resolve = Mock(side_effect=AssertionError("unauthorized model target reached reauthorization"))
    monkeypatch.setattr(learner_access, "resolve_learner_access", resolve)
    scope = {"memory_accesses": [access], "selected_mode": True}
    for name, args in (
        ("get_student_progress", {"agent_id": "course-a", "user_id": "other-student"}),
        ("get_student_progress", {"agent_id": "other-course", "user_id": "student-a"}),
        ("get_learning_evidence", {"tenant_id": "other-tenant"}),
    ):
        assert "error" in json.loads(execute_scoped_tool(name, args, scope))
    resolve.assert_not_called()
    memory.service.context.assert_not_called()


def test_cohort_bundle_never_reads_raw_chat_or_individual_evidence(memory):
    accesses = [
        LearnerAccess(context.scope, memory.user, {}, "authoritative")
        for context in [memory_context("student-a"), memory_context("student-b")]
    ]
    memory.service.cohort.return_value = {
        "student_count": 2, "students": [{"student_id": "student-a", "student_ref": "S1"}],
        "evidence_loaded": False,
    }
    bundle = integration.teacher_memory_bundle(accesses, individual=False)
    assert bundle["student_count"] == 2
    assert bundle["chat_signals_reviewed"] is False
    assert "student_id" not in bundle["graph_context"]["students"][0]
    memory.service.context.assert_not_called()
    memory.service.get_evidence.assert_not_called()


def test_unscoped_nonstream_cannot_bypass_ingress(memory):
    from harness.runtime import GeneralAgent

    agent = GeneralAgent.__new__(GeneralAgent)
    agent.agent_name = "course-a"
    agent.openai_client = Mock()
    with pytest.raises(PermissionError):
        agent.start_chat("uncaptured message")
    with pytest.raises(PermissionError):
        agent.continue_chat("conversation-a", "uncaptured message")
    assert not agent.openai_client.mock_calls


def test_previous_graph_context_is_replaced_without_deleting_user_profile():
    from harness import runtime

    graph_item = SimpleNamespace(
        type="message", role="user", id="old-graph",
        content=[SimpleNamespace(type="input_text", text=runtime._GRAPH_MEMORY_PROMPT + "\n{}")],
    )
    normal = SimpleNamespace(
        type="message", role="user", id="learner-message",
        content=[SimpleNamespace(type="input_text", text="I think this is a path")],
    )
    assert runtime._is_graph_memory_snapshot(graph_item)
    assert not runtime._is_graph_memory_snapshot(normal)
    agent = runtime.GeneralAgent.__new__(runtime.GeneralAgent)
    items = SimpleNamespace(list=Mock(side_effect=[[graph_item, normal], [normal]]), delete=Mock())
    agent.openai_client = SimpleNamespace(conversations=SimpleNamespace(items=items))
    agent._clear_prior_learner_instruction_context("conversation-a", graph_only=True)
    items.delete.assert_called_once_with("old-graph", conversation_id="conversation-a")


def test_http_ingress_and_grading_use_the_real_durable_facade(monkeypatch):
    import backend
    from backend.dependencies import learner_access
    from backend.dependencies.auth import get_current_active_user
    from backend.routers import learner_memory
    from azure_services.persistence import cosmos_db
    from learner_memory import service
    from graph_memory_fakes import FakeMemoryRepository
    from test_graph_memory_policy import SCOPE, published_graph

    repository = FakeMemoryRepository()
    config = settings.MemorySettings(enabled=True)
    facade = service.MemoryService(repository, config, extractor=Mock())
    facade.register_scope(SCOPE.tenant_id, SCOPE.institute_id, ["admin-test"])
    facade.publish_graph(published_graph())
    user = ActiveUser(id=SCOPE.student_id, role="student", status="active")
    metadata = {
        "id": SCOPE.course_id, "_etag": "revision-1", "status": "active",
        "createdById": "teacher-test", "teacherIds": [], "studentIds": [user.id],
        "memory_scope": {"tenant_id": SCOPE.tenant_id, "institute_id": SCOPE.institute_id},
        "curriculum_binding": {"curriculum_id": SCOPE.curriculum_id, "curriculum_version": SCOPE.curriculum_version},
        "graph_memory_mode": "authoritative",
    }
    monkeypatch.setattr(settings, "get_memory_settings", lambda: config)
    monkeypatch.setattr(service, "get_service", lambda: facade)
    monkeypatch.setattr(agent_access, "load_agent", lambda _identity: metadata)
    monkeypatch.setattr(learner_access, "load_target_profile", lambda _identity: user.model_dump())
    monkeypatch.setattr(integration, "verify_hosted_memory_disabled", lambda _identity: "1")
    monkeypatch.setattr(cosmos_db, "upsert_quiz_asset", Mock(return_value={"id": "cached-quiz"}))
    monkeypatch.setattr(cosmos_db, "create_first_quiz_attempt", Mock(return_value=({"id": "cached-quiz"}, True)))

    def stream(_agent, request, _payload):
        assert facade.get_receipt(SCOPE, "http-turn") is not None
        assert request.state.memory_context.scope == SCOPE
        return StreamingResponse(iter(["data: {}\n\n"]), media_type="text/event-stream")

    monkeypatch.setattr(backend, "main", SimpleNamespace(agent_chat_stream=stream), raising=False)
    app = FastAPI()
    app.include_router(chat.router)
    app.include_router(assessments.router)
    app.include_router(learner_memory.router)
    app.dependency_overrides[get_current_active_user] = lambda: user
    with TestClient(app) as client:
        initial = client.get(f"/api/agents/{SCOPE.course_id}/learners/{user.id}/memory")
        assert initial.status_code == 200, initial.text
        assert initial.json()["snapshot_version"] == 0
        assert initial.json()["threshold_states"] == {}
        response = client.post(f"/api/agents/{SCOPE.course_id}/chat/stream", json={
            "text": "My current explanation", "event_id": "http-turn", "occurred_at": "2026-09-29T00:00:00Z",
        })
        assert response.status_code == 200, response.text
        receipt = client.get(f"/api/agents/{SCOPE.course_id}/learners/{user.id}/memory/events/http-turn")
        assert receipt.status_code == 200, receipt.text
        assert receipt.json()["sequence"] == 1
        public = facade.freeze_assessment(SCOPE, [], "Check", ["M1-A"], "http-assessment")
        assert all("correct" not in question and "targetsMisconception" not in question for question in public["questions"])
        registration = client.post("/api/quiz-assets", json={
            "quizId": public["quizId"], "assessmentInstanceId": public["assessmentInstanceId"],
            "curriculumVersion": public["curriculumVersion"], "serverGraded": True,
            "agentId": SCOPE.course_id, "title": public["title"],
            "assessmentType": public["assessmentType"], "questions": public["questions"],
        })
        assert registration.status_code == 200, registration.text
        submission = {
            "quizId": public["quizId"], "assessmentInstanceId": public["assessmentInstanceId"],
            "curriculumVersion": public["curriculumVersion"], "event_id": "http-submission",
            "agentId": SCOPE.course_id, "title": public["title"],
            "answers": [{
                "problemId": "M1-A", "selected": [1], "correct": [1],
                "question": "Forged question", "options": ["Forged A", "Forged B"],
                "reason": "I thought the other option was correct.",
            }],
        }
        first = client.post("/api/quiz-attempts/first", json=submission)
        assert first.status_code == 200, first.text
        assert first.json()["score"] == 0
        assert first.json()["answers"][0]["correct"] == [0]
        assert first.json()["receipt"]["sequence"] == 2
        repeated = client.post("/api/quiz-attempts/first", json=submission)
        assert repeated.status_code == 200, repeated.text
        assert repeated.json()["created"] is False
        assert repeated.json()["receipt"]["sequence"] == 2
        submission["answers"][0]["selected"] = [0]
        conflict = client.post("/api/quiz-attempts/first", json=submission)
        assert conflict.status_code == 409
