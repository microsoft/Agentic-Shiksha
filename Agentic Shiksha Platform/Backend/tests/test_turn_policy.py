import pytest

from harness.turn_policy import rewind_failed_plan_step, round_ends_turn


@pytest.mark.parametrize("tool_round", [0, 1, 4, 100])
def test_delivered_message_stops_without_a_followup_call(tool_round):
    assert round_ends_turn({"add_message", "update_topic_progress"}, [], 0, tool_round)


@pytest.mark.parametrize("tools", [
    {"add_document"}, {"suggest_next_queries"}, {"declare_plan"}, set(),
])
def test_tools_without_a_completed_answer_do_not_short_circuit(tools):
    assert not round_ends_turn(tools, [], 0, 0, 0)


@pytest.mark.parametrize("prose_delivered,message_count", [(True, 0), (False, 1)])
def test_suggestions_end_only_after_content_and_after_the_plan(prose_delivered, message_count):
    arguments = ({"suggest_next_queries"}, ["add_document"], 1, 1, message_count, prose_delivered)
    assert round_ends_turn(*arguments)
    assert not round_ends_turn(
        {"suggest_next_queries"}, ["add_document"], 0, 1, message_count, prose_delivered
    )


@pytest.mark.parametrize("index,round_number,failed,expected", [
    (0, 0, True, 0),
    (1, 1, True, 0),
    (2, 2, True, 1),
    (2, 3, True, 2),
    (3, 2, True, 3),
    (1, 1, False, 1),
])
def test_plan_rewind_is_bounded_by_rounds_not_a_new_retry_budget(
    index, round_number, failed, expected
):
    assert rewind_failed_plan_step(["add_message", "add_document"], index, round_number, failed) == expected
