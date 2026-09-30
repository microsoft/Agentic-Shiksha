"""Mutable state belongs to a single turn, never to the cached GeneralAgent."""

from dataclasses import dataclass, field
from typing import Any, TYPE_CHECKING, TypedDict

from harness.dispatch import ToolCall, ToolResult
from harness.turn_policy import TOOL_ERROR_PREFIX, rewind_failed_plan_step, round_ends_turn

if TYPE_CHECKING:
    from learner_memory.integration import MemoryToolContext


class ToolOutput(TypedDict):
    type: str
    call_id: str
    output: str


@dataclass(frozen=True)
class TurnRequest:
    conversation_id: str
    user_id: str
    tool_choice: str
    agent_reference: dict[str, Any]
    continuing: bool = False
    memory_context: "MemoryToolContext | None" = None


@dataclass
class ResponseRound:
    calls: list[ToolCall] = field(default_factory=list)
    tool_types: set[str] = field(default_factory=set)
    tool_sequence: list[str] = field(default_factory=list)
    add_message_count: int = 0
    had_function_calls: bool = False
    prose_delivered: bool = False
    stop_after_prose: bool = False

    def record_call(self, name: str, args: Any, call_id: str, *, orphan: bool = False) -> None:
        self.calls.append({"name": name, "args": args, "call_id": call_id})
        self.tool_types.add(name)
        if not orphan:
            self.tool_sequence.append(name)
        if name == "add_message":
            self.add_message_count += 1


@dataclass
class TurnState:
    execution_plan: list[str] = field(default_factory=list)
    plan_index: int = 0
    tool_round: int = 0
    total_add_message_count: int = 0
    prose_delivered: bool = False
    current_round: ResponseRound = field(default_factory=ResponseRound)
    pending_outputs: list[ToolOutput] = field(default_factory=list)

    def finish_round(self, result: ResponseRound) -> None:
        self.current_round = result
        self.total_add_message_count += result.add_message_count
        self.prose_delivered = self.prose_delivered or result.prose_delivered

    def accept_tool_result(self, result: ToolResult) -> None:
        self.pending_outputs.append({
            "type": "function_call_output", "call_id": result["call_id"], "output": result["output"],
        })
        plan = result["plan_data"]
        if plan and plan["accepted"]:
            self.execution_plan = plan["tools"]
            self.plan_index = 0

    def last_round_failed(self) -> bool:
        return any(
            str(output.get("output", "")).startswith(TOOL_ERROR_PREFIX)
            for output in self.pending_outputs
        )

    def reply_complete(self) -> bool:
        return not self.last_round_failed() and round_ends_turn(
            self.current_round.tool_types, self.execution_plan, self.plan_index,
            self.tool_round, self.total_add_message_count, self.prose_delivered,
        )

    def advance_plan(self, default_tool_choice: str) -> str | dict[str, str]:
        self.tool_round += 1
        self.plan_index = rewind_failed_plan_step(
            self.execution_plan, self.plan_index, self.tool_round, self.last_round_failed()
        )
        if self.execution_plan and self.plan_index < len(self.execution_plan):
            next_tool = self.execution_plan[self.plan_index]
            self.plan_index += 1
            return {"type": "function", "name": next_tool}
        if self.execution_plan and self.plan_index >= len(self.execution_plan):
            return "none"
        return default_tool_choice
