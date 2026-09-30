import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from harness.dispatch import dispatch_tool_call, execute_tools_parallel
from harness.output import FunctionArguments, ValidatedProse, render_plain_text


@pytest.mark.parametrize("name,kind,context", [
    ("add_document", "document", {}),
    ("add_message", "message_block", {}),
    ("add_quiz", "quiz", {"agent_name": "course-test", "user_id": "student-1"}),
    ("add_challenge", "challenge", {}),
    ("add_circuit", "circuit", {}),
    ("add_slides", "slides", {}),
    ("add_tikz_diagram", "tikz_image", {}),
    ("generate_image", "generated_image", {"agent_name": "course-test", "user_id": "student-1"}),
    ("suggest_next_queries", "suggested_queries", {}),
])
def test_tool_result_and_display_block_are_both_preserved(name, kind, context):
    result_data = {"title": "Example", "content": "Content", "queries": ["One", "Two", "Three"]}
    tool = SimpleNamespace(
        execute=Mock(return_value=result_data), output=Mock(return_value="Exact tool output"),
    )
    result = dispatch_tool_call(
        "course-test", {name: tool}, {}, name, '{"title":"Example"}',
        "call-1", "conversation-1", "student-1",
    )
    assert result == {
        "call_id": "call-1", "output": "Exact tool output",
        "yield_events": [(kind, json.dumps(result_data), "conversation-1")],
        "tool_type": name, "is_add_message": name == "add_message", "plan_data": None,
    }
    tool.execute.assert_called_once_with({"title": "Example"}, **context)
    tool.output.assert_called_once_with(result_data, {"title": "Example"})


@pytest.mark.parametrize("name", ["add_document", "add_quiz", "add_circuit", "add_slides", "add_tikz_diagram"])
def test_failed_block_cancels_placeholder_and_returns_model_repair_details(name):
    tool = SimpleNamespace(
        execute=Mock(side_effect=ValueError("invalid arguments")), output=Mock(),
    )
    result = dispatch_tool_call(
        "course-test", {name: tool}, {}, name, "{}", "call-1", "conversation-1", "student-1"
    )
    assert result["output"].startswith("Error: invalid arguments\n")
    assert "Nothing was shown to the student" in result["output"]
    assert result["yield_events"] == [
        ("block_cancel", json.dumps({"type": "block_cancel", "tool": name}), "conversation-1")
    ]
    tool.execute.assert_called_once()
    tool.output.assert_not_called()


def test_unknown_and_retired_tool_compatibility_do_not_execute_other_tools():
    tool = Mock()
    retired = dispatch_tool_call(
        "course-test", {"add_message": tool}, {}, "add_flashcard", "{}", "call-1", "conversation-1", "student-1"
    )
    unknown = dispatch_tool_call(
        "course-test", {"add_message": tool}, {}, "unknown_tool", "{}", "call-2", "conversation-1", "student-1"
    )
    assert retired["output"].startswith("Error: Flashcards are no longer supported.")
    assert [event[0] for event in retired["yield_events"]] == ["error"]
    assert unknown["output"] == "Tool 'unknown_tool' executed successfully."
    assert unknown["yield_events"] == []
    tool.execute.assert_not_called()


@pytest.mark.parametrize("count,workers", [(0, None), (1, None), (2, 2), (8, 6)])
def test_parallelism_cap_order_and_no_thread_for_single_calls(monkeypatch, count, workers):
    from harness import dispatch

    executor_type = dispatch.concurrent.futures.ThreadPoolExecutor
    factory = Mock(wraps=executor_type)
    monkeypatch.setattr(dispatch.concurrent.futures, "ThreadPoolExecutor", factory)

    def execute(name, args, call_id, conversation_id, user_id):
        return {"call_id": call_id, "output": f"{user_id}: {name}"}

    callback = Mock(side_effect=execute)
    calls = [{"name": f"tool-{index}", "args": "{}", "call_id": f"call-{index}"} for index in range(count)]
    results = execute_tools_parallel(callback, calls, "conversation-1", "student-1")
    assert results == [
        {"call_id": f"call-{index}", "output": f"student-1: tool-{index}"} for index in range(count)
    ]
    assert callback.call_count == count
    if workers is None:
        factory.assert_not_called()
    else:
        factory.assert_called_once_with(max_workers=workers)


def test_parallel_exception_keeps_other_outputs_and_position():
    def dispatch(name, args, call_id, conversation_id, user_id):
        if name == "bad":
            raise RuntimeError("worker failed")
        return {"call_id": call_id, "output": "Good result"}

    calls = [
        {"name": name, "args": "{}", "call_id": name} for name in ["first", "bad", "last"]
    ]
    results = execute_tools_parallel(dispatch, calls, "conversation-1", "student-1")
    assert [result["call_id"] for result in results] == ["first", "bad", "last"]
    assert [result["output"] for result in results] == ["Good result", "Error: worker failed", "Good result"]
    assert results[1]["yield_events"] == []


def test_validated_prose_waits_for_exactly_160_characters():
    prose = ValidatedProse()
    fallback = Mock()
    assert list(prose.push("x" * 159, "conversation-1")) == []
    events = list(prose.push("y", "conversation-1"))
    assert [event[0] for event in events] == ["message_block_start", "message_block_delta"]
    assert json.loads(events[1][1])["delta"] == "x" * 159 + "y"
    assert len(json.loads(events[1][1])["delta"]) == 160
    final = list(prose.finish(fallback, "conversation-1", "".join(prose)))
    assert json.loads(final[0][1])["content"] == "x" * 159 + "y"
    fallback.assert_not_called()


def test_incremental_document_title_and_escaped_content_do_not_repeat():
    arguments = FunctionArguments(name="add_document", call_id="call-1")
    first = list(arguments.push(
        '{"title": "Notes", "content": "line\\', "conversation-1", initial=True
    ))
    second = list(arguments.push('nnext\\"quoted\\""}', "conversation-1", initial=True))
    assert [(kind, json.loads(data)) for kind, data, _ in first] == [
        ("document_title", {"type": "document_title", "title": "Notes"}),
        ("document_delta", {"type": "document_delta", "delta": "line"}),
    ]
    assert [(kind, json.loads(data)) for kind, data, _ in second] == [
        ("document_delta", {"type": "document_delta", "delta": '\nnext"quoted"'}),
    ]


def test_concatenated_raw_tool_calls_execute_once_each_without_model_generation():
    message = SimpleNamespace(execute=Mock(return_value={"content": "Answer"}), output=Mock())
    document = SimpleNamespace(execute=Mock(return_value={"title": "Notes", "content": "Body"}), output=Mock())
    dispatch = Mock()
    source = (
        '{"name":"add_message","arguments":{"content":"Answer"}}'
        '{"name":"add_document","arguments":{"title":"Notes","content":"Body"}}'
    )
    events = list(render_plain_text(
        "course-test", {"add_message": message, "add_document": document},
        dispatch, "conversation-1", source, user_id="student-1",
    ))
    assert [event[0] for event in events] == [
        "message_block_start", "message_block", "document_start", "document",
    ]
    message.execute.assert_called_once_with({"content": "Answer"})
    document.execute.assert_called_once_with({"title": "Notes", "content": "Body"})
    message.output.assert_not_called()
    document.output.assert_not_called()
    dispatch.assert_not_called()
