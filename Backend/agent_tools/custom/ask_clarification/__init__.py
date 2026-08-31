"""Clarifying question with 4 clickable options plus a free-text fallback."""

import logging
from typing import Any, Dict, List

from utils.tool_definitions import load_tool_definition
from utils import clarification_registry
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

ASK_CLARIFICATION_TOOL_DEFINITION = load_tool_definition("ask_clarification")

REQUIRED_OPTION_COUNT = 4
MAX_QUESTIONS = 3
_MAX_OPTION_CHARS = 120


class AskClarificationTool(CustomTool):
    """Ask 1-3 clarifying questions, rendered as one card with a pager."""

    name = "ask_clarification"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        raw_questions = arguments.get("questions")
        if not isinstance(raw_questions, list) or not raw_questions:
            raise ValueError("ask_clarification requires a non-empty 'questions' list.")
        if len(raw_questions) > MAX_QUESTIONS:
            raise ValueError(
                f"ask_clarification accepts at most {MAX_QUESTIONS} questions "
                f"(got {len(raw_questions)})."
            )

        questions: List[Dict[str, Any]] = []
        for position, entry in enumerate(raw_questions, start=1):
            if not isinstance(entry, dict):
                raise ValueError(f"ask_clarification question {position} must be an object.")

            question = str(entry.get("question") or "").strip()
            if not question:
                raise ValueError(f"ask_clarification question {position} has an empty 'question'.")

            raw_options = entry.get("options")
            if not isinstance(raw_options, list):
                raise ValueError(
                    f"ask_clarification question {position} needs an 'options' list of strings."
                )

            options: List[str] = []
            for option in raw_options:
                if not isinstance(option, str):
                    continue
                cleaned = option.strip()[:_MAX_OPTION_CHARS]
                # Keep options distinct so the user never sees two identical rows.
                if cleaned and cleaned.lower() not in {existing.lower() for existing in options}:
                    options.append(cleaned)

            if len(options) != REQUIRED_OPTION_COUNT:
                raise ValueError(
                    f"ask_clarification question {position} requires exactly "
                    f"{REQUIRED_OPTION_COUNT} distinct, non-empty options (got {len(options)})."
                )

            questions.append({
                "question": question,
                "options": options,
                "context": str(entry.get("context") or "").strip(),
            })

        logger.info(
            f"ask_clarification called with {len(questions)} question(s): "
            f"'{questions[0]['question'][:60]}'"
        )

        return {"type": "clarify", "questions": questions}

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        count = len(result.get("questions", []))
        return f"{count} clarifying question(s) shown to the user."

    def wait_for_answers(
        self,
        clarify_id: str,
        questions: List[Dict[str, Any]],
        timeout: float = clarification_registry.DEFAULT_TIMEOUT_SECONDS,
    ) -> str:
        """Block until the student answers, then return the tool output for the model."""
        answers = clarification_registry.wait(clarify_id, timeout=timeout)

        if not answers:
            logger.info(f"ask_clarification {clarify_id}: no answers within {timeout}s")
            return (
                "The student did not answer within the time limit. Do NOT ask again and do NOT "
                "mention the unanswered questions. Choose the most broadly useful interpretation "
                "yourself, state your assumption in one short sentence, and answer the original "
                "request now in this same turn."
            )

        lines: List[str] = []
        for position, question in enumerate(questions):
            answer = ""
            if position < len(answers):
                answer = str(answers[position].get("answer") or "").strip()
            lines.append(
                f"- {question.get('question', '')}\n  {answer or '(skipped - choose a sensible default)'}"
            )

        logger.info(f"ask_clarification {clarify_id}: received {len(answers)} answer(s)")
        return (
            "The student answered:\n"
            + "\n".join(lines)
            + "\n\nNow answer the original request in this same turn using these answers. "
            "Do NOT repeat the questions back, and do NOT call ask_clarification again."
        )
