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

from base_agents.general_agent import GeneralAgent, _round_ends_turn  # noqa: E402


PROSE = "Start with the C major scale, then practise it slowly."


def _agent_with_stream(stream_events):
    agent = GeneralAgent.__new__(GeneralAgent)
    agent.agent_name = "course-test"
    # Later rounds get empty streams so the tool loop terminates.
    agent.openai_client = SimpleNamespace(
        conversations=SimpleNamespace(
            create=Mock(return_value=SimpleNamespace(id="conversation-1")),
            items=SimpleNamespace(create=Mock()),
        ),
        responses=SimpleNamespace(
            create=Mock(side_effect=[stream_events] + [[] for _ in range(10)]),
        ),
    )
    return agent


def _function_call(name: str, call_id: str = "call-1", arguments=None):
    return SimpleNamespace(
        type="response.output_item.done",
        item=SimpleNamespace(
            type="function_call", name=name,
            arguments=json.dumps(arguments or {}), call_id=call_id
        ),
    )


def _execute_test_tools(tool_calls, conversation_id, user_id):
    results = []
    for tool_call in tool_calls:
        arguments = json.loads(tool_call["args"])
        events = []
        if tool_call["name"] == "add_message":
            events.append(("message_block", json.dumps(arguments), conversation_id))
        results.append({
            "call_id": tool_call["call_id"],
            "output": "Delivered",
            "yield_events": events,
            "plan_data": (
                {"accepted": True, "tools": arguments["tools"]}
                if tool_call["name"] == "declare_plan" else None
            ),
        })
    return results


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


class HarnessCompatibilityTests(unittest.TestCase):
    def test_legacy_import_uses_the_same_harness_runtime(self) -> None:
        import base_agents.general_agent as legacy
        from harness import runtime

        self.assertIs(legacy, runtime)
        self.assertIs(GeneralAgent, runtime.GeneralAgent)
        self.assertEqual(GeneralAgent.__module__, "harness.runtime")
        self.assertIs(legacy.get_general_agent, runtime.get_general_agent)
        self.assertIs(legacy._agent_cache, runtime._agent_cache)
        with patch.object(legacy, "retrieve_course_passages") as retrieval:
            self.assertIs(runtime.retrieve_course_passages, retrieval)


class SimulationRequestTests(unittest.TestCase):
    def test_simulation_guidance_reaches_existing_agents_on_new_and_continued_turns(self):
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream([])
                kwargs = {
                    "user_text": "Create a simulation of a 12 V resistor circuit.",
                    "user_id": "student-1",
                    "image_urls": ["data:image/png;base64,example"],
                }
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                list(getattr(agent, method_name)(**kwargs))
                request = agent.openai_client.responses.create.call_args.kwargs
                guidance = [
                    item["content"] for item in request["input"]
                    if item["role"] == "developer" and isinstance(item["content"], str)
                    and "[SIMULATION REQUEST HANDLING]" in item["content"]
                ]
                self.assertEqual(len(guidance), 1)
                self.assertIn("add_circuit", guidance[0])
                self.assertIn("Do not direct the learner to a Simulation menu", guidance[0])
                self.assertIn("not available", guidance[0])
                self.assertIn("The card opens Circuit Lab", guidance[0])
                self.assertIn("Never claim a simulation was created before successful tool output", guidance[0])
                self.assertEqual(request["tool_choice"], "auto")
                self.assertEqual(request["input"][-1]["content"][0]["text"], kwargs["user_text"])

    def test_simulation_guidance_respects_tools_disabled(self):
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream([])
                kwargs = {"user_text": "Explain a simulation.", "user_id": "student-1", "tool_choice": "none"}
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                list(getattr(agent, method_name)(**kwargs))
                request = agent.openai_client.responses.create.call_args.kwargs
                self.assertEqual(request["tool_choice"], "none")
                self.assertNotIn("[SIMULATION REQUEST HANDLING]", str(request["input"]))


