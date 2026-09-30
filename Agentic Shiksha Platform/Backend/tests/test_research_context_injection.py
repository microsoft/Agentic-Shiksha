from copy import deepcopy
from itertools import count
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest
from azure.ai.projects import AIProjectClient
from azure.core.credentials import AccessToken, TokenCredential

from base_agents.general_agent import (
    GeneralAgent,
    _RESEARCH_CONTEXT_MAX_CHARS,
    _profile_research_instructions,
    _research_context,
)


def test_structured_research_is_injected_for_both_scopes():
    institute = {
        "status": "completed",
        "research_type": "institute",
        "institute_name": "IIT Kharagpur",
        "profile": {
            "name": "Indian Institute of Technology Kharagpur",
            "location": "Kharagpur, West Bengal, India",
        },
        "academic_system": {"grading_system": "10-point CGPA"},
    }
    department = {
        "status": "completed",
        "research_type": "department",
        "department_name": "Physics",
        "profile": {"name": "Department of Physics"},
        "research": {"focus_areas": ["Condensed matter physics"]},
    }

    with (
        patch(
            "azure_services.persistence.cosmos_db.get_institute_research",
            return_value=institute,
        ),
        patch(
            "azure_services.persistence.cosmos_db.get_department_research",
            return_value=department,
        ),
    ):
        context = _profile_research_instructions({
            "college": "IIT Kharagpur",
            "department": "Physics",
        })

    assert "Institute context (IIT Kharagpur)" in context
    assert "Indian Institute of Technology Kharagpur" in context
    assert "Department context (Physics at IIT Kharagpur)" in context
    assert "Department of Physics" in context


def test_legacy_research_is_supported_and_failed_research_is_excluded():
    assert _research_context({"status": "completed", "result": "legacy context"}) == (
        "legacy context"
    )
    assert _research_context({"status": "failed", "result": "do not inject"}) is None


def test_structured_research_context_is_bounded():
    context = _research_context({
        "status": "completed",
        "profile": {"description": "x" * (_RESEARCH_CONTEXT_MAX_CHARS * 2)},
    })

    assert context.endswith("...[truncated]")
    assert len(context) <= _RESEARCH_CONTEXT_MAX_CHARS + len("...[truncated]")


@pytest.mark.parametrize("method_name", ["start_chat_stream", "continue_chat_stream"])
@pytest.mark.parametrize("image_urls", [None, ["data:image/png;base64,ZXhhbXBsZQ=="]])
def test_custom_instructions_reach_each_turn_and_can_be_replaced_or_cleared(
    method_name, image_urls, monkeypatch, caplog,
):
    agent = GeneralAgent.__new__(GeneralAgent)
    agent.agent_name = "course-example"
    agent.openai_client = SimpleNamespace(
        conversations=SimpleNamespace(
            create=Mock(return_value=SimpleNamespace(id="conversation-example")),
            items=SimpleNamespace(list=Mock(return_value=[]), delete=Mock()),
        ),
        responses=SimpleNamespace(create=Mock(return_value=[])),
    )
    monkeypatch.setattr(
        agent, "_prepare_course_material_request",
        lambda model_input, *_args, **_kwargs: (model_input, [], None),
    )
    snapshots = [
        ("student-1", "Prefer short explanations."),
        ("student-1", '  Explain with examples in తెలుగు. "Keep this verbatim."\n' * 128),
        ("student-1", ""),
        ("student-2", "Use diagrams instead."),
    ]
    previous_snapshots = []
    for user_id, instructions in snapshots:
        kwargs = {
            "user_text": "Explain voltage.",
            "user_id": user_id,
            "user_profile": {"customInstructions": instructions},
            "image_urls": image_urls,
        }
        if method_name == "continue_chat_stream":
            kwargs["conversation_id"] = f"conversation-{user_id}"

        events = list(getattr(agent, method_name)(**kwargs))

        assert not any(event[0] == "error" for event in events)
        assert events[-1][0] == "done"
        model_input = agent.openai_client.responses.create.call_args.kwargs["input"]
        contexts = [
            item["content"] for item in model_input
            if isinstance(item["content"], str)
            and "[SYSTEM CONTEXT - Student Profile & Environment]" in item["content"]
        ]
        assert len(contexts) == 1
        assert (
            f"Current customInstructions (JSON): {json.dumps(instructions, ensure_ascii=False)}"
            in contexts[0]
        )
        assert "replaces earlier learner custom-instruction snapshots" in contexts[0]
        assert "clears previously supplied custom instructions" in contexts[0]
        for previous in previous_snapshots:
            assert json.dumps(previous, ensure_ascii=False) not in contexts[0]
        if instructions:
            assert instructions not in caplog.text
            previous_snapshots.append(instructions)


