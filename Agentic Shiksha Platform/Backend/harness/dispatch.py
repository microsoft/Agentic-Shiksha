"""Tool execution, ordered parallel dispatch and clarification waits."""

import concurrent.futures
import json
import logging
import threading
from collections.abc import Callable, Mapping
from typing import Any, Dict, List, Protocol, TypedDict, NotRequired

from learner_memory.integration import MemoryToolContext, validate_tool_context
from utils import clarification_registry
from harness.events import BLOCK_TOOLS
from harness.turn_policy import RETIRED_FLASHCARD_MESSAGE, TOOL_ERROR_PREFIX

logger = logging.getLogger("base_agents.general_agent")


class Tool(Protocol):
    def execute(self, args: Any, **context: Any) -> Any: ...
    def output(self, result: Any, args: Any) -> str: ...


class ToolCall(TypedDict):
    name: str
    args: Any
    call_id: str


class PlanData(TypedDict):
    tools: list[str]
    accepted: bool


class ClarificationWait(TypedDict):
    id: str
    questions: list


class ToolResult(TypedDict):
    call_id: str
    output: str
    yield_events: list[tuple[str, str, str | None]]
    tool_type: str
    is_add_message: bool
    plan_data: PlanData | None
    await_clarification: NotRequired[ClarificationWait]


