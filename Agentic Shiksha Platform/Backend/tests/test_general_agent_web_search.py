"""Regression tests for web and course-material grounding in GeneralAgent."""

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from base_agents.general_agent import GeneralAgent, with_suggested_queries  # noqa: E402
from backend.schemas.course_materials import CourseMaterialSource


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


class CourseSuggestionTests(unittest.TestCase):
    def test_answer_completion_never_waits_for_generated_suggestions(self) -> None:
        agent = _agent_with_stream([])
        agent.generate_next_queries = Mock(side_effect=AssertionError("Must not block the answer"))
        stream = iter([
            ("message_block", json.dumps({"content": "An electrical example."}), "conversation-1"),
            ("done", "", "conversation-1"),
        ])
        events = list(with_suggested_queries(stream, agent, "Explain current"))
        self.assertEqual(events[-1][0], "done")
        agent.generate_next_queries.assert_not_called()

    def test_followups_receive_course_context_and_bounded_request(self) -> None:
        agent = _agent_with_stream([])
        queries = ["How do I measure current?", "Can I try a circuit example?", "Check my current measurement reasoning."]
        client = Mock()
        client.responses.create.return_value = SimpleNamespace(status="completed", output_text=json.dumps({"queries": queries}))
        agent.openai_client.with_options = Mock(return_value=client)
        context = {"name": "Example Electrical", "description": "Circuit measurement"}
        self.assertEqual(agent.generate_next_queries("Explain current", "Measure in series.", course_context=context), queries)
        agent.openai_client.with_options.assert_called_once_with(timeout=8, max_retries=0)
        request = client.responses.create.call_args.kwargs
        self.assertEqual(json.loads(request["input"])["course"], context)
        self.assertFalse(request["store"])
        self.assertNotIn("conversation", request)
        self.assertNotIn("tools", request)
        self.assertIn("Stay within this course", request["instructions"])

    def test_invalid_followups_do_not_replace_the_completed_answer(self) -> None:
        agent = _agent_with_stream([])
        client = Mock()
        agent.openai_client.with_options = Mock(return_value=client)
        for payload in ({"queries": ["Duplicate"] * 3}, {"queries": ["Only one"]}):
            client.responses.create.return_value = SimpleNamespace(status="completed", output_text=json.dumps(payload))
            self.assertEqual(agent.generate_next_queries("Explain current", "An answer"), [])

    def test_suggestion_endpoint_requires_course_access(self) -> None:
        from fastapi import FastAPI, HTTPException
        from fastapi.testclient import TestClient
        from backend.dependencies.auth import ActiveUser, get_current_active_user
        from backend.routers import chat_suggestions

        app = FastAPI()
        app.include_router(chat_suggestions.router)
        client = TestClient(app)
        path = "/api/agents/course-example/chat/suggestions"
        payload = {"question": "Explain current", "answer": "Measure in series."}
        self.assertEqual(client.post(path, json=payload).status_code, 401)
        app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="student-1", role="student", status="active")
        with patch.object(chat_suggestions, "require_course", side_effect=HTTPException(403)), patch.object(chat_suggestions, "get_general_agent") as get_agent:
            self.assertEqual(client.post(path, json=payload).status_code, 403)
            get_agent.assert_not_called()

    def test_greeting_suggestions_name_the_course_without_another_model_call(self) -> None:
        agent = _agent_with_stream([])
        agent.agent_name = "course-Example-Electrical"
        queries = agent.generate_next_queries("hi", "Hi! What can I help with?")
        self.assertEqual(len(queries), 3)
        self.assertTrue(all("Example Electrical" in query for query in queries))
        self.assertFalse(any("math homework" in query for query in queries))
        agent.openai_client.responses.create.assert_not_called()

    def test_greeting_replaces_generic_model_followups_with_course_questions(self) -> None:
        agent = _agent_with_stream([])
        agent.agent_name = "course-Example-Electrical"
        stream = iter([
            ("message_block", json.dumps({"content": "Hi!"}), "conversation-1"),
            ("suggested_queries", json.dumps({"queries": ["Help me with math homework"]}), "conversation-1"),
            ("done", "", "conversation-1"),
        ])
        events = list(with_suggested_queries(stream, agent, "hi"))
        suggestions = [json.loads(data)["queries"] for kind, data, _ in events if kind == "suggested_queries"]
        self.assertEqual(suggestions, [agent.generate_next_queries("hi", "")])
        self.assertEqual(events[-1][0], "done")
        agent.openai_client.responses.create.assert_not_called()


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
                self.assertEqual(len(citation_events), 1, events)
                self.assertIn(WEB_URL, citation_events[0])
                self.assertEqual(events[-1][0], "done", events)

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
                self.assertEqual(events[-1][0], "done", events)

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