def test_omitted_custom_instructions_do_not_clear_a_prior_snapshot():
    context = _profile_research_instructions({"language": "Telugu"})

    assert "Current customInstructions (JSON):" not in context


@pytest.fixture
def conversation_runtime(monkeypatch):
    histories = {}
    requests = []
    response_bodies = []
    model_contexts = []
    control = {"failure": None, "ignore_delete": False}
    identifiers = count(1)

    def add_message(conversation_id, text, role="user", content_type="input_text"):
        item = {
            "id": f"item-{next(identifiers)}", "type": "message", "status": "completed",
            "role": role, "content": [{"type": content_type, "text": text}],
        }
        histories.setdefault(conversation_id, []).append(item)
        return item

    def conversation(conversation_id):
        return {"id": conversation_id, "object": "conversation", "created_at": 0, "metadata": {}}

    def handle(request):
        path = request.url.path.removeprefix("/v1/").split("/")
        requests.append((request.method, request.url.path))
        if path == ["conversations"] and request.method == "POST":
            conversation_id = f"conversation-{next(identifiers)}"
            histories[conversation_id] = []
            return httpx.Response(200, json=conversation(conversation_id))
        if len(path) >= 3 and path[0] == "conversations" and path[2] == "items":
            conversation_id = path[1]
            operation = "list" if request.method == "GET" else "delete"
            if control["failure"] == operation:
                return httpx.Response(503, json={"error": {"message": "private provider diagnostics"}})
            if request.method == "GET":
                history = histories[conversation_id]
                after = request.url.params.get("after")
                start = next((i + 1 for i, item in enumerate(history) if item["id"] == after), 0)
                page = history[start:start + 2]
                return httpx.Response(200, json={
                    "object": "list", "data": page, "has_more": start + 2 < len(history),
                    "first_id": page[0]["id"] if page else None,
                    "last_id": page[-1]["id"] if page else None,
                })
            if request.method == "DELETE":
                if not control["ignore_delete"]:
                    histories[conversation_id] = [
                        item for item in histories[conversation_id] if item["id"] != path[3]
                    ]
                return httpx.Response(200, json=conversation(conversation_id))
        if path == ["responses"] and request.method == "POST":
            body = json.loads(request.content)
            response_bodies.append(body)
            if "agent" in body or "agent_reference" not in body:
                return httpx.Response(400, json={"error": {
                    "code": "invalid_payload", "type": "invalid_request_error",
                    "param": "agent",
                    "message": "The 'agent' property is deprecated. Use 'agent_reference' instead.",
                }})
            model_input = body["input"]
            if isinstance(model_input, str):
                model_input = [{"role": "user", "content": model_input}]
            for message in model_input:
                content = message["content"]
                if isinstance(content, str):
                    add_message(body["conversation"], content, message["role"])
                else:
                    histories[body["conversation"]].append({
                        **message, "id": f"item-{next(identifiers)}", "status": "completed",
                    })
            model_contexts.append(deepcopy(histories[body["conversation"]]))
            if not body.get("stream"):
                return httpx.Response(200, json={
                    "id": "response-example", "object": "response", "created_at": 0,
                    "status": "completed", "model": "test-model",
                    "output": [{
                        "id": "message-example", "type": "message", "role": "assistant",
                        "status": "completed",
                        "content": [{"type": "output_text", "text": "Offline reply", "annotations": []}],
                    }],
                })
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content="data: [DONE]\n\n")
        raise AssertionError(f"Unexpected mock API request: {request.method} {request.url.path}")

    credential = Mock(spec=TokenCredential)
    credential.get_token.return_value = AccessToken("offline-test-key", 9999999999)
    project = AIProjectClient(
        endpoint="https://example.services.ai.azure.com/api/projects/test",
        credential=credential,
    )
    client = project.get_openai_client(
        base_url="https://example.invalid/v1/",
        http_client=httpx.Client(transport=httpx.MockTransport(handle)), max_retries=0,
    )
    agent = GeneralAgent.__new__(GeneralAgent)
    agent.agent_name = "course-example"
    agent.openai_client = client
    monkeypatch.setattr(
        agent, "_prepare_course_material_request",
        lambda model_input, *_args, **_kwargs: (model_input, [], None),
    )
    yield SimpleNamespace(
        agent=agent, histories=histories, requests=requests, control=control, add_message=add_message,
        model_contexts=model_contexts, response_bodies=response_bodies,
    )
    client.close()
    project.close()