class AnswerDepthTests(unittest.TestCase):
    def test_selected_depth_reaches_new_and_continued_turns_with_images_and_profile(self):
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            for depth in ("quick", "balanced", "detailed"):
                with self.subTest(method=method_name, depth=depth):
                    agent = _agent_with_stream([])
                    kwargs = {
                        "user_text": "Explain this example.",
                        "user_id": "student-1",
                        "answer_depth": depth,
                        "user_profile": {"displayName": "Example"},
                        "image_urls": ["data:image/png;base64,example"],
                    }
                    if method_name == "continue_chat_stream":
                        kwargs["conversation_id"] = "conversation-1"
                    with patch(
                        "base_agents.general_agent._profile_research_instructions",
                        return_value="Preserved profile context.",
                    ):
                        events = list(getattr(agent, method_name)(**kwargs))

                    request = agent.openai_client.responses.create.call_args.kwargs
                    depth_messages = [
                        item["content"] for item in request["input"]
                        if isinstance(item["content"], str)
                        and "[ANSWER DEPTH PREFERENCE" in item["content"]
                    ]
                    self.assertEqual(len(depth_messages), 1)
                    self.assertIn(f"Selected answer depth: {depth}", depth_messages[0])
                    style = {"quick": "Concise - Short and direct", "balanced": "Balanced - Clear, with key details", "detailed": "Comprehensive - Thorough and in-depth"}[depth]
                    self.assertIn(f"Response style: {style}", depth_messages[0])
                    self.assertEqual(depth_messages[0].count("Response style:"), 1)
                    self.assertIn("confirmed learner preferences", depth_messages[0])
                    self.assertIn("Do not invent a learner", depth_messages[0])
                    self.assertIn("CURRENT TURN ONLY", depth_messages[0])
                    self.assertIn("Preserved profile context.", str(request["input"]))
                    self.assertEqual(request["input"][-1]["content"], [
                        {"type": "input_text", "text": "Explain this example."},
                        {"type": "input_image", "image_url": "data:image/png;base64,example"},
                    ])
                    self.assertEqual(request["extra_body"]["agent_reference"]["name"], "course-test")
                    self.assertNotIn("agent", request["extra_body"])
                    self.assertEqual(request["tool_choice"], "auto")
                    self.assertNotIn("model", request)
                    self.assertNotIn("instructions", request)
                    self.assertEqual(events[-1][0], "done")

    def test_depth_is_balanced_by_default_and_never_cached_on_the_shared_agent(self):
        agent = _agent_with_stream([])
        for depth in ("quick", "detailed", None, "balanced"):
            kwargs = {} if depth is None else {"answer_depth": depth}
            list(agent.continue_chat_stream(
                "conversation-1", "Explain voltage.", user_id="student-1", **kwargs
            ))
            request = agent.openai_client.responses.create.call_args.kwargs
            self.assertIn(
                f"Selected answer depth: {depth or 'balanced'}",
                request["input"][0]["content"],
            )
            self.assertEqual(request["input"][-1]["content"], "Explain voltage.")
            self.assertNotIn("answer_depth", vars(agent))

    def test_each_style_uses_distinct_internal_guidance(self):
        from harness.runtime import _ANSWER_STYLE_PROMPTS

        self.assertEqual(set(_ANSWER_STYLE_PROMPTS), {"quick", "balanced", "detailed"})
        self.assertIn("up to three brief bullets", _ANSWER_STYLE_PROMPTS["quick"].replace("\n", " "))
        self.assertIn("manageable amount of", _ANSWER_STYLE_PROMPTS["balanced"])
        self.assertIn("worked examples", _ANSWER_STYLE_PROMPTS["detailed"])
        self.assertNotIn("Response style: Comprehensive", _ANSWER_STYLE_PROMPTS["quick"])
        self.assertNotIn("Response style: Concise", _ANSWER_STYLE_PROMPTS["detailed"])

    def test_depth_keeps_the_same_conversation_during_tool_followups(self):
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream([_function_call("get_threshold_concepts")])
                kwargs = {
                    "user_text": "Explain a threshold concept.",
                    "user_id": "student-1",
                    "answer_depth": "detailed",
                }
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                with patch.object(agent, "_execute_tools_parallel", side_effect=_execute_test_tools):
                    list(getattr(agent, method_name)(**kwargs))
                requests = agent.openai_client.responses.create.call_args_list
                self.assertGreaterEqual(len(requests), 2)
                self.assertIn("Selected answer depth: detailed", requests[0].kwargs["input"][0]["content"])
                self.assertTrue(all(request.kwargs["conversation"] == "conversation-1" for request in requests))