def dispatch_tool_call(
    agent_name: str,
    tools: Mapping[str, Tool],
    logging_tools: Mapping[str, Tool],
    func_name: str,
    func_args_str: str,
    call_id: str,
    conversation_id: str,
    user_id: str,
    memory_context: MemoryToolContext | None = None,
) -> ToolResult:
    """
    Execute a single tool call and return a structured result.

    Returns a dict with:
      call_id     – echoed back for tool-output submission
      output      – string to send as function_call_output to the model
      yield_events – list of (event_type, data, conv_id) tuples to yield
      tool_type   – the function name (for tool_types_this_round)
      is_add_message – convenience flag
      plan_data   – populated only for declare_plan (caller must handle)
    """
    result: ToolResult = {
        "call_id": call_id,
        "output": "",
        "yield_events": [],
        "tool_type": func_name,
        "is_add_message": func_name == "add_message",
        "plan_data": None,
    }

    if func_name == "add_flashcard":
        logger.warning("Blocked a retired flashcard tool call")
        result["output"] = f"{TOOL_ERROR_PREFIX}{RETIRED_FLASHCARD_MESSAGE}"
        result["yield_events"].append(("error", RETIRED_FLASHCARD_MESSAGE, conversation_id))
        return result

    try:
        args = json.loads(func_args_str) if isinstance(func_args_str, str) else func_args_str
        if func_name in {"get_threshold_concepts", "update_topic_progress", "add_quiz"}:
            validate_tool_context(memory_context, agent_name, user_id)
        memory_kwargs = (
            {"memory_context": memory_context, "call_id": call_id}
            if memory_context is not None else {}
        )

        if func_name == "add_document":
            doc_data = tools["add_document"].execute(args)
            result["yield_events"].append(("document", json.dumps(doc_data), conversation_id))
            result["output"] = tools["add_document"].output(doc_data, args)
            logger.info(f"add_document tool called: {doc_data.get('title')}")

        elif func_name == "add_message":
            msg_data = tools["add_message"].execute(args)
            result["yield_events"].append(("message_block", json.dumps(msg_data), conversation_id))
            result["output"] = tools["add_message"].output(msg_data, args)
            logger.info("add_message tool called")

        elif func_name == "add_quiz":
            quiz_data = tools["add_quiz"].execute(
                args, agent_name=agent_name, user_id=user_id, **memory_kwargs
            )
            result["yield_events"].append(("quiz", json.dumps(quiz_data), conversation_id))
            result["output"] = tools["add_quiz"].output(quiz_data, args)
            logger.info(f"add_quiz tool called: {quiz_data.get('title')}")

        elif func_name == "add_challenge":
            ch_data = tools["add_challenge"].execute(args)
            result["yield_events"].append(("challenge", json.dumps(ch_data), conversation_id))
            result["output"] = tools["add_challenge"].output(ch_data, args)
            logger.info(f"add_challenge tool called: {ch_data.get('title')}")

        elif func_name == "add_circuit":
            circuit_data = tools["add_circuit"].execute(args)
            result["yield_events"].append(("circuit", json.dumps(circuit_data), conversation_id))
            result["output"] = tools["add_circuit"].output(circuit_data, args)

        elif func_name == "add_slides":
            slides_data = tools["add_slides"].execute(args)
            result["yield_events"].append(("slides", json.dumps(slides_data), conversation_id))
            result["output"] = tools["add_slides"].output(slides_data, args)

        elif func_name == "ask_clarification":
            clarify_data = tools["ask_clarification"].execute(args)
            # The wait happens in the caller, after this event has been flushed to the client.
            clarify_id = clarification_registry.register(user_id, len(clarify_data["questions"]))
            clarify_data["clarifyId"] = clarify_id
            result["yield_events"].append(("clarify", json.dumps(clarify_data), conversation_id))
            result["await_clarification"] = {
                "id": clarify_id,
                "questions": clarify_data["questions"],
            }
            result["output"] = tools["ask_clarification"].output(clarify_data, args)
            logger.info(f"ask_clarification tool called: {len(clarify_data['questions'])} question(s)")

        elif func_name == "suggest_next_queries":
            suggestions_data = tools["suggest_next_queries"].execute(args)
            result["yield_events"].append(
                ("suggested_queries", json.dumps(suggestions_data), conversation_id)
            )
            result["output"] = tools["suggest_next_queries"].output(suggestions_data, args)
            logger.info(f"suggest_next_queries tool called: {len(suggestions_data.get('queries', []))}")

        elif func_name == "add_tikz_diagram":
            tikz_data = tools["add_tikz_diagram"].execute(args)
            if tikz_data.get("error"):
                raise RuntimeError(
                    tikz_data.get("caption") or "TikZ diagram generation failed"
                )
            result["yield_events"].append(("tikz_image", json.dumps(tikz_data), conversation_id))
            result["output"] = tools["add_tikz_diagram"].output(tikz_data, args)
            logger.info(f"add_tikz_diagram tool called: {tikz_data.get('title')}")

        elif func_name == "generate_image":
            img_data = tools["generate_image"].execute(
                args, agent_name=agent_name, user_id=user_id
            )
            result["yield_events"].append(("generated_image", json.dumps(img_data), conversation_id))
            result["output"] = tools["generate_image"].output(img_data, args)
            if img_data.get("error"):
                logger.warning(f"generate_image FAILED: {img_data.get('caption')}")
            else:
                logger.info(f"generate_image tool called: {img_data.get('title')}")

        elif func_name == "declare_plan":
            plan_result = tools["declare_plan"].execute(args)
            plan_tools = args.get("tools", [])
            if plan_result.get("status") == "accepted" and plan_tools:
                result["plan_data"] = {"tools": plan_tools, "accepted": True}
                result["output"] = tools["declare_plan"].output(plan_result, args)
                logger.info(f"Plan declared: {' -> '.join(plan_tools)}")
            else:
                result["plan_data"] = {"tools": [], "accepted": False}
                result["output"] = plan_result.get("message", "Just respond normally.")
                logger.info(f"Plan skipped (status={plan_result.get('status')})")

        elif func_name == "get_threshold_concepts":
            plan_data = tools["get_threshold_concepts"].execute(
                args, agent_name=agent_name, user_id=user_id, **memory_kwargs
            )
            plan_output = tools["get_threshold_concepts"].output(plan_data, args)
            result["output"] = plan_output
            logger.info(f"get_threshold_concepts for '{agent_name}' ({len(plan_output)} chars)")

        elif func_name == "update_topic_progress":
            if memory_context is not None:
                actual_result = tools["update_topic_progress"].execute(
                    args, agent_name=agent_name, user_id=user_id, **memory_kwargs
                )
                result["output"] = tools["update_topic_progress"].output(actual_result, args)
                return result
            # ── Fire-and-forget: return immediately, run DB write in background ──
            # The model doesn't need the exact result to compose its response.
            result["output"] = (
                "Progress update accepted and is being saved in the background. "
                "Continue with your response to the student."
            )
            # Launch background thread for the actual Cosmos DB write
            _agent_name = agent_name
            _user_id = user_id

            def _bg_update_progress(a=args, an=_agent_name, uid=_user_id):
                try:
                    actual_result = tools["update_topic_progress"].execute(
                        a, agent_name=an, user_id=uid
                    )
                    actual_output = tools["update_topic_progress"].output(actual_result, a)
                    logger.info(f"Background update_topic_progress completed: {actual_output[:120]}")
                except Exception as bg_err:
                    logger.error(f"Background update_topic_progress failed: {bg_err}")

            threading.Thread(target=_bg_update_progress, daemon=True).start()
            logger.info(f"update_topic_progress fired-and-forgot for '{agent_name}'")

        elif func_name in logging_tools:
            if memory_context is not None:
                result["output"] = (
                    f"{TOOL_ERROR_PREFIX}Teacher analytics are unavailable in a learner chat. "
                    "Use get_threshold_concepts for this authorized learner only."
                )
                return result
            logging_tool = logging_tools[func_name]
            logging_result = logging_tool.execute(args)
            result_str = logging_tool.output(logging_result, args)
            result["output"] = result_str
            logger.info(f"Logging tool '{func_name}' called ({len(result_str)} chars)")

        else:
            logger.info(f"Unknown function call: {func_name}")
            result["output"] = f"Tool '{func_name}' executed successfully."

    except Exception as e:
        if memory_context is not None:
            logger.warning("Scoped tool execution failed (%s)", type(e).__name__)
            if func_name in BLOCK_TOOLS:
                result["yield_events"].append((
                    "block_cancel", json.dumps({"type": "block_cancel", "tool": func_name}), conversation_id,
                ))
            result["output"] = (
                f"{TOOL_ERROR_PREFIX}The authorized operation could not be completed. "
                "No learner state was changed by this tool. Use the scoped context and retry."
            )
            return result
        logger.error(f"Failed to handle {func_name}: {e}")
        if func_name in BLOCK_TOOLS:
            # The frontend already drew a placeholder card on *_start; tell it to drop it.
            result["yield_events"].append((
                "block_cancel",
                json.dumps({"type": "block_cancel", "tool": func_name}),
                conversation_id,
            ))
            result["output"] = (
                f"{TOOL_ERROR_PREFIX}{e}\n"
                "Nothing was shown to the student. Do NOT write this content out as plain "
                "text in your reply. Either call the tool again with corrected arguments, "
                "or briefly tell the student it could not be created."
            )
        else:
            result["output"] = f"{TOOL_ERROR_PREFIX}{e}"

    return result