@pytest.mark.parametrize("method_name", [
    "start_chat", "continue_chat", "start_chat_stream", "continue_chat_stream",
])
def test_agent_reference_is_sent_on_the_wire(conversation_runtime, method_name):
    runtime = conversation_runtime
    kwargs = {"user_text": "Explain voltage."}
    if method_name.startswith("continue"):
        kwargs["conversation_id"] = "conversation-existing"
        runtime.histories["conversation-existing"] = []
    if method_name.endswith("_stream"):
        kwargs["user_id"] = "student-1"
        events = list(getattr(runtime.agent, method_name)(**kwargs))
        assert not any(kind == "error" for kind, _data, _conversation in events)
        assert events[-1][0] == "done"
    else:
        result = getattr(runtime.agent, method_name)(**kwargs)
        assert (result[0] if isinstance(result, tuple) else result) == "Offline reply"
    assert len(runtime.response_bodies) == 1
    body = runtime.response_bodies[0]
    assert "agent" not in body
    assert body["agent_reference"] == {"name": "course-example", "type": "agent_reference"}
    assert body["conversation"] in runtime.histories


@pytest.mark.parametrize("method_name", ["start_chat_stream", "continue_chat_stream"])
def test_agent_reference_preserves_pinned_version(conversation_runtime, monkeypatch, method_name):
    runtime = conversation_runtime
    reference = {"name": "course-example", "type": "agent_reference", "version": "7"}
    monkeypatch.setattr("base_agents.general_agent.context_agent_reference", lambda *_args: reference)
    kwargs = {"user_text": "Explain voltage.", "user_id": "student-1"}
    if method_name.startswith("continue"):
        kwargs["conversation_id"] = "conversation-existing"
        runtime.histories["conversation-existing"] = []

    events = list(getattr(runtime.agent, method_name)(**kwargs))

    assert not any(kind == "error" for kind, _data, _conversation in events)
    assert runtime.response_bodies[0]["agent_reference"] == reference
    assert "agent" not in runtime.response_bodies[0]