class PlainTextEmissionTests(unittest.TestCase):
    def test_agui_streams_prose_before_completion_and_keeps_one_surface(self) -> None:
        from backend.agui import AGUITranslator

        prefix = "Measure voltage across the component and record the instrument range. " * 3
        state = {"upstream_finished": False}

        def upstream():
            yield SimpleNamespace(type="response.output_text.delta", delta=prefix)
            state["upstream_finished"] = True
            yield SimpleNamespace(type="response.output_text.delta", delta="Compare the result.")

        agent = _agent_with_stream(upstream())
        translated = AGUITranslator().run(agent.start_chat_stream("Explain measurement", user_id="student-1"))
        early_updates = []
        for event in translated:
            if event.get("name") == "a2ui":
                update = event["value"].get("updateDataModel")
                if update and "content_chunks" in json.dumps(update):
                    early_updates.append(event)
                    self.assertFalse(state["upstream_finished"])
                    break
        self.assertTrue(early_updates)
        remaining = list(translated)
        self.assertEqual(remaining[-1]["type"], "RUN_FINISHED")
        completions = [event for event in remaining if event["type"] == "STEP_FINISHED" and event.get("stepName") == "message_block"]
        self.assertEqual(len(completions), 1)

    def test_valid_prose_is_visible_before_upstream_finishes(self) -> None:
        prefix = "A measured current depends on the circuit and the instrument connection. " * 3
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                finished = []

                def upstream():
                    yield SimpleNamespace(type="response.output_text.delta", delta=prefix)
                    finished.append(True)
                    yield SimpleNamespace(type="response.output_text.delta", delta=" Record the value.")

                agent = _agent_with_stream(upstream())
                kwargs = {"user_text": "Explain current", "user_id": "student-1"}
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                stream = getattr(agent, method_name)(**kwargs)
                for kind, data, _ in stream:
                    if kind == "message_block_delta":
                        self.assertEqual(json.loads(data)["delta"], prefix)
                        self.assertEqual(finished, [])
                        break
                rest = list(stream)
                self.assertEqual(_message_texts(rest), [prefix + " Record the value."])

    def test_refusal_and_raw_tool_json_are_not_streamed_as_prose(self) -> None:
        values = [
            "I'm sorry, but I cannot assist with that. " * 6,
            json.dumps({"name": "add_message", "arguments": {"content": "An answer " * 30}}),
        ]
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            for text in values:
                with self.subTest(method=method_name, text=text[:20]):
                    events = _run(method_name, [SimpleNamespace(type="response.output_text.delta", delta=text)])
                    self.assertFalse(any(kind == "message_block_delta" for kind, _, _ in events))

    def test_tool_message_supersedes_provisional_prose(self) -> None:
        text = PROSE * 5
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                events = _run(method_name, [SimpleNamespace(type="response.output_text.delta", delta=text), _function_call("add_message")])
                self.assertTrue(any(kind == "block_cancel" and json.loads(data)["tool"] == "plain_text" for kind, data, _ in events))
                self.assertNotIn(text, _message_texts(events))

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


class TurnCompletionTests(unittest.TestCase):
    def test_message_only_reply_ends_even_the_initial_round(self) -> None:
        for tool_round in (0, 1, 4):
            with self.subTest(tool_round=tool_round):
                self.assertTrue(_round_ends_turn({"add_message"}, [], 0, tool_round, 1))

    def test_message_reply_ends_a_completed_plan(self) -> None:
        plan = ["add_document", "add_message"]
        self.assertTrue(_round_ends_turn({"add_message"}, plan, len(plan), 2, 1))

    def test_message_reply_does_not_skip_remaining_plan_steps(self) -> None:
        plan = ["add_message", "add_document", "suggest_next_queries"]
        self.assertFalse(_round_ends_turn({"add_message"}, plan, 1, 1, 1))

    def test_internal_tools_do_not_extend_a_delivered_reply(self) -> None:
        self.assertTrue(
            _round_ends_turn({"add_message", "update_topic_progress"}, [], 0, 0, 1)
        )

    def test_suggestions_without_an_answer_do_not_end_the_turn(self) -> None:
        self.assertFalse(_round_ends_turn({"suggest_next_queries"}, [], 0, 0, 0))


