"""Regression tests for automatic live web grounding in GeneralAgent."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from base_agents.general_agent import GeneralAgent  # noqa: E402


WEB_URL = "https://github.com/swapnik-iitkgp/Reinforcement-Learning/releases"
WEB_CITATION = {
    "type": "url",
    "title": "GitHub releases",
    "url": WEB_URL,
}


def _web_response(*, include_search_call: bool = True):
    annotation = SimpleNamespace(
        type="url_citation",
        title="GitHub releases",
        url=WEB_URL,
    )
    message = SimpleNamespace(
        type="message",
        content=[SimpleNamespace(annotations=[annotation])],
    )
    output = [message]
    if include_search_call:
        output.insert(0, SimpleNamespace(type="web_search_call", content=[]))
    return SimpleNamespace(
        output=output,
        output_text=f"The repository has no formal releases. Source: {WEB_URL}",
    )


def _agent_with_stream(stream_events):
    agent = GeneralAgent.__new__(GeneralAgent)
    agent.agent_name = "course-test"
    agent.openai_client = SimpleNamespace(
        conversations=SimpleNamespace(
            create=Mock(return_value=SimpleNamespace(id="conversation-1")),
        ),
        responses=SimpleNamespace(create=Mock(return_value=stream_events)),
    )
    return agent


class GeneralAgentWebSearchTests(unittest.TestCase):
    def test_live_search_is_forced_and_builds_disclosure_context(self) -> None:
        agent = GeneralAgent.__new__(GeneralAgent)
        create_response = Mock(return_value=_web_response())
        agent.openai_client = SimpleNamespace(
            responses=SimpleNamespace(create=create_response),
        )

        context, citations = agent._get_live_web_context("What is the latest release?")

        kwargs = create_response.call_args.kwargs
        self.assertEqual(kwargs["model"], "gpt-4.1")
        self.assertEqual(kwargs["tool_choice"], {"type": "web_search_preview"})
        self.assertEqual(kwargs["tools"][0]["type"], "web_search_preview")
        self.assertIn("briefly and explicitly tell the student", context or "")
        self.assertIn(WEB_URL, context or "")
        self.assertEqual(citations, [WEB_CITATION])

    def test_disclosure_context_requires_a_real_web_search_call(self) -> None:
        agent = GeneralAgent.__new__(GeneralAgent)
        agent.openai_client = SimpleNamespace(
            responses=SimpleNamespace(
                create=Mock(return_value=_web_response(include_search_call=False)),
            ),
        )

        context, citations = agent._get_live_web_context("What is current?")

        self.assertIsNone(context)
        self.assertEqual(citations, [])

    def test_new_and_continued_streams_propagate_web_citations(self) -> None:
        stream_events = [
            SimpleNamespace(
                type="response.output_text.delta",
                delta="I searched the web before answering.",
            ),
        ]

        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream(stream_events)
                with patch.object(
                    agent,
                    "_get_live_web_context",
                    return_value=("verified live evidence", [WEB_CITATION]),
                ) as search:
                    method = getattr(agent, method_name)
                    kwargs = {
                        "user_text": "Find the latest release",
                        "user_id": "student-1",
                        "web_search_enabled": True,
                    }
                    if method_name == "continue_chat_stream":
                        kwargs["conversation_id"] = "conversation-1"
                    events = list(method(**kwargs))

                search.assert_called_once_with("Find the latest release")
                response_kwargs = agent.openai_client.responses.create.call_args.kwargs
                self.assertEqual(response_kwargs["tool_choice"], "auto")
                self.assertIn("verified live evidence", str(response_kwargs["input"]))
                citation_events = [data for event, data, _ in events if event == "citations"]
                self.assertEqual(len(citation_events), 1)
                self.assertIn(WEB_URL, citation_events[0])
                self.assertEqual(events[-1][0], "done")

    def test_web_search_is_disabled_by_default(self) -> None:
        stream_events = [
            SimpleNamespace(type="response.output_text.delta", delta="Course answer"),
        ]

        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream(stream_events)
                with patch.object(agent, "_get_live_web_context") as search:
                    method = getattr(agent, method_name)
                    kwargs = {
                        "user_text": "Explain learned representations",
                        "user_id": "student-1",
                    }
                    if method_name == "continue_chat_stream":
                        kwargs["conversation_id"] = "conversation-1"
                    events = list(method(**kwargs))

                search.assert_not_called()
                self.assertFalse(any(event == "citations" for event, _, _ in events))
                self.assertEqual(events[-1][0], "done")

    def test_web_search_is_disabled_for_greetings(self) -> None:
        stream_events = [
            SimpleNamespace(type="response.output_text.delta", delta="Hi!"),
        ]

        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream(stream_events)
                with patch.object(agent, "_get_live_web_context") as search:
                    method = getattr(agent, method_name)
                    kwargs = {
                        "user_text": "hi",
                        "user_id": "student-1",
                        "web_search_enabled": True,
                    }
                    if method_name == "continue_chat_stream":
                        kwargs["conversation_id"] = "conversation-1"
                    events = list(method(**kwargs))

                search.assert_not_called()
                response_kwargs = agent.openai_client.responses.create.call_args.kwargs
                self.assertIn(
                    "GREETING RESPONSE RULE",
                    str(response_kwargs["input"]),
                )
                self.assertFalse(any(event == "citations" for event, _, _ in events))
                self.assertEqual(events[-1][0], "done")


if __name__ == "__main__":
    unittest.main()