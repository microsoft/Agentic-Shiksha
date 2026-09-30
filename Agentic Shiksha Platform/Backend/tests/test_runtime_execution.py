"""Offline turn traces: assert side effects as well as the displayed reply."""

from concurrent.futures import ThreadPoolExecutor
import json
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from harness import runtime


MODES = ("start_chat_stream", "continue_chat_stream")


def function_call(name, call_id="call_1", arguments=None, *, phase="done"):
    return SimpleNamespace(
        type=f"response.output_item.{phase}",
        item=SimpleNamespace(
            type="function_call", name=name, call_id=call_id,
            arguments=json.dumps(arguments or {}),
        ),
    )


def text(value):
    return SimpleNamespace(type="response.output_text.delta", delta=value)


def completion(response_id, input_tokens, output_tokens, annotations=()):
    return SimpleNamespace(
        type="response.completed",
        response=SimpleNamespace(
            id=response_id, status="completed",
            usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
            output=[SimpleNamespace(content=[SimpleNamespace(annotations=annotations)])],
        ),
    )


def make_agent(*responses):
    agent = runtime.GeneralAgent.__new__(runtime.GeneralAgent)
    agent.agent_name = "course-test"
    agent.openai_client = SimpleNamespace(
        conversations=SimpleNamespace(
            create=Mock(return_value=SimpleNamespace(id="conversation-1")),
            items=SimpleNamespace(create=Mock(), list=Mock(return_value=[]), delete=Mock()),
        ),
        responses=SimpleNamespace(create=Mock(side_effect=list(responses))),
    )
    return agent


def stream(agent, mode, **kwargs):
    request = {"user_text": "Explain current", "user_id": "student-1", **kwargs}
    if mode == "continue_chat_stream":
        request.setdefault("conversation_id", "conversation-1")
    return getattr(agent, mode)(**request)


def message_texts(events):
    return [json.loads(data)["content"] for kind, data, _ in events if kind == "message_block"]


@pytest.fixture
def message_tool(monkeypatch):
    tool = SimpleNamespace(
        execute=Mock(side_effect=lambda args: {"content": args["content"], "type": "text"}),
        output=Mock(side_effect=lambda result, _args: f"Delivered: {result['content']}"),
    )
    monkeypatch.setattr(runtime, "add_message_tool", tool)
    return tool


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("fail_batch", [None, 2])
def test_final_tool_outputs_are_batched_without_any_extra_response(mode, fail_batch, message_tool):
    calls = [
        function_call("add_message", f"call_{index}", {"content": f"Part {index}"})
        for index in range(41)
    ]
    agent = make_agent(calls)
    if fail_batch:
        agent.openai_client.conversations.items.create.side_effect = [
            None, RuntimeError("private write detail")
        ]
    events = list(stream(agent, mode))
    assert message_texts(events) == [f"Part {index}" for index in range(41)]
    assert message_tool.execute.call_count == message_tool.output.call_count == 41
    agent.openai_client.responses.create.assert_called_once()
    writes = agent.openai_client.conversations.items.create.call_args_list
    assert [len(call.kwargs["items"]) for call in writes] == ([20, 20] if fail_batch else [20, 20, 1])
    assert [item for call in writes for item in call.kwargs["items"]] == [
        {"type": "function_call_output", "call_id": f"call_{index}", "output": f"Delivered: Part {index}"}
        for index in range(40 if fail_batch else 41)
    ]
    assert all(call.args == ("conversation-1",) for call in writes)
    assert events[-1][0] == ("error" if fail_batch else "done")
    if fail_batch:
        assert "private" not in events[-1][1]
        assert "done" not in [event[0] for event in events]


def test_only_continuation_repairs_stale_function_calls(message_tool):
    stale = RuntimeError("400 No tool output found for function call call_stale")
    reply = [function_call("add_message", "call_reply", {"content": "Saved reply"})]
    agent = make_agent(stale, SimpleNamespace(), reply)
    events = list(stream(agent, "continue_chat_stream"))
    assert message_texts(events) == ["Saved reply"]
    assert message_tool.execute.call_count == 1
    requests = agent.openai_client.responses.create.call_args_list
    assert len(requests) == 3
    assert requests[0].kwargs == requests[2].kwargs
    assert requests[1].kwargs == {
        "conversation": "conversation-1", "stream": False,
        "input": [{
            "type": "function_call_output", "call_id": "call_stale",
            "output": "Tool execution completed (recovered from stale state).",
        }],
        "extra_body": {"agent_reference": {"name": "course-test", "type": "agent_reference"}},
    }
    agent = make_agent(stale)
    events = list(stream(agent, "start_chat_stream"))
    agent.openai_client.responses.create.assert_called_once()
    agent.openai_client.conversations.items.create.assert_not_called()
    assert events[-1] == ("error", str(stale), "conversation-1")


