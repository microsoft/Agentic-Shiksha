"""Pure stopping and declared-plan retry policy; no model or persistence calls."""

NON_CONTENT_TOOLS = frozenset({
    "memory_search_call", "memory_search", "file_search",
    "get_threshold_concepts", "update_topic_progress", "declare_plan",
})
TURN_ENDING_TOOLS = frozenset({"suggest_next_queries"})
TOOL_ERROR_PREFIX = "Error: "
RETIRED_FLASHCARD_MESSAGE = (
    "Flashcards are no longer supported. Use notes, quizzes, or practice challenges instead."
)


def rewind_failed_plan_step(
    execution_plan: list,
    plan_index: int,
    tool_round: int,
    last_round_failed: bool,
) -> int:
    if (
        last_round_failed
        and 0 < plan_index <= len(execution_plan)
        and tool_round <= len(execution_plan)
    ):
        return plan_index - 1
    return plan_index


def round_ends_turn(
    tool_types: set,
    execution_plan: list,
    plan_index: int,
    tool_round: int,
    add_message_count: int = 1,
    prose_delivered: bool = False,
) -> bool:
    plan_remaining = bool(execution_plan) and plan_index < len(execution_plan)
    if tool_types & TURN_ENDING_TOOLS:
        other_content = (tool_types - NON_CONTENT_TOOLS) - TURN_ENDING_TOOLS
        content_delivered = prose_delivered or add_message_count > 0 or bool(other_content)
        return content_delivered and not plan_remaining
    content_tools = tool_types - NON_CONTENT_TOOLS
    return not plan_remaining and content_tools == {"add_message"}
