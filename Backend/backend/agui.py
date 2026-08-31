"""
AG-UI protocol support.

AG-UI (https://ag-ui.com) is an event-based protocol connecting an agentic
backend to a user-facing frontend. This module translates the existing
``(event_type, data, conversation_id)`` tuples produced by the agent stream
generator into standard AG-UI events, carrying A2UI widget messages as `CUSTOM`
events.

The legacy ``/api/agents/{agent_id}/chat/stream`` endpoint is untouched; this
runs alongside it so both wire formats can be served during evaluation.
"""

import json
import logging
import uuid
from typing import Any, Dict, Iterable, Iterator, Optional, Tuple

from agent_tools.a2ui import (
    BLOCK_COMPONENT_TYPES,
    STREAMING_PROPERTY,
    block_to_a2ui,
    new_surface_id,
    open_streaming_surface,
    patch_streaming_text,
)
from agent_tools.a2ui.catalog import COMPONENT_PROPERTIES

logger = logging.getLogger(__name__)

# ---- AG-UI event type identifiers (wire values) ----
RUN_STARTED = "RUN_STARTED"
RUN_FINISHED = "RUN_FINISHED"
RUN_ERROR = "RUN_ERROR"
STEP_STARTED = "STEP_STARTED"
STEP_FINISHED = "STEP_FINISHED"
TEXT_MESSAGE_START = "TEXT_MESSAGE_START"
TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT"
TEXT_MESSAGE_END = "TEXT_MESSAGE_END"
CUSTOM = "CUSTOM"

# Name used for AG-UI CUSTOM events that carry an A2UI protocol message.
A2UI_CUSTOM_EVENT = "a2ui"

# Backend "<kind>_start" events that precede a widget payload.
_START_SUFFIX = "_start"
_DELTA_SUFFIX = "_delta"


def encode_sse(event: Dict[str, Any]) -> str:
    """Serialize one AG-UI event as an SSE frame."""
    return f"data: {json.dumps(event)}\n\n"


def _event(event_type: str, **fields: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"type": event_type}
    payload.update({k: v for k, v in fields.items() if v is not None})
    return payload


def a2ui_event(message: Dict[str, Any]) -> Dict[str, Any]:
    """Wrap an A2UI protocol message in an AG-UI CUSTOM event."""
    return _event(CUSTOM, name=A2UI_CUSTOM_EVENT, value=message)