def test_stale_recovery_has_exactly_five_attempts_even_when_repairs_fail():
    stale = RuntimeError("400 No tool output found for function call call_stale")
    agent = make_agent(*[item for _ in range(5) for item in (stale, RuntimeError("repair failed"))])
    events = list(stream(agent, "continue_chat_stream"))
    requests = agent.openai_client.responses.create.call_args_list
    assert len(requests) == 10
    assert [call.kwargs["stream"] for call in requests] == [True, False] * 5
    agent.openai_client.conversations.items.create.assert_not_called()
    assert [event[0] for event in events] == ["context_status", "context_status", "error"]
    assert events[-1][1] == "Failed to create response stream after resolving stale function calls"


@pytest.mark.parametrize("mode", MODES)
def test_citations_usage_and_response_ids_keep_order_across_rounds(mode, monkeypatch, message_tool):
    url = SimpleNamespace(type="url_citation", title="Reference", url="https://example.com/source")
    file = SimpleNamespace(type="file_citation", filename="notes.pdf", file_id="file-1")
    annotation = SimpleNamespace(type="response.output_text.annotation.added", annotation=url)
    agent = make_agent(
        [annotation, function_call("get_threshold_concepts"), completion("response-1", 10, 4, [url])],
        [function_call("add_message", "call_reply", {"content": "One answer"}),
         completion("response-2", 20, 8, [url, file])],
    )
    tool = SimpleNamespace(
        execute=Mock(return_value={"concepts": []}),
        output=Mock(return_value="Authorized concepts"),
    )
    monkeypatch.setattr(runtime, "get_threshold_concepts_tool", tool)
    events = list(stream(agent, mode))
    assert message_texts(events) == ["One answer"]
    assert [event[0] for event in events][-3:] == ["citations", "usage", "done"]
    assert json.loads(events[-3][1]) == [
        {"type": "url", "title": "Reference", "url": "https://example.com/source"},
        {"type": "file", "title": "notes.pdf", "file_id": "file-1", "filename": "notes.pdf"},
    ]
    assert json.loads(events[-2][1]) == {
        "input_tokens": 30, "output_tokens": 12, "total_tokens": 42, "rounds": 2,
        "per_round": [
            {"round": 1, "response_id": "response-1", "tools": ["get_threshold_concepts"],
             "input_tokens": 10, "output_tokens": 4},
            {"round": 2, "response_id": "response-2", "tools": ["add_message"],
             "input_tokens": 20, "output_tokens": 8},
        ],
    }
    assert agent.openai_client.responses.create.call_count == 2
    assert agent.openai_client.responses.create.call_args_list[1].kwargs["input"] == [
        {"type": "function_call_output", "call_id": "call_1", "output": "Authorized concepts"}
    ]
    assert tool.execute.call_count == message_tool.execute.call_count == 1
    assert all(event[2] == "conversation-1" for event in events)


@pytest.mark.parametrize("mode", MODES)
def test_producer_close_never_generates_or_records_another_reply(mode, message_tool):
    agent = make_agent([function_call("add_message", arguments={"content": "One answer"})])
    generated = stream(agent, mode)
    assert next(event for event in generated if event[0] == "message_block")[0] == "message_block"
    generated.close()
    message_tool.execute.assert_called_once()
    agent.openai_client.responses.create.assert_called_once()
    agent.openai_client.conversations.items.create.assert_not_called()


