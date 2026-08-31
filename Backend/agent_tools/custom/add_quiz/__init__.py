"""Interactive quizzes rendered inline in the chat pane. See README.md."""

import difflib
import json
import logging
import re
from typing import Dict, Any, List, Optional

from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool
from agent_tools.custom.get_threshold_concepts import _get_full_course_curriculum

logger = logging.getLogger(__name__)

# Tool definition for Azure AI Agents - responses API format
ADD_QUIZ_TOOL_DEFINITION = load_tool_definition("add_quiz")

_WORD = re.compile(r"[a-z0-9]+")
# Shared across most misconception sentences, so they carry no matching signal.
_STOPWORDS = frozenset({
    "a", "an", "and", "are", "as", "at", "be", "because", "but", "by", "can", "cannot",
    "do", "does", "for", "from", "has", "have", "in", "into", "is", "it", "its", "no",
    "not", "of", "on", "only", "or", "so", "that", "the", "their", "them", "they",
    "this", "to", "was", "were", "what", "when", "whether", "which", "with", "student",
    "students", "mistakes", "believes", "thinks", "misconception",
})


def _normalized(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


def _content_words(value: str) -> set:
    return {w for w in _WORD.findall(_normalized(value)) if w not in _STOPWORDS and len(w) > 2}


def _misconception_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("misconception") or value.get("description") or "").strip()
    return ""


def _concept_details(curriculum: Dict[str, Any], requested_name: str) -> tuple[str, Dict[str, Any]]:
    details_by_name: Dict[str, Dict[str, Any]] = {}
    for concept_name in curriculum.get("all_threshold_concepts") or []:
        if not concept_name:
            continue
        details = curriculum.get(concept_name)
        details_by_name[str(concept_name)] = details if isinstance(details, dict) else {}

    for concept in curriculum.get("threshold_concepts") or []:
        if not isinstance(concept, dict):
            continue
        concept_name = concept.get("name") or concept.get("concept") or concept.get("title")
        if concept_name:
            details_by_name.setdefault(str(concept_name), concept)

    names = list(details_by_name)
    # Concept names run to ~95 characters and contain typographic arrows, so
    # requiring the model to reproduce one byte-for-byte fails constantly.
    resolved = _resolve_entry(requested_name, names)
    if resolved is None:
        listing = "\n".join(f"{position}. {name}" for position, name in enumerate(names, start=1))
        raise ValueError(
            f"Threshold concept '{requested_name}' is not present in the course curriculum. "
            f"Retry with the exact text or the number of one of these, copied verbatim:\n{listing}"
        )
    if _normalized(resolved) != _normalized(requested_name):
        logger.info(
            f"add_quiz mapped paraphrased threshold concept '{requested_name[:60]}' -> "
            f"'{resolved[:60]}'"
        )
    return resolved, details_by_name[resolved]


def _resolve_entry(target: str, bank: List[str]) -> Optional[str]:
    """
    Map a requested string onto the curriculum's exact wording.

    The model routinely paraphrases the bank entry or writes the probe intent
    instead ("whether the student mistakes X for Y"), so accept an exact match,
    a 1-based index, containment, or a close lexical match before giving up.
    """
    if not target or not bank:
        return None

    normalised_target = _normalized(target)
    by_text = {_normalized(entry): entry for entry in bank}
    if normalised_target in by_text:
        return by_text[normalised_target]

    stripped = target.strip().rstrip(".")
    if stripped.isdigit():
        position = int(stripped)
        if 1 <= position <= len(bank):
            return bank[position - 1]

    for entry in bank:
        entry_norm = _normalized(entry)
        if normalised_target in entry_norm or entry_norm in normalised_target:
            return entry

    target_words = _content_words(target)
    best, best_score = None, 0.0
    for entry in bank:
        entry_words = _content_words(entry)
        overlap = (
            len(target_words & entry_words) / len(target_words)
            if target_words else 0.0
        )
        ratio = difflib.SequenceMatcher(None, normalised_target, _normalized(entry)).ratio()
        score = max(overlap, ratio)
        if score > best_score:
            best, best_score = entry, score
    return best if best_score >= 0.5 else None


def _strip_assessment_prefix(title: Any) -> str:
    """
    Drop a leading assessment-type label from a quiz title.

    The UI already labels the block, so "Concept Inventory: Learned
    Representations" would read the type twice.
    """
    cleaned = str(title or "Quiz").strip()
    pattern = r"^\s*(concept\s+inventory|practice\s+quiz|quiz)\s*[:\-\u2014\u2013]\s*"
    while True:
        stripped = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
        if stripped == cleaned:
            break
        cleaned = stripped.strip()
    return cleaned or "Quiz"


_OPTION_LABEL = re.compile(r"^\s*\(?([A-Ha-h])\s*[.):\-\u2013\u2014]\s+")