class AGUITranslator:
    """Translate legacy agent stream tuples into AG-UI events.

    Usage::

        translator = AGUITranslator(thread_id=conversation_id)
        for frame in translator.run(stream_gen):
            yield frame
    """

    def __init__(self, thread_id: Optional[str] = None) -> None:
        self.thread_id = thread_id or ""
        self.run_id = f"run-{uuid.uuid4().hex[:12]}"
        self._run_started = False
        self._message_id: Optional[str] = None
        # Open streaming surfaces keyed by widget kind (document, message_block).
        self._streaming_surfaces: Dict[str, str] = {}
        self._streaming_chunks: Dict[str, int] = {}
        # Number of A2UI surfaces emitted during this run (for the run summary).
        self._surface_count = 0

    # ---- lifecycle helpers ----

    def _ensure_run_started(self) -> Iterator[Dict[str, Any]]:
        if not self._run_started:
            self._run_started = True
            logger.info(
                f"[AG-UI] run started: runId={self.run_id}, threadId={self.thread_id}"
            )
            yield _event(RUN_STARTED, threadId=self.thread_id, runId=self.run_id)

    def _open_text_message(self) -> Iterator[Dict[str, Any]]:
        if self._message_id is None:
            self._message_id = f"msg-{uuid.uuid4().hex[:12]}"
            yield _event(
                TEXT_MESSAGE_START, messageId=self._message_id, role="assistant"
            )

    def _close_text_message(self) -> Iterator[Dict[str, Any]]:
        if self._message_id is not None:
            yield _event(TEXT_MESSAGE_END, messageId=self._message_id)
            self._message_id = None

    # ---- main translation ----

    def run(
        self, stream: Iterable[Tuple[str, Any, Optional[str]]]
    ) -> Iterator[Dict[str, Any]]:
        """Consume agent stream tuples and yield AG-UI events."""
        try:
            for event_type, data, conv_id in stream:
                if conv_id:
                    self.thread_id = conv_id
                yield from self._translate(event_type, data)
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as RUN_ERROR
            logger.error(f"[AG-UI] stream error: {exc}")
            yield from self._ensure_run_started()
            yield from self._close_text_message()
            yield _event(RUN_ERROR, message=str(exc))
            return

        # Defensive close in case the agent never emitted a terminal event.
        if self._run_started:
            yield from self._close_text_message()

        if self._run_started:
            logger.info(
                f"[AG-UI] run finished: runId={self.run_id}, "
                f"a2ui_surfaces={self._surface_count}"
            )

    def _translate(self, event_type: str, data: Any) -> Iterator[Dict[str, Any]]:
        yield from self._ensure_run_started()

        if event_type == "thread_id":
            self.thread_id = data or self.thread_id
            return

        if event_type == "delta":
            yield from self._open_text_message()
            yield _event(
                TEXT_MESSAGE_CONTENT, messageId=self._message_id, delta=data
            )
            return

        if event_type == "done":
            yield from self._close_text_message()
            yield _event(
                RUN_FINISHED,
                threadId=self.thread_id,
                runId=self.run_id,
                outcome={"type": "success"},
            )
            return

        if event_type == "error":
            yield from self._close_text_message()
            yield _event(RUN_ERROR, message=str(data))
            return

        if event_type in ("usage", "citations"):
            yield _event(CUSTOM, name=event_type, value=_maybe_json(data))
            return

        if event_type.endswith(_START_SUFFIX):
            yield from self._handle_block_start(event_type)
            return

        if event_type.endswith(_DELTA_SUFFIX):
            yield from self._handle_block_delta(event_type, data)
            return

        if event_type == "document_title":
            yield from self._handle_document_title(data)
            return

        if event_type in BLOCK_COMPONENT_TYPES:
            yield from self._handle_block(event_type, data)
            return

        # Unknown event types pass through so no information is silently lost.
        yield _event(CUSTOM, name=event_type, value=_maybe_json(data))

    # ---- widget handling ----

    def _handle_block_start(self, event_type: str) -> Iterator[Dict[str, Any]]:
        kind = event_type[: -len(_START_SUFFIX)]
        if kind not in BLOCK_COMPONENT_TYPES:
            return

        yield from self._close_text_message()
        yield _event(STEP_STARTED, stepName=kind)

        # Text-streaming widgets get their surface opened now so subsequent
        # deltas can patch straight into the data model.
        component_type = BLOCK_COMPONENT_TYPES[kind]
        if component_type in STREAMING_PROPERTY:
            surface_id = new_surface_id(kind)
            self._streaming_surfaces[kind] = surface_id
            self._streaming_chunks[kind] = 0
            self._surface_count += 1
            logger.info(
                f"[A2-UI] streaming surface opened: kind={kind}, "
                f"component={component_type}, surface={surface_id}"
            )
            for message in open_streaming_surface(kind, surface_id):
                yield a2ui_event(message)

    def _handle_block_delta(
        self, event_type: str, data: Any
    ) -> Iterator[Dict[str, Any]]:
        kind = event_type[: -len(_DELTA_SUFFIX)]
        surface_id = self._streaming_surfaces.get(kind)
        if not surface_id:
            return

        parsed = _maybe_json(data)
        chunk = parsed.get("delta", "") if isinstance(parsed, dict) else str(parsed)
        if not chunk:
            return

        index = self._streaming_chunks.get(kind, 0)
        self._streaming_chunks[kind] = index + 1
        for message in patch_streaming_text(kind, surface_id, chunk, index):
            yield a2ui_event(message)

    def _handle_document_title(self, data: Any) -> Iterator[Dict[str, Any]]:
        surface_id = self._streaming_surfaces.get("document")
        parsed = _maybe_json(data)
        title = parsed.get("title") if isinstance(parsed, dict) else None
        if not surface_id or not title:
            return

        yield a2ui_event(
            {
                "updateDataModel": {
                    "surfaceId": surface_id,
                    "contents": [{"key": "title", "valueString": title}],
                }
            }
        )

    def _handle_block(self, event_type: str, data: Any) -> Iterator[Dict[str, Any]]:
        payload = _maybe_json(data)
        if not isinstance(payload, dict):
            logger.warning(f"[AG-UI] discarding non-dict payload for {event_type}")
            return

        yield from self._close_text_message()

        # If the widget already has an open streaming surface, finalize it in
        # place instead of creating a duplicate.
        surface_id = self._streaming_surfaces.pop(event_type, None)
        if surface_id:
            self._streaming_chunks.pop(event_type, None)
            properties = COMPONENT_PROPERTIES[BLOCK_COMPONENT_TYPES[event_type]]
            contents = [
                {"key": prop, **_typed_value(payload[prop])}
                for prop in properties
                if prop in payload and isinstance(payload[prop], str)
            ]
            logger.info(
                f"[A2-UI] streaming surface finalized: kind={event_type}, "
                f"surface={surface_id}"
            )
            if contents:
                yield a2ui_event(
                    {
                        "updateDataModel": {
                            "surfaceId": surface_id,
                            "contents": contents,
                        }
                    }
                )
        else:
            surface_id = new_surface_id(event_type)
            self._surface_count += 1
            logger.info(
                f"[A2-UI] surface created: kind={event_type}, "
                f"component={BLOCK_COMPONENT_TYPES[event_type]}, surface={surface_id}"
            )
            for message in block_to_a2ui(event_type, payload, surface_id):
                yield a2ui_event(message)

        yield _event(STEP_FINISHED, stepName=event_type)


def _typed_value(value: Any) -> Dict[str, Any]:
    """Return the A2UI typed-value field for a scalar string value."""
    return {"valueString": value if isinstance(value, str) else str(value)}


def _maybe_json(data: Any) -> Any:
    """Parse ``data`` as JSON when it is a string, else return it unchanged."""
    if not isinstance(data, str):
        return data
    try:
        return json.loads(data)
    except json.JSONDecodeError:
        return data
