"""Translate runtime tuples to the unchanged legacy chat SSE payloads."""

import json
import logging
from typing import Any

from backend.schemas.circuit import CircuitBlock
from backend.schemas.slides import SlidesBlock

logger = logging.getLogger(__name__)

_START_EVENTS = frozenset({
    "document_start", "message_block_start", "quiz_start", "challenge_start",
    "generated_image_start", "circuit_start", "slides_start", "tikz_image_start",
    "sympy_image_start",
})


def legacy_event_payload(
    event_type: str, data: str, conversation_id: str | None
) -> dict[str, Any] | None:
    """Map one event without performing persistence, inference or HTTP I/O.

    Unknown events and malformed optional JSON blocks remain omitted. Invalid
    circuit/slide blocks and clarification completions still reach the caller's
    existing stream-error handler.
    """
    identity = {"thread_id": conversation_id, "conversation_id": conversation_id}
    if event_type == "thread_id":
        return {"type": "thread_id", "thread_id": data, "conversation_id": data}
    if event_type == "context_status":
        return {"type": event_type, "status": data, **identity}
    if event_type == "delta":
        return {"type": event_type, "content": data, **identity}
    if event_type in _START_EVENTS:
        kind = "tikz_image_start" if event_type == "sympy_image_start" else event_type
        return {"type": kind, **identity}
    if event_type == "done":
        return {"type": "done", **identity}
    if event_type == "error":
        return {"type": "error", "error": data, **identity}
    if event_type == "clarification_done":
        clarification = json.loads(data)
        return {
            "type": event_type, "clarifyId": clarification["clarifyId"],
            "thread_id": conversation_id,
        }
    if event_type == "circuit":
        return {**CircuitBlock.model_validate_json(data).model_dump(mode="json"), **identity}
    if event_type == "slides":
        return {**SlidesBlock.model_validate_json(data).model_dump(mode="json"), **identity}
    if event_type in ("tool_status", "block_cancel"):
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            logger.error("Failed to parse %s event", event_type)
            payload = {}
        return {"type": event_type, "tool": payload.get("tool"), **identity}
    if event_type not in {
        "document_title", "document_delta", "document", "message_block_delta",
        "message_block", "quiz", "challenge", "clarify", "suggested_queries",
        "generated_image", "tikz_image", "sympy_image", "usage", "citations",
    }:
        return None

    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        logger.error("Failed to parse %s event", event_type)
        return None

    if event_type == "document_title":
        fields = {"title": payload.get("title")}
    elif event_type in ("document_delta", "message_block_delta"):
        fields = {"delta": payload.get("delta", "")}
    elif event_type == "document":
        fields = {
            "title": payload.get("title"), "content": payload.get("content"),
            "doc_type": payload.get("doc_type", "markdown"),
        }
    elif event_type == "message_block":
        fields = {"content": payload.get("content", "")}
    elif event_type == "quiz":
        return {**payload, "type": "quiz", **identity}
    elif event_type == "challenge":
        fields = {
            "title": payload.get("title"), "description": payload.get("description", ""),
            "difficulty": payload.get("difficulty", "medium"), "hints": payload.get("hints", []),
            "solution": payload.get("solution", ""),
            "challenge_type": payload.get("challenge_type", "problem"),
        }
    elif event_type == "clarify":
        fields = {"clarifyId": payload.get("clarifyId", ""), "questions": payload.get("questions", [])}
    elif event_type == "suggested_queries":
        fields = {"queries": payload.get("queries", [])}
    elif event_type == "generated_image":
        fields = {
            key: payload.get(key, "")
            for key in ("title", "imageData", "imageUrl", "caption", "size", "quality")
        }
    elif event_type in ("tikz_image", "sympy_image"):
        event_type = "tikz_image"
        fields = {
            key: payload.get(key, "")
            for key in ("title", "imageData", "caption", "visualizationType")
        }
    elif event_type == "usage":
        return {"type": "usage", **payload, **identity}
    else:
        fields = {"citations": payload}
    return {"type": event_type, **fields, **identity}
