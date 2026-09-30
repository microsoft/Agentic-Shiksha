"""Read one model response into runtime events and deferred tool calls."""

import logging
from collections.abc import Callable, Generator, Iterable
from typing import Any

from harness.events import RuntimeEvent, tool_start_events
from harness.output import FunctionArguments, ValidatedProse
from harness.state import ResponseRound, TurnRequest
from harness.telemetry import TurnTelemetry

logger = logging.getLogger("base_agents.general_agent")


def read_response(
    stream: Iterable[Any],
    request: TurnRequest,
    telemetry: TurnTelemetry,
    render_fallback: Callable,
    *,
    previous_message_count: int,
    followup: bool,
) -> Generator[RuntimeEvent, None, ResponseRound]:
    conversation_id = request.conversation_id
    result = ResponseRound()
    function = FunctionArguments()
    prose = ValidatedProse(
        enabled=not followup or previous_message_count == 0,
        user_id=request.user_id, memory_context=request.memory_context,
    )
    phase = "continue_chat" if request.continuing else "start_chat"
    if followup:
        phase += ".followup"

    for event in stream:
        if not hasattr(event, "type"):
            if getattr(event, "output_text", None):
                yield from prose.push(event.output_text, conversation_id)
            continue
        if event.type == "response.output_text.delta":
            if getattr(event, "delta", ""):
                yield from prose.push(event.delta, conversation_id)
        elif event.type == "response.output_text.annotation.added" and not followup:
            telemetry.annotation(event)
        elif event.type == "response.output_item.added":
            item = getattr(event, "item", None)
            if getattr(item, "type", None) == "function_call":
                result.had_function_calls = True
                if followup:
                    function = FunctionArguments()
                function.name = getattr(item, "name", None)
                function.call_id = getattr(item, "call_id", None) or getattr(item, "id", None)
                function.arguments = ""
                function.content_buffer = ""
                function.title_sent = False
                if function.name == "add_message":
                    yield from prose.supersede(conversation_id)
                yield from tool_start_events(function.name, conversation_id)
        elif event.type == "response.function_call_arguments.delta":
            if getattr(event, "delta", None):
                yield from function.push(event.delta, conversation_id, initial=not followup)
        elif event.type == "response.output_item.done":
            item = getattr(event, "item", None)
            if getattr(item, "type", None) == "function_call":
                # Follow-up streams historically require the added event to mark
                # a tool round; preserve that distinction for partial SDK streams.
                if not followup:
                    result.had_function_calls = True
                name = getattr(item, "name", None)
                args = getattr(item, "arguments", function.arguments)
                call_id = getattr(item, "call_id", None) or getattr(item, "id", None)
                if name == "add_message":
                    yield from prose.supersede(conversation_id)
                result.record_call(name, args, call_id)
                function = FunctionArguments()
        elif event.type == "response.completed":
            telemetry.completed(getattr(event, "response", None), result.tool_sequence, phase)

    full_text = "".join(prose)
    if full_text.strip():
        if previous_message_count + result.add_message_count == 0:
            for emitted in prose.finish(render_fallback, conversation_id, full_text):
                result.prose_delivered = result.prose_delivered or emitted[0] == "message_block"
                yield RuntimeEvent(*emitted)
            if followup and not result.had_function_calls:
                result.stop_after_prose = True
                return result
        else:
            logger.info("[plain_text] Dropped %d chars of stray prose", len(full_text))

    if function.call_id:
        logger.warning(
            "Stream ended with unfinished function call: name=%s, call_id=%s",
            function.name, function.call_id,
        )
        result.record_call(function.name, function.arguments, function.call_id, orphan=True)
        # This asymmetry is part of the existing continuation recovery behavior.
        if followup and request.continuing and function.name == "add_message":
            result.add_message_count -= 1
    return result
