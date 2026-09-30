"""Internal stream events, independent of HTTP framing and client protocols."""

import json
from collections.abc import Iterator
from typing import Any, NamedTuple


class RuntimeEvent(NamedTuple):
    """Tuple-compatible event shared by runtime consumers and protocol adapters."""

    event_type: str
    data: str
    conversation_id: str | None


def json_event(
    event_type: str, payload: Any, conversation_id: str | None
) -> RuntimeEvent:
    return RuntimeEvent(event_type, json.dumps(payload), conversation_id)


BLOCK_START_EVENTS = {
    "add_document": "document_start",
    "add_message": "message_block_start",
    "add_quiz": "quiz_start",
    "add_challenge": "challenge_start",
    "add_circuit": "circuit_start",
    "add_slides": "slides_start",
    "add_tikz_diagram": "tikz_image_start",
    "generate_image": "generated_image_start",
}
BLOCK_TOOLS = frozenset(BLOCK_START_EVENTS)


def tool_start_events(
    func_name: str | None, conversation_id: str | None
) -> Iterator[RuntimeEvent]:
    if not func_name or func_name == "add_flashcard":
        return
    yield json_event(
        "tool_status", {"type": "tool_status", "tool": func_name}, conversation_id
    )
    start_event = BLOCK_START_EVENTS.get(func_name)
    if start_event:
        yield json_event(start_event, {"type": start_event}, conversation_id)
