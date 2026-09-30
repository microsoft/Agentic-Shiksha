"""Protocol adapters only translate/framing events; no model or storage clients."""

import ast
import inspect
import json
from pathlib import Path
import threading

import pytest

from backend import agui
from backend.protocols import agui as canonical_agui
from backend.protocols.legacy import legacy_event_payload
from backend.protocols.sse import encode_sse, with_sse_keepalive
from harness.events import RuntimeEvent, tool_start_events


@pytest.mark.parametrize("kind,data,fields", [
    ("context_status", "preparing", {"status": "preparing"}),
    ("delta", "Hello", {"content": "Hello"}),
    ("document_title", '{"title":"Notes"}', {"title": "Notes"}),
    ("document_delta", '{"delta":"part"}', {"delta": "part"}),
    ("document", '{"title":"Notes","content":"Body","ignored":true}', {
        "title": "Notes", "content": "Body", "doc_type": "markdown",
    }),
    ("message_block_delta", "{}", {"delta": ""}),
    ("message_block", '{"content":"Answer","type":"text"}', {"content": "Answer"}),
    ("quiz", '{"title":"Check","assessmentInstanceId":"assessment-1","serverGraded":true}', {
        "title": "Check", "assessmentInstanceId": "assessment-1", "serverGraded": True,
    }),
    ("challenge", "{}", {
        "title": None, "description": "", "difficulty": "medium", "hints": [],
        "solution": "", "challenge_type": "problem",
    }),
    ("clarify", "{}", {"clarifyId": "", "questions": []}),
    ("suggested_queries", "{}", {"queries": []}),
    ("generated_image", '{"title":"Image"}', {
        "title": "Image", "imageData": "", "imageUrl": "", "caption": "", "size": "", "quality": "",
    }),
    ("tikz_image", '{"title":"Diagram"}', {
        "title": "Diagram", "imageData": "", "caption": "", "visualizationType": "",
    }),
    ("usage", '{"total_tokens":42,"per_round":[{"response_id":"response-1"}]}', {
        "total_tokens": 42, "per_round": [{"response_id": "response-1"}],
    }),
    ("citations", '[{"url":"https://example.com"}]', {"citations": [{"url": "https://example.com"}]}),
    ("tool_status", '{"tool":"add_quiz"}', {"tool": "add_quiz"}),
    ("block_cancel", '{"tool":"plain_text"}', {"tool": "plain_text"}),
    ("error", "An error", {"error": "An error"}),
    ("done", "", {}),
])
def test_legacy_fields_defaults_and_identity_are_unchanged(kind, data, fields):
    result = legacy_event_payload(kind, data, "conversation-1")
    assert result == {
        "type": kind, **fields, "thread_id": "conversation-1", "conversation_id": "conversation-1",
    }
    assert encode_sse(result) == f"data: {json.dumps(result)}\n\n"


@pytest.mark.parametrize("kind", [
    "document_start", "message_block_start", "quiz_start", "challenge_start",
    "circuit_start", "slides_start", "tikz_image_start", "generated_image_start",
])
def test_legacy_start_events_ignore_data(kind):
    assert legacy_event_payload(kind, "", "conversation-1") == {
        "type": kind, "thread_id": "conversation-1", "conversation_id": "conversation-1",
    }


def test_legacy_special_identity_and_alias_contracts():
    assert legacy_event_payload("thread_id", "new-conversation", "ignored") == {
        "type": "thread_id", "thread_id": "new-conversation", "conversation_id": "new-conversation",
    }
    assert legacy_event_payload("clarification_done", '{"clarifyId":"clarify-1"}', "conversation-1") == {
        "type": "clarification_done", "clarifyId": "clarify-1", "thread_id": "conversation-1",
    }
    assert legacy_event_payload("sympy_image", "{}", "conversation-1") == legacy_event_payload(
        "tikz_image", "{}", "conversation-1"
    )
    assert legacy_event_payload("sympy_image_start", "", None)["type"] == "tikz_image_start"
    assert legacy_event_payload("future_event", "{}", "conversation-1") is None


@pytest.mark.parametrize("kind", ["message_block", "quiz", "usage", "citations", "document_delta"])
def test_malformed_optional_json_is_logged_and_not_emitted(kind, caplog):
    assert legacy_event_payload(kind, "{", "conversation-1") is None
    assert "Failed to parse" in caplog.text