@pytest.mark.parametrize("method_name", ["start_chat_stream", "continue_chat_stream"])
@pytest.mark.parametrize("user_profile", [None, {"customInstructions": "Prefer worked examples."}])
def test_context_status_brackets_preparation_before_model_execution(
    conversation_runtime, monkeypatch, method_name, user_profile,
):
    runtime = conversation_runtime
    prepared = []

    def prepare(model_input, *_args):
        prepared.append(model_input)
        return model_input, [], None

    monkeypatch.setattr(runtime.agent, "_prepare_course_material_request", prepare)
    kwargs = {"user_text": "Explain voltage.", "user_id": "student-1", "user_profile": user_profile}
    conversation_id = "conversation-existing"
    if method_name == "continue_chat_stream":
        kwargs["conversation_id"] = conversation_id
        runtime.histories[conversation_id] = []
    stream = getattr(runtime.agent, method_name)(**kwargs)
    if method_name == "start_chat_stream":
        kind, conversation_id, _ = next(stream)
        assert kind == "thread_id"

    assert next(stream) == ("context_status", "preparing", conversation_id)
    assert prepared == []
    assert not any(path.endswith("/responses") for _method, path in runtime.requests)

    assert next(stream) == ("context_status", "ready", conversation_id)
    assert len(prepared) == 1
    assert not any(path.endswith("/responses") for _method, path in runtime.requests)
    if user_profile:
        assert "Prefer worked examples." in json.dumps(prepared)

    remaining = list(stream)
    assert remaining[-1] == ("done", "", conversation_id)
    assert not any(kind == "context_status" for kind, _data, _conversation in remaining)
    assert any(path.endswith("/responses") for _method, path in runtime.requests)


def test_agui_preserves_transient_context_status_without_creating_message_blocks():
    from backend.agui import AGUITranslator

    events = list(AGUITranslator("conversation-example").run([
        ("context_status", "preparing", "conversation-example"),
        ("context_status", "ready", "conversation-example"),
        ("done", "", "conversation-example"),
    ]))
    assert [event for event in events if event["type"] == "CUSTOM"] == [
        {"type": "CUSTOM", "name": "context_status", "value": "preparing"},
        {"type": "CUSTOM", "name": "context_status", "value": "ready"},
    ]
    assert [event["type"] for event in events] == [
        "RUN_STARTED", "CUSTOM", "CUSTOM", "RUN_FINISHED",
    ]


def test_legacy_stream_preserves_context_status(monkeypatch):
    with (
        patch("msal.ConfidentialClientApplication"),
        patch("msal.PublicClientApplication"),
        patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected network request")),
    ):
        from backend import main

    stream = [
        ("thread_id", "conversation-example", "conversation-example"),
        ("context_status", "preparing", "conversation-example"),
        ("context_status", "ready", "conversation-example"),
        ("done", "", "conversation-example"),
    ]
    agent = SimpleNamespace(start_chat_stream=Mock(return_value=iter(stream)))
    monkeypatch.setattr(main, "get_general_agent", lambda **_kwargs: agent)
    monkeypatch.setattr(main, "_resolve_user_id", lambda _request, user_id: user_id)
    monkeypatch.setattr(main, "_load_setup_json", lambda _agent_id: None)
    monkeypatch.setattr(main, "request_memory_kwargs", lambda _request: {})
    monkeypatch.setattr(main, "_record_inferred_progress", lambda **_kwargs: None)
    response = main.agent_chat_stream("course-example", SimpleNamespace(), {
        "text": "Explain voltage.", "user_id": "student-1", "inject_profile": False,
    })

    async def read_events():
        return [
            json.loads(chunk.removeprefix("data: "))
            async for chunk in response.body_iterator if chunk.startswith("data: ")
        ]

    events = asyncio.run(read_events())
    assert [event["type"] for event in events] == [
        "thread_id", "context_status", "context_status", "done",
    ]
    assert [event["status"] for event in events if event["type"] == "context_status"] == [
        "preparing", "ready",
    ]


def profile_snapshots(history):
    return [
        part["text"] for item in history if item.get("role") == "user"
        for part in item.get("content", []) if isinstance(part.get("text"), str)
        and part["text"].startswith("[SYSTEM CONTEXT - Student Profile & Environment]")
        and "Current customInstructions (JSON):" in part["text"]
    ]