def _strip_option_label(option: Any) -> str:
    """Drop a leading 'A)' style label; the UI shuffles options and adds its own."""
    text = str(option or "")
    stripped = _OPTION_LABEL.sub("", text).strip()
    return stripped or text


class AddQuizTool(CustomTool):
    """Create an interactive quiz rendered inline in the chat pane."""

    name = "add_quiz"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        title = _strip_assessment_prefix(arguments.get("title", "Quiz"))
        questions = arguments.get("questions", [])
        assessment_type = str(arguments.get("assessment_type") or "practice_quiz").strip()
        if assessment_type not in {"concept_inventory", "practice_quiz"}:
            raise ValueError("assessment_type must be 'concept_inventory' or 'practice_quiz'.")

        threshold_concept = str(arguments.get("threshold_concept") or "").strip()
        misconception_bank: List[str] = []
        if assessment_type == "concept_inventory":
            if not threshold_concept:
                raise ValueError("A concept inventory must specify its associated threshold_concept.")
            agent_name = str(context.get("agent_name") or "").strip()
            if not agent_name:
                raise ValueError("A concept inventory needs a course to validate against.")
            # Same loader get_threshold_concepts uses, so the model can always
            # validate against whatever concepts it was just handed.
            curriculum = _get_full_course_curriculum(agent_name)
            if not curriculum:
                raise ValueError(
                    f"The curriculum for '{agent_name}' could not be read, so this concept "
                    "inventory cannot be grounded in its threshold concepts. This is a "
                    "backend problem, not something different arguments will fix. Create a "
                    "practice_quiz instead, or tell the student to try again later."
                )
            threshold_concept, details = _concept_details(curriculum, threshold_concept)
            misconception_bank = [
                text
                for text in (_misconception_text(item) for item in details.get("misconceptions") or [])
                if text
            ]
            if not misconception_bank:
                raise ValueError(
                    f"Threshold concept '{threshold_concept}' has no mapped misconceptions."
                )

        # Validate and sanitize questions
        sanitized_questions = []
        for index, q in enumerate(questions):
            correct_val = q.get("correct", 0)
            options = [_strip_option_label(option) for option in q.get("options", [])]
            num_options = len(options)

            # correct can be int (single answer) or list[int] (multiple correct answers)
            if isinstance(correct_val, list):
                # Filter out-of-bounds indices
                correct_val = [i for i in correct_val if isinstance(i, int) and 0 <= i < num_options]
                if not correct_val:
                    correct_val = [0]  # fallback
            else:
                # Single answer — ensure it's an int within bounds
                if not isinstance(correct_val, int) or correct_val < 0 or correct_val >= num_options:
                    correct_val = 0

            question = {
                "question": q.get("question", ""),
                "options": options,
                "correct": correct_val,
                "explanation": q.get("explanation", ""),
            }
            target = str(
                q.get("targets_misconception") or q.get("targetsMisconception") or ""
            ).strip()
            if assessment_type == "concept_inventory":
                canonical_target = _resolve_entry(target, misconception_bank)
                if canonical_target is None:
                    # Shipping one unlabelled question beats discarding an inventory
                    # the student is waiting on. Nothing invented is ever stored, and
                    # output() tells the model which questions missed.
                    logger.warning(
                        f"add_quiz: question {index + 1} targets "
                        f"'{target[:70] or '(nothing)'}', which is not a misconception of "
                        f"'{threshold_concept}' \u2014 leaving it unmapped"
                    )
                else:
                    if _normalized(canonical_target) != _normalized(target):
                        logger.info(
                            f"add_quiz mapped paraphrased misconception '{target[:60]}' -> "
                            f"'{canonical_target[:60]}'"
                        )
                    question["targetsMisconception"] = canonical_target
            sanitized_questions.append(question)

        logger.info(f"add_quiz called: title='{title}', questions={len(sanitized_questions)}")

        return {
            "type": "quiz",
            "title": title,
            "assessmentType": assessment_type,
            **({"thresholdConcept": threshold_concept} if threshold_concept else {}),
            "questions": sanitized_questions,
        }

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        title = result.get("title", "Quiz")
        questions = result.get("questions", [])
        message = (
            f"Quiz '{title}' with {len(questions)} questions created and shown to the user. "
            "Do NOT repeat the questions in text."
        )
        if result.get("assessmentType") == "concept_inventory":
            unmapped = [
                str(position)
                for position, question in enumerate(questions, start=1)
                if not question.get("targetsMisconception")
            ]
            if unmapped:
                message += (
                    f" Question(s) {', '.join(unmapped)} matched no misconception in the "
                    "curriculum, so they are not recorded for the teacher. Copy a misconception "
                    "verbatim from get_threshold_concepts next time."
                )
        return message