class GeneralAgentCourseMaterialsTests(unittest.TestCase):
    def course_agent(self, stream_events):
        agent = _agent_with_stream(stream_events)
        agent.session_id = "example-session"
        tool = {
            "type": "azure_ai_search",
            "azure_ai_search": {"indexes": [{
                "project_connection_id": "example-connection",
                "index_name": "example-index",
                "filter": "session_id eq 'example-session'",
                "query_type": "vector_semantic_hybrid",
                "top_k": 20,
            }]},
        }
        definition = SimpleNamespace(
            model="example-model",
            tools=[SimpleNamespace(type="azure_ai_search", as_dict=Mock(return_value=tool))],
        )
        agent.project_client = SimpleNamespace(agents=SimpleNamespace(get=Mock(
            return_value=SimpleNamespace(versions=SimpleNamespace(latest=SimpleNamespace(definition=definition))),
        )))
        agent.retrieval = self.enterContext(patch("base_agents.general_agent.retrieve_course_passages", return_value=[
            CourseMaterialSource(
                citation_id="course-" + "a" * 24, title="notes.pdf", filename="notes.pdf",
                url="/api/agents/course-test/course-materials/file?filename=notes.pdf&kb_scope=course",
                excerpt="Verified course evidence.", page_number=3,
            ),
        ]))
        return agent

    def test_file_questions_retrieve_before_new_and_continued_streams(self) -> None:
        questions = (
            "What content is in the uploaded file?",
            "Can you answer questions from this document?",
            "What are the main topics in that file?",
            "Summarize the course materials",
            "What is in example_guide.docx?",
            "get me starting content of this file along with citation: Papers__Example.docx",
        )
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            for question in questions:
                with self.subTest(method=method_name, question=question):
                    agent = self.course_agent([
                        SimpleNamespace(type="response.output_text.delta", delta="Grounded answer"),
                    ])
                    kwargs = {"user_text": question, "user_id": "student-1"}
                    if method_name == "continue_chat_stream":
                        kwargs["conversation_id"] = "conversation-1"
                    events = list(getattr(agent, method_name)(**kwargs))

                    request = agent.openai_client.responses.create.call_args.kwargs
                    self.assertEqual(request["tool_choice"], "auto")
                    self.assertEqual(request["input"][0]["role"], "developer")
                    self.assertIn("retrieval has already run", request["input"][0]["content"])
                    self.assertIn("Verified course evidence", request["input"][1]["content"])
                    self.assertEqual(request["input"][-1]["content"], question)
                    self.assertNotIn("tools", request)
                    self.assertEqual(request["extra_body"]["agent_reference"]["name"], "course-test")
                    self.assertNotIn("agent", request["extra_body"])
                    definition = agent.project_client.agents.get.return_value.versions.latest.definition
                    agent.retrieval.assert_called_once_with(
                        "course-test", "example-session", question,
                        definition.tools[0].as_dict()["azure_ai_search"]["indexes"][0],
                    )
                    self.assertTrue(any(event == "citations" for event, _, _ in events))
                    sources = next(json.loads(data) for event, data, _ in events if event == "citations")
                    self.assertEqual(sources[0]["excerpt"], "Verified course evidence.")
                    self.assertEqual(sources[0]["page_number"], 3)
                    self.assertIn("#source-course-", request["input"][1]["content"])

    def test_unrelated_requests_and_explicit_no_tools_are_unchanged(self) -> None:
        cases = (
            ("Hi!", "example-session", "auto"),
            ("Explain group dynamics", "example-session", "auto"),
            ("Create a document about teamwork", "example-session", "auto"),
            ("What is in the file?", None, "auto"),
            ("What is in the file?", "example-session", "none"),
        )
        for question, session, choice in cases:
            with self.subTest(question=question, session=session, choice=choice):
                agent = self.course_agent([])
                agent.session_id = session
                model_input, citations, usage = agent._prepare_course_material_request(
                    question, question, choice
                )
                self.assertEqual(model_input, question)
                self.assertEqual(citations, [])
                self.assertIsNone(usage)
                agent.project_client.agents.get.assert_not_called()
                agent.retrieval.assert_not_called()

    def test_material_request_preserves_existing_context_and_images(self) -> None:
        agent = self.course_agent([])
        messages = [
            {"type": "message", "role": "user", "content": "Profile context"},
            {"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": "Compare this image with the textbook"},
                {"type": "input_image", "image_url": "https://example.com/image.png"},
            ]},
        ]
        prepared, citations, usage = agent._prepare_course_material_request(
            messages, "Compare this image with the textbook", "required"
        )
        self.assertEqual(prepared[2:], messages)
        self.assertEqual(len(messages), 2)
        self.assertEqual(citations[0]["filename"], "notes.pdf")
        self.assertIsNone(usage)

    def test_followup_returns_to_automatic_tool_choice(self) -> None:
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = self.course_agent([])
                agent.openai_client.responses.create.side_effect = [
                    [SimpleNamespace(
                        type="response.output_item.done",
                        item=SimpleNamespace(
                            type="function_call", name="get_threshold_concepts",
                            arguments="{}", call_id="call-course",
                        ),
                    )],
                    [SimpleNamespace(type="response.output_text.delta", delta="Grounded answer")],
                ]
                result = {
                    "call_id": "call-course", "output": "{}", "yield_events": [],
                    "tool_type": "get_threshold_concepts", "is_add_message": False,
                    "plan_data": None,
                }
                kwargs = {"user_text": "Compare the textbook with the syllabus", "user_id": "student-1"}
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                with patch.object(agent, "_execute_tools_parallel", return_value=[result]):
                    events = list(getattr(agent, method_name)(**kwargs))
                calls = agent.openai_client.responses.create.call_args_list
                self.assertEqual(calls[0].kwargs["tool_choice"], "auto")
                self.assertEqual(calls[1].kwargs["tool_choice"], "auto")
                self.assertEqual(events[-1][0], "done")

    def test_missing_or_unscoped_search_is_rejected(self) -> None:
        for missing_tool in (True, False):
            with self.subTest(missing_tool=missing_tool):
                agent = self.course_agent([])
                definition = agent.project_client.agents.get.return_value.versions.latest.definition
                if missing_tool:
                    definition.tools = []
                else:
                    definition.tools[0].as_dict.return_value["azure_ai_search"]["indexes"][0]["filter"] = None
                with self.assertRaisesRegex(RuntimeError, "Course document search could not be completed"):
                    agent._prepare_course_material_request("Read the file", "Read the file", "auto")
                agent.retrieval.assert_not_called()

    def test_empty_search_reports_no_evidence_without_inventing_sources(self) -> None:
        agent = self.course_agent([])
        agent.retrieval.return_value = []
        prepared, citations, usage = agent._prepare_course_material_request("Read the file", "Read the file", "auto")
        self.assertEqual(json.loads(prepared[1]["content"])["course_material_evidence"]["passages"], [])
        self.assertEqual(citations, [])
        self.assertIsNone(usage)

    def test_search_failure_is_redacted_and_stops_ungrounded_answer(self) -> None:
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = self.course_agent([])
                agent.retrieval.side_effect = RuntimeError("private service detail")
                kwargs = {"user_text": "Read the file", "user_id": "student-1"}
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                events = list(getattr(agent, method_name)(**kwargs))
                errors = [data for event, data, _ in events if event == "error"]
                self.assertEqual(errors, ["Course document search could not be completed. Please try again."])
                agent.openai_client.responses.create.assert_not_called()

    def test_retrieval_failure_log_reports_stage_without_private_details(self) -> None:
        agent = self.course_agent([])
        agent.retrieval.side_effect = RuntimeError("private service detail and document text")
        with self.assertLogs("base_agents.general_agent", level="WARNING") as logs:
            with self.assertRaises(RuntimeError):
                agent._prepare_course_material_request("Read the file", "Read the file", "auto")
        output = " ".join(logs.output)
        self.assertIn("stage=passage_retrieval", output)
        self.assertIn("error_type=RuntimeError", output)
        self.assertIn("elapsed_ms=", output)
        self.assertNotIn("private service detail", output)
        self.assertNotIn("Read the file", output)


if __name__ == "__main__":
    unittest.main()