class TurnLoopTests(unittest.TestCase):
    def test_prose_answer_with_suggestions_does_not_generate_another_round(self) -> None:
        events = [SimpleNamespace(type="response.output_text.delta", delta=PROSE), _function_call("suggest_next_queries")]
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream(events)
                kwargs = {"user_text": "Explain current", "user_id": "student-1"}
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                with patch.object(agent, "_execute_tools_parallel", side_effect=_execute_test_tools):
                    output = list(getattr(agent, method_name)(**kwargs))
                self.assertEqual(_message_texts(output), [PROSE])
                agent.openai_client.responses.create.assert_called_once()
                agent.openai_client.conversations.items.create.assert_called_once()
                self.assertEqual(output[-1][0], "done")

    def test_delivered_reply_does_not_generate_another_response(self) -> None:
        stream = [_function_call("add_message", arguments={"content": PROSE})]
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream(stream)
                kwargs = {"user_text": "same material in different forms", "user_id": "student-1"}
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                with patch.object(agent, "_execute_tools_parallel", side_effect=_execute_test_tools):
                    events = list(getattr(agent, method_name)(**kwargs))

                self.assertEqual(_message_texts(events), [PROSE])
                self.assertEqual(agent.openai_client.responses.create.call_count, 1)
                agent.openai_client.conversations.items.create.assert_called_once_with(
                    "conversation-1", items=[{
                        "type": "function_call_output", "call_id": "call-1", "output": "Delivered"
                    }],
                )
                self.assertEqual(events[-1][0], "done")

    def test_remaining_document_plan_runs_without_extra_generation_at_the_end(self) -> None:
        plan = ["add_message", "add_document", "suggest_next_queries"]
        streams = [
            [_function_call("declare_plan", "plan-call", {"tools": plan})],
            [_function_call("add_message", "reply-call", {"content": PROSE})],
            [_function_call("add_document", "document-call")],
            [_function_call("suggest_next_queries", "suggestions-call")],
        ]
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream([])
                agent.openai_client.responses.create.side_effect = streams + [[]]
                kwargs = {"user_text": "explain this and make a document", "user_id": "student-1"}
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                with patch.object(agent, "_execute_tools_parallel", side_effect=_execute_test_tools):
                    events = list(getattr(agent, method_name)(**kwargs))

                self.assertEqual(_message_texts(events), [PROSE])
                calls = agent.openai_client.responses.create.call_args_list
                self.assertEqual(len(calls), len(streams))
                self.assertEqual(
                    [call.kwargs["tool_choice"] for call in calls[1:]],
                    [{"type": "function", "name": tool_name} for tool_name in plan],
                )
                agent.openai_client.conversations.items.create.assert_called_once_with(
                    "conversation-1", items=[{
                        "type": "function_call_output", "call_id": "suggestions-call", "output": "Delivered"
                    }],
                )
                self.assertEqual(events[-1][0], "done")

    def test_next_learner_message_starts_exactly_one_new_response(self) -> None:
        agent = _agent_with_stream([])
        agent.openai_client.responses.create.side_effect = [
            [_function_call("add_message", "first-call", {"content": "Which picture fits?"})],
            [_function_call("add_message", "second-call", {"content": "The particles move farther apart."})],
            [],
        ]
        with patch.object(agent, "_execute_tools_parallel", side_effect=_execute_test_tools):
            first_events = list(agent.start_chat_stream(
                user_text="same material in different forms", user_id="student-1"
            ))
            second_events = list(agent.continue_chat_stream(
                conversation_id="conversation-1", user_text="they move farther apart", user_id="student-1"
            ))

        self.assertEqual(_message_texts(first_events), ["Which picture fits?"])
        self.assertEqual(_message_texts(second_events), ["The particles move farther apart."])
        self.assertEqual(agent.openai_client.responses.create.call_count, 2)
        self.assertEqual(agent.openai_client.conversations.items.create.call_count, 2)

    def test_failed_final_plan_step_is_retried_before_ending(self) -> None:
        streams = [
            [_function_call("declare_plan", "plan-call", {"tools": ["add_message"]})],
            [_function_call("add_message", "failed-call", {"content": PROSE})],
            [_function_call("add_message", "retry-call", {"content": PROSE})],
        ]

        def execute_with_failure(tool_calls, conversation_id, user_id):
            results = _execute_test_tools(tool_calls, conversation_id, user_id)
            for result in results:
                if result["call_id"] == "failed-call":
                    result["output"] = "Error: invalid message arguments"
                    result["yield_events"] = []
            return results

        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream([])
                agent.openai_client.responses.create.side_effect = streams
                kwargs = {"user_text": "explain states of matter", "user_id": "student-1"}
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                with patch.object(agent, "_execute_tools_parallel", side_effect=execute_with_failure):
                    events = list(getattr(agent, method_name)(**kwargs))

                self.assertEqual(_message_texts(events), [PROSE])
                self.assertEqual(agent.openai_client.responses.create.call_count, 3)
                agent.openai_client.conversations.items.create.assert_called_once_with(
                    "conversation-1", items=[{
                        "type": "function_call_output", "call_id": "retry-call", "output": "Delivered"
                    }],
                )
                self.assertEqual(events[-1][0], "done")

    def test_history_failure_is_visible_without_generating_another_reply(self) -> None:
        stream = [_function_call("add_message", arguments={"content": PROSE})]
        for method_name in ("start_chat_stream", "continue_chat_stream"):
            with self.subTest(method=method_name):
                agent = _agent_with_stream(stream)
                agent.openai_client.conversations.items.create.side_effect = RuntimeError("internal detail")
                kwargs = {"user_text": "explain states of matter", "user_id": "student-1"}
                if method_name == "continue_chat_stream":
                    kwargs["conversation_id"] = "conversation-1"
                with patch.object(agent, "_execute_tools_parallel", side_effect=_execute_test_tools):
                    events = list(getattr(agent, method_name)(**kwargs))

                self.assertEqual(_message_texts(events), [PROSE])
                self.assertEqual(agent.openai_client.responses.create.call_count, 1)
                self.assertEqual(events[-1][0], "error")
                self.assertNotIn("internal detail", events[-1][1])
                self.assertNotIn("done", [event[0] for event in events])


if __name__ == "__main__":
    unittest.main()