@pytest.mark.parametrize("kind", ["tool_status", "block_cancel"])
def test_malformed_status_keeps_existing_empty_tool_payload(kind, caplog):
    assert legacy_event_payload(kind, "{", "conversation-1")["tool"] is None
    assert "Failed to parse" in caplog.text


@pytest.mark.parametrize("kind", ["clarification_done", "circuit", "slides"])
def test_invalid_required_blocks_reach_the_existing_stream_error_boundary(kind):
    with pytest.raises((ValueError, KeyError)):
        legacy_event_payload(kind, "{}", "conversation-1")


def test_agui_reexport_and_streamed_surface_finalization_preserve_one_run():
    assert agui.AGUITranslator is canonical_agui.AGUITranslator
    assert agui.encode_sse is encode_sse
    translator = agui.AGUITranslator()
    events = list(translator.run([
        RuntimeEvent("thread_id", "conversation-1", "conversation-1"),
        RuntimeEvent("context_status", "ready", "conversation-1"),
        RuntimeEvent("message_block_start", "{}", "conversation-1"),
        RuntimeEvent("message_block_delta", '{"delta":"Hello "}', "conversation-1"),
        RuntimeEvent("message_block", '{"content":"Hello learner","type":"text"}', "conversation-1"),
        RuntimeEvent("usage", '{"total_tokens":7}', "conversation-1"),
        RuntimeEvent("done", "", "conversation-1"),
    ]))
    assert events[0] == {"type": "RUN_STARTED", "threadId": "conversation-1", "runId": translator.run_id}
    assert events[1] == {"type": "CUSTOM", "name": "context_status", "value": "ready"}
    surfaces = [
        event["value"]["createSurface"]["surfaceId"] for event in events
        if "createSurface" in event.get("value", {})
    ]
    assert len(surfaces) == 1
    assert events[-2] == {"type": "CUSTOM", "name": "usage", "value": {"total_tokens": 7}}
    assert events[-1] == {
        "type": "RUN_FINISHED", "threadId": "conversation-1", "runId": translator.run_id,
        "outcome": {"type": "success"},
    }


def test_keepalive_comments_preserve_frames_and_terminal_failure():
    release = threading.Event()

    def frames():
        assert release.wait(2)
        yield "data: one\n\n"
        raise RuntimeError("producer failed")

    stream = with_sse_keepalive(frames(), interval=0.01)
    try:
        assert next(stream) == ": keepalive\n\n"
        release.set()
        assert next(frame for frame in stream if not frame.startswith(":")) == "data: one\n\n"
        with pytest.raises(RuntimeError, match="producer failed"):
            list(stream)
    finally:
        release.set()
        stream.close()


def test_transport_close_releases_the_blocked_producer():
    release = threading.Event()
    finished = threading.Event()

    def frames():
        try:
            yield "data: one\n\n"
            assert release.wait(2)
            yield "data: two\n\n"
        finally:
            finished.set()

    stream = with_sse_keepalive(frames(), interval=0.01)
    try:
        assert next(frame for frame in stream if not frame.startswith(":")) == "data: one\n\n"
        stream.close()
    finally:
        release.set()
        stream.close()
    assert finished.wait(2)


def test_runtime_events_remain_tuple_compatible():
    events = list(tool_start_events("add_document", "conversation-1"))
    assert all(isinstance(event, RuntimeEvent) for event in events)
    assert events == [
        ("tool_status", '{"type": "tool_status", "tool": "add_document"}', "conversation-1"),
        ("document_start", '{"type": "document_start"}', "conversation-1"),
    ]
    assert list(tool_start_events("add_flashcard", "conversation-1")) == []


def test_lower_layers_never_import_http_or_application_assembly():
    root = Path(inspect.getfile(RuntimeEvent)).parent.parent
    for folder in (root / "harness", root / "backend" / "protocols"):
        for path in folder.glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                modules = (
                    [alias.name for alias in node.names] if isinstance(node, ast.Import)
                    else [node.module or ""] if isinstance(node, ast.ImportFrom)
                    else []
                )
                for module in modules:
                    assert not module.startswith((
                        "fastapi", "starlette", "backend.main", "backend.app", "backend.routers",
                    )), (path.name, module)
                if isinstance(node, ast.ImportFrom) and node.module == "backend":
                    assert not {"main", "app", "routers"} & {alias.name for alias in node.names}
