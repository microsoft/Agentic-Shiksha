"""Regression tests: assistant prose must survive turns that also call tools.

Guards the bug where a turn using ask_clarification rendered the question card
but dropped the actual reply, because buffered plain text was discarded whenever
*any* tool ran rather than only when add_message had delivered the answer.
"""

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from base_agents.general_agent import GeneralAgent  # noqa: E402


PROSE = "Start with the C major scale, then practise it slowly."


def _agent_with_stream(stream_events):
    agent = GeneralAgent.__new__(GeneralAgent)
    agent.agent_name = "course-test"
    # Later rounds get empty streams so the tool loop terminates.
    agent.openai_client = SimpleNamespace(
        conversations=SimpleNamespace(
            create=Mock(return_value=SimpleNamespace(id="conversation-1")),
        ),
        responses=SimpleNamespace(
            create=Mock(side_effect=[stream_events] + [[] for _ in range(10)]),
        ),
    )
    return agent


def _function_call(name: str, call_id: str = "call-1"):
    return SimpleNamespace(
        type="response.output_item.done",
        item=SimpleNamespace(
            type="function_call", name=name, arguments="{}", call_id=call_id
        ),
    )


def _message_texts(events):
    return [
        json.loads(payload).get("content", "")
        for name, payload, _ in events
        if name == "message_block"
    ]


def _run(method_name, stream_events):
    agent = _agent_with_stream(stream_events)
    kwargs = {"user_text": "how can I start learning this course", "user_id": "student-1"}
    if method_name == "continue_chat_stream":
        kwargs["conversation_id"] = "conversation-1"
    with patch.object(agent, "_execute_tools_parallel", return_value=[]):
        return list(getattr(agent, method_name)(**kwargs))


class PlainTextEmissionTests(unittest.TestCase):
    def test_prose_survives_a_turn_that_calls_a_non_message_tool(self) -> None:
        stream = [
            SimpleNamespace(type="response.output_text.delta", delta=PROSE),
            _function_call("ask_clarification"),
        ]
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                self.assertIn(PROSE, _message_texts(_run(method_name, stream)))

    def test_prose_is_suppressed_once_add_message_delivered_the_answer(self) -> None:
        stream = [
            SimpleNamespace(type="response.output_text.delta", delta=PROSE),
            _function_call("add_message"),
        ]
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                self.assertNotIn(PROSE, _message_texts(_run(method_name, stream)))


if __name__ == "__main__":
    unittest.main()