@pytest.mark.parametrize("mode", MODES)
def test_clarification_is_flushed_before_waiting_and_result_is_submitted(mode, monkeypatch, message_tool):
    tool = SimpleNamespace(
        execute=Mock(return_value={"questions": [{"question": "Which example?"}]}),
        output=Mock(return_value="Awaiting an answer"),
        wait_for_answers=Mock(return_value="Use a lamp"),
    )
    monkeypatch.setattr(runtime, "ask_clarification_tool", tool)
    monkeypatch.setattr(runtime.clarification_registry, "register", Mock(return_value="clarify-1"))
    agent = make_agent(
        [function_call("ask_clarification", "call_question")],
        [function_call("add_message", "call_answer", {"content": "A lamp example"})],
    )
    generated = stream(agent, mode)
    flushed = next(event for event in generated if event[0] == "clarify")
    assert json.loads(flushed[1])["clarifyId"] == "clarify-1"
    tool.wait_for_answers.assert_not_called()
    rest = list(generated)
    assert rest[0][0] == "clarification_done"
    tool.wait_for_answers.assert_called_once_with("clarify-1", [{"question": "Which example?"}])
    assert agent.openai_client.responses.create.call_count == 2
    assert agent.openai_client.responses.create.call_args_list[1].kwargs["input"] == [
        {"type": "function_call_output", "call_id": "call_question", "output": "Use a lamp"}
    ]
    assert message_texts(rest) == ["A lamp example"]
    assert tool.execute.call_count == message_tool.execute.call_count == 1


def test_concurrent_learners_share_only_stateless_agent_dependencies(monkeypatch, message_tool):
    gate = threading.Barrier(2)

    def concepts(_args, *, agent_name, user_id):
        gate.wait(timeout=5)
        return {"learner": user_id, "course": agent_name}

    tool = SimpleNamespace(
        execute=Mock(side_effect=concepts),
        output=Mock(side_effect=lambda result, _args: json.dumps(result)),
    )
    monkeypatch.setattr(runtime, "get_threshold_concepts_tool", tool)
    agent = make_agent()

    def respond(**request):
        conversation = request["conversation"]
        if isinstance(request["tool_choice"], str) and request["input"][0].get("type") != "function_call_output":
            return [function_call("get_threshold_concepts", f"call_{conversation}")]
        return [function_call("add_message", f"reply_{conversation}", {"content": request["input"][0]["output"]})]

    agent.openai_client.responses.create.side_effect = respond
    before = dict(vars(agent))
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(
                lambda learner: list(stream(
                    agent, "continue_chat_stream", user_id=learner, conversation_id=f"conversation-{learner}"
                )),
                learner,
            )
            for learner in ("student-a", "student-b")
        ]
        outputs = [future.result(timeout=10) for future in futures]
    for learner, events in zip(("student-a", "student-b"), outputs):
        assert [json.loads(value) for value in message_texts(events)] == [
            {"learner": learner, "course": "course-test"}
        ]
        assert all(event[2] == f"conversation-{learner}" for event in events)
    assert vars(agent) == before
    assert tool.execute.call_count == message_tool.execute.call_count == 2
    assert agent.openai_client.responses.create.call_count == 4
    writes = agent.openai_client.conversations.items.create.call_args_list
    assert len(writes) == 2
    for write in writes:
        learner = write.args[0].removeprefix("conversation-")
        assert learner in write.kwargs["items"][0]["output"]
        assert write.kwargs["items"][0]["call_id"] == f"reply_conversation-{learner}"


@pytest.mark.parametrize("mode", MODES)
def test_artifact_plan_preserves_every_result_without_extra_final_generation(mode, monkeypatch, message_tool):
    document = SimpleNamespace(
        execute=Mock(return_value={"title": "Notes", "content": "Material", "doc_type": "markdown"}),
        output=Mock(return_value="Document delivered"),
    )
    suggestions = SimpleNamespace(
        execute=Mock(return_value={"queries": ["First", "Second", "Third"]}),
        output=Mock(return_value="Suggestions delivered"),
    )
    plan = SimpleNamespace(execute=Mock(return_value={"status": "accepted"}), output=Mock(return_value="Plan accepted"))
    monkeypatch.setattr(runtime, "add_document_tool", document)
    monkeypatch.setattr(runtime, "suggest_next_queries_tool", suggestions)
    monkeypatch.setattr(runtime, "declare_plan_tool", plan)
    steps = ["add_message", "add_document", "suggest_next_queries"]
    agent = make_agent(
        [function_call("declare_plan", "call_plan", {"tools": steps})],
        [function_call("add_message", "call_reply", {"content": "One answer"})],
        [function_call("add_document", "call_document")],
        [function_call("suggest_next_queries", "call_suggestions")],
    )
    events = list(stream(agent, mode))
    assert [kind for kind, _, _ in events if kind not in {"thread_id", "context_status"}] == [
        "message_block", "document", "suggested_queries", "done",
    ]
    assert message_texts(events) == ["One answer"]
    assert document.execute.call_count == message_tool.execute.call_count == suggestions.execute.call_count == 1
    requests = agent.openai_client.responses.create.call_args_list
    assert len(requests) == 4
    assert [request.kwargs["tool_choice"] for request in requests[1:]] == [
        {"type": "function", "name": name} for name in steps
    ]
    assert [request.kwargs["input"] for request in requests[1:]] == [
        [{"type": "function_call_output", "call_id": "call_plan", "output": "Plan accepted"}],
        [{"type": "function_call_output", "call_id": "call_reply", "output": "Delivered: One answer"}],
        [{"type": "function_call_output", "call_id": "call_document", "output": "Document delivered"}],
    ]
    agent.openai_client.conversations.items.create.assert_called_once_with(
        "conversation-1",
        items=[{"type": "function_call_output", "call_id": "call_suggestions", "output": "Suggestions delivered"}],
    )