def execute_tools_parallel(
    dispatch: Callable[..., ToolResult],
    collected_calls: list[ToolCall],
    conversation_id: str,
    user_id: str,
    memory_context: MemoryToolContext | None = None,
) -> list[ToolResult]:
    """
    Execute a batch of tool calls in parallel using ThreadPoolExecutor.

    Args:
        collected_calls: list of dicts with keys 'name', 'args', 'call_id'
        conversation_id: the conversation ID
        user_id: the requesting user, threaded explicitly so concurrent
            requests sharing this cached agent never see each other's id

    Returns:
        List of result dicts from _dispatch_tool_call(), preserving original order.
    """
    if not collected_calls:
        return []

    memory_kwargs = {"memory_context": memory_context} if memory_context is not None else {}
    n = len(collected_calls)
    if n == 1:
        # Single call — no thread overhead
        tc = collected_calls[0]
        return [dispatch(tc["name"], tc["args"], tc["call_id"], conversation_id, user_id, **memory_kwargs)]

    logger.info(f"Executing {n} tool calls in parallel")
    results: dict[int, ToolResult] = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(n, 6)) as executor:
        future_to_idx = {
            executor.submit(
                dispatch,
                tc["name"], tc["args"], tc["call_id"], conversation_id, user_id,
                **memory_kwargs,
            ): i
            for i, tc in enumerate(collected_calls)
        }
        for future in concurrent.futures.as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                tc = collected_calls[idx]
                logger.error(f"Parallel tool execution failed for {tc['name']}: {e}")
                results[idx] = {
                    "call_id": tc["call_id"],
                    "output": f"Error: {e}",
                    "yield_events": [],
                    "tool_type": tc["name"],
                    "is_add_message": tc["name"] == "add_message",
                    "plan_data": None,
                }

    return [results[index] for index in range(n)]


def resolve_clarification(result: ToolResult, conversation_id: str, wait_for_answers: Callable):
    """Block for the student's answers so the agent can finish this same turn.

    Must be called only after the tool's ``clarify`` event has been yielded,
    otherwise the client never sees the questions and the wait always times out.
    """
    pending = result.get("await_clarification")
    if not pending:
        return
    result["output"] = wait_for_answers(
        pending["id"], pending["questions"]
    )
    yield ("clarification_done", json.dumps({"clarifyId": pending["id"]}), conversation_id)

