"""One turn executor with explicit model, tool and history dependencies."""

from collections.abc import Callable, Generator, Iterable
from dataclasses import dataclass
import logging
import re
from typing import Any

from harness.dispatch import ToolResult
from harness.events import RuntimeEvent
from harness.finalization import completion_events, record_final_outputs
from harness.response_stream import read_response
from harness.state import ResponseRound, TurnRequest, TurnState
from harness.telemetry import TurnTelemetry

logger = logging.getLogger("base_agents.general_agent")


@dataclass(frozen=True)
class TurnDependencies:
    create_response: Callable[..., Any]
    write_items: Callable[..., Any]
    execute_tools: Callable[..., list[ToolResult]]
    resolve_clarification: Callable[..., Iterable[tuple[str, str, str | None]]]
    render_fallback: Callable[..., Iterable[tuple[str, str, str | None]]]


class TurnExecutor:
    def __init__(self, request: TurnRequest, dependencies: TurnDependencies) -> None:
        self.request = request
        self.dependencies = dependencies
        self.state = TurnState()

    def _open_initial_response(self, model_input: Any) -> Iterable[Any]:
        request = self.request
        attempts = 5 if request.continuing else 1
        for attempt in range(attempts):
            try:
                response = self.dependencies.create_response(
                    conversation=request.conversation_id,
                    tool_choice=request.tool_choice,
                    input=model_input,
                    stream=True,
                    extra_body={"agent_reference": request.agent_reference},
                )
                if request.continuing and response is None:
                    break
                return response
            except Exception as error:
                message = str(error)
                stale = (
                    re.search(r"function call (call_\w+)", message)
                    if request.continuing
                    and "400" in message
                    and "No tool output found for function call" in message
                    else None
                )
                if not stale:
                    raise
                call_id = stale.group(1)
                logger.warning(
                    "Stale function call detected: %s, submitting dummy output (attempt %s)",
                    call_id, attempt + 1,
                )
                try:
                    self.dependencies.create_response(
                        conversation=request.conversation_id,
                        input=[{
                            "type": "function_call_output", "call_id": call_id,
                            "output": "Tool execution completed (recovered from stale state).",
                        }],
                        stream=False,
                        extra_body={"agent_reference": request.agent_reference},
                    )
                except Exception as error:
                    logger.error("Failed to resolve stale function call %s: %s", call_id, error)
        raise RuntimeError("Failed to create response stream after resolving stale function calls")

    def _execute_round(self, result: ResponseRound) -> Generator[RuntimeEvent, None, None]:
        if not result.calls:
            return
        request = self.request
        memory_kwargs = (
            {"memory_context": request.memory_context} if request.memory_context is not None else {}
        )
        results = self.dependencies.execute_tools(
            result.calls, request.conversation_id, request.user_id, **memory_kwargs
        )
        for tool_result in results:
            for event in tool_result["yield_events"]:
                yield RuntimeEvent(*event)
            for event in self.dependencies.resolve_clarification(tool_result, request.conversation_id):
                yield RuntimeEvent(*event)
            self.state.accept_tool_result(tool_result)

    def run(
        self,
        model_input: Any,
        web_citations: list[dict[str, Any]],
        course_citations: list[dict[str, Any]],
        course_usage: dict[str, Any] | None,
    ) -> Generator[RuntimeEvent, None, None]:
        response = self._open_initial_response(model_input)
        telemetry = TurnTelemetry(web_citations, course_citations, course_usage)
        result = yield from read_response(
            response, self.request, telemetry, self.dependencies.render_fallback,
            previous_message_count=0, followup=False,
        )
        self.state.finish_round(result)
        yield from self._execute_round(result)

        while self.state.pending_outputs:
            if self.state.reply_complete():
                saved = yield from record_final_outputs(
                    self.dependencies.write_items, self.request.conversation_id,
                    self.state.pending_outputs,
                )
                if not saved:
                    return
                break
            tool_choice = self.state.advance_plan(self.request.tool_choice)
            outputs = self.state.pending_outputs
            self.state.pending_outputs = []
            try:
                response = self.dependencies.create_response(
                    conversation=self.request.conversation_id,
                    input=outputs,
                    stream=True,
                    tool_choice=tool_choice,
                    extra_body={"agent_reference": self.request.agent_reference},
                )
                result = yield from read_response(
                    response, self.request, telemetry, self.dependencies.render_fallback,
                    previous_message_count=self.state.total_add_message_count, followup=True,
                )
                self.state.finish_round(result)
                if result.stop_after_prose:
                    break
                yield from self._execute_round(result)
            except Exception as error:
                # Preserve the legacy follow-up failure boundary: log and emit
                # already-collected telemetry/completion, without a retry.
                logger.error("Error submitting tool outputs: %s", error)
                break
        yield from completion_events(telemetry, self.request.conversation_id)