def test_replacement_and_clearing_remove_stale_preferences_from_persisted_context(conversation_runtime):
    runtime = conversation_runtime
    events = list(runtime.agent.start_chat_stream(
        "First question", user_id="student-1",
        user_profile={"language": "Telugu", "customInstructions": "Prefer short answers."},
    ))
    conversation_id = events[0][2]
    assert events[-1][0] == "done"
    original_history = deepcopy(runtime.histories[conversation_id])
    other = runtime.add_message("other-student-course", profile_snapshots(original_history)[0])
    assistant = runtime.add_message(conversation_id, "An ordinary assistant answer.", role="assistant")
    previous = ["Prefer short answers."]

    for instructions in ["Prefer worked examples.", ""]:
        events = list(runtime.agent.continue_chat_stream(
            conversation_id, "Next question", user_id="student-1",
            user_profile={"language": "Telugu", "customInstructions": instructions},
        ))

        assert events[-1][0] == "done"
        snapshots = profile_snapshots(runtime.histories[conversation_id])
        assert len(snapshots) == 1
        assert f"Current customInstructions (JSON): {json.dumps(instructions)}" in snapshots[0]
        for obsolete in previous:
            assert obsolete not in json.dumps(runtime.histories[conversation_id])
            assert obsolete not in json.dumps(runtime.model_contexts[-1])
        previous.append(instructions)
        assert assistant in runtime.histories[conversation_id]
        assert runtime.histories["other-student-course"] == [other]
        assert original_history[-1] in runtime.histories[conversation_id]

    calls_before = len(runtime.requests)
    events = list(runtime.agent.continue_chat_stream(
        conversation_id, "Profile injection omitted", user_id="student-1", user_profile={},
    ))
    assert events[-1][0] == "done"
    assert 'Current customInstructions (JSON): ""' in profile_snapshots(runtime.histories[conversation_id])[0]
    assert all(method == "POST" for method, _path in runtime.requests[calls_before:])


@pytest.mark.parametrize("content_type", ["input_text", "text", "output_text"])
def test_snapshot_cleanup_is_paginated_and_preserves_non_snapshot_items(conversation_runtime, content_type):
    runtime = conversation_runtime
    conversation_id = "conversation-existing"
    context = "[SYSTEM CONTEXT - Student Profile & Environment] " + _profile_research_instructions({
        "customInstructions": "An old preference.",
    })
    keep = [
        runtime.add_message(conversation_id, "An ordinary user message mentioning an old preference."),
        runtime.add_message(conversation_id, context, role="assistant", content_type="output_text"),
        runtime.add_message(conversation_id, "[SYSTEM CONTEXT - Student Profile & Environment] Language: Telugu."),
    ]
    for _ in range(5):
        runtime.add_message(conversation_id, context, content_type=content_type)
    tool_output = {"id": "tool-result", "type": "function_call_output", "call_id": "call-example", "output": context}
    runtime.histories[conversation_id].append(tool_output)
    keep.append(tool_output)

    events = list(runtime.agent.continue_chat_stream(
        conversation_id, "Continue", user_id="student-1", user_profile={"customInstructions": ""},
    ))

    assert events[-1][0] == "done"
    assert len(profile_snapshots(runtime.histories[conversation_id])) == 1
    assert all(item in runtime.histories[conversation_id] for item in keep)
    assert len([method for method, _path in runtime.requests if method == "DELETE"]) == 5


@pytest.mark.parametrize("failure", ["list", "delete", "unconfirmed-delete"])
def test_context_cleanup_failures_stop_the_turn_before_model_execution(conversation_runtime, failure, caplog):
    runtime = conversation_runtime
    conversation_id = "conversation-existing"
    context = "[SYSTEM CONTEXT - Student Profile & Environment] " + _profile_research_instructions({
        "customInstructions": "Keep this obsolete preference private.",
    })
    runtime.add_message(conversation_id, context)
    runtime.control["failure"] = failure
    runtime.control["ignore_delete"] = failure == "unconfirmed-delete"

    events = list(runtime.agent.continue_chat_stream(
        conversation_id, "Continue", user_id="student-1", user_profile={"customInstructions": ""},
    ))

    assert events[-1] == ("error", "Learner instructions could not be updated. Please retry.", conversation_id)
    assert [data for kind, data, _conversation in events if kind == "context_status"] == ["preparing"]
    assert not any(path.endswith("/responses") for _method, path in runtime.requests)
    assert "private provider diagnostics" not in caplog.text
    assert "obsolete preference" not in caplog.text