@pytest.mark.parametrize("mode", MODES)
def test_no_new_round_limit_is_imposed_on_unfinished_work(mode, monkeypatch, message_tool):
    tool = SimpleNamespace(execute=Mock(return_value={}), output=Mock(return_value="Context result"))
    monkeypatch.setattr(runtime, "get_threshold_concepts_tool", tool)
    agent = make_agent(
        *[[function_call("get_threshold_concepts", f"call_{index}")] for index in range(12)],
        [function_call("add_message", "call_answer", {"content": "Finished"})],
    )
    events = list(stream(agent, mode))
    assert agent.openai_client.responses.create.call_count == 13
    assert tool.execute.call_count == 12
    assert message_tool.execute.call_count == 1
    assert message_texts(events) == ["Finished"]
    assert events[-1][0] == "done"
    requests = agent.openai_client.responses.create.call_args_list
    assert [request.kwargs["input"] for request in requests[1:]] == [
        [{"type": "function_call_output", "call_id": f"call_{index}", "output": "Context result"}]
        for index in range(12)
    ]


@pytest.mark.parametrize("mode", MODES)
def test_followup_failure_preserves_existing_completion_without_retry(mode, monkeypatch, caplog):
    tool = SimpleNamespace(execute=Mock(return_value={}), output=Mock(return_value="Context result"))
    monkeypatch.setattr(runtime, "get_threshold_concepts_tool", tool)
    agent = make_agent(
        [function_call("get_threshold_concepts"), completion("response-1", 3, 2)],
        RuntimeError("followup failed"),
    )
    events = list(stream(agent, mode))
    assert agent.openai_client.responses.create.call_count == 2
    tool.execute.assert_called_once()
    agent.openai_client.conversations.items.create.assert_not_called()
    assert [event[0] for event in events][-2:] == ["usage", "done"]
    assert "Error submitting tool outputs" in caplog.text
    assert "error" not in [event[0] for event in events]


@pytest.mark.parametrize("mode", MODES)
def test_followup_annotation_only_is_not_newly_included_in_citations(mode, monkeypatch, message_tool):
    tool = SimpleNamespace(execute=Mock(return_value={}), output=Mock(return_value="Context result"))
    monkeypatch.setattr(runtime, "get_threshold_concepts_tool", tool)
    annotation = SimpleNamespace(
        type="response.output_text.annotation.added",
        annotation=SimpleNamespace(type="url_citation", url="https://example.com/annotation", title="Source"),
    )
    agent = make_agent(
        [function_call("get_threshold_concepts")],
        [annotation, function_call("add_message", "call_answer", {"content": "Finished"})],
    )
    events = list(stream(agent, mode))
    assert agent.openai_client.responses.create.call_count == 2
    assert "citations" not in [event[0] for event in events]
    assert message_texts(events) == ["Finished"]


@pytest.mark.parametrize("mode", MODES)
def test_typed_runtime_events_cover_every_emitted_turn_item(mode, message_tool):
    from harness.events import RuntimeEvent

    agent = make_agent([
        text("Useful explanation. " * 15),
        function_call("add_message", "call_answer", {"content": "Finished"}),
        completion("response-1", 3, 2),
    ])
    events = list(stream(agent, mode))
    assert all(isinstance(event, RuntimeEvent) for event in events)
    assert agent.openai_client.responses.create.call_count == 1
    assert message_texts(events) == ["Finished"]
