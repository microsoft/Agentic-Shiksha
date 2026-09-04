"""Tracks student learning progress per topic. See README.md."""

import json
import logging
from typing import Dict, Any

from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool
from utils.log_safe import scrub

logger = logging.getLogger(__name__)

UPDATE_TOPIC_PROGRESS_TOOL_DEFINITION = load_tool_definition("update_topic_progress")


def _init_learning_state(agent_name: str, user_id: str) -> bool:
    """Create the learning state from the course curriculum. False if unavailable."""
    try:
        from agent_tools.custom.get_threshold_concepts import _get_full_course_curriculum
        from azure_services.persistence.cosmos_db import init_learning_state

        plan = _get_full_course_curriculum(agent_name)
        if not plan:
            logger.warning(
                f"Cannot initialise learning state for agent='{agent_name}': no course curriculum yet"
            )
            return False
        init_learning_state(user_id, agent_name, plan)
        logger.info(
            f"Auto-initialised learning state for user='{scrub(user_id)}', agent='{scrub(agent_name)}' "
            f"during update_topic_progress"
        )
        return True
    except Exception as e:
        logger.error(f"Failed to auto-initialise learning state for '{agent_name}': {e}")
        return False


def _misconception_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("misconception") or value.get("description") or "").strip()
    return ""


def _canonical_concept_and_misconceptions(
    agent_name: str, concept_name: str, requested: Any
) -> tuple[str, list, list]:
    """
    Map the concept and its misconceptions onto the curriculum's exact wording.

    Returns (canonical_concept, accepted, rejected). Anything the model invented
    is dropped rather than stored, so teacher analytics only ever see real bank
    entries. The model paraphrases these long labels constantly, so match the
    same way add_quiz does rather than demanding a byte-exact string.
    """
    from agent_tools.custom.get_threshold_concepts import _get_full_course_curriculum
    from agent_tools.custom.add_quiz import _concept_details, _resolve_entry

    curriculum = _get_full_course_curriculum(agent_name) or {}
    try:
        canonical_concept, details = _concept_details(curriculum, concept_name)
    except ValueError:
        canonical_concept, details = concept_name, {}

    items = [item for item in (requested or []) if item]
    if not items:
        return canonical_concept, [], []

    bank = [
        text
        for text in (_misconception_text(entry) for entry in details.get("misconceptions") or [])
        if text
    ]

    accepted, rejected = [], []
    for item in items:
        text = _misconception_text(item)
        note = str(item.get("note") or "").strip() if isinstance(item, dict) else ""
        canonical = _resolve_entry(text, bank)
        if canonical:
            accepted.append({"misconception": canonical, "note": note})
        elif text:
            rejected.append(text)
    return canonical_concept, accepted, rejected


def handle_update_topic_progress(
    arguments: Dict[str, Any],
    agent_name: str = "",
    user_id: str = "",
) -> Dict[str, Any]:
    """
    Perform the topic-progress update (Cosmos DB write).

    Args:
        arguments: Tool call arguments (topic, status, summary, threshold_concept,
            misconceptions_addressed)
        agent_name: The agent name
        user_id: The user ID

    Returns:
        Result dict with updated topic info and overall progress
    """
    topic = arguments.get("topic", "").strip()
    status = arguments.get("status", "").strip()
    summary = arguments.get("summary", "").strip() or None
    threshold_concept = str(arguments.get("threshold_concept") or "").strip() or None
    requested_misconceptions = arguments.get("misconceptions_addressed") or []

    if not topic:
        return {"error": "topic is required."}
    if status not in ("in_progress", "learned"):
        return {"error": f"Invalid status '{status}'. Must be 'in_progress' or 'learned'."}
    if not agent_name:
        return {"error": "No agent name provided."}
    if not user_id:
        return {"error": "No user ID provided — cannot track progress without user context."}

    misconceptions, rejected = [], []
    if requested_misconceptions and not threshold_concept:
        return {
            "error": "threshold_concept is required when recording misconceptions_addressed."
        }
    if threshold_concept:
        try:
            threshold_concept, misconceptions, rejected = _canonical_concept_and_misconceptions(
                agent_name, threshold_concept, requested_misconceptions
            )
        except Exception as e:
            logger.error(f"Could not validate misconceptions for '{agent_name}': {e}")

    try:
        from azure_services.persistence.cosmos_db import update_topic_in_state
        result = update_topic_in_state(
            user_id=user_id,
            agent_id=agent_name,
            topic=topic,
            status=status,
            summary=summary,
            threshold_concept=threshold_concept,
            misconceptions=misconceptions,
        )
        # The state is normally created by get_threshold_concepts. If the model
        # skipped that call, initialise it here so progress is never silently lost.
        if result.get("error", "").startswith("No learning state found"):
            if _init_learning_state(agent_name, user_id):
                result = update_topic_in_state(
                    user_id=user_id,
                    agent_id=agent_name,
                    topic=topic,
                    status=status,
                    summary=summary,
                    threshold_concept=threshold_concept,
                    misconceptions=misconceptions,
                )

        if "error" in result:
            logger.warning(f"update_topic_progress failed: {result['error']}")
            return result

        if rejected:
            result["rejected_misconceptions"] = rejected
            logger.warning(
                f"Dropped {len(rejected)} unmapped misconception(s) for concept "
                f"'{threshold_concept}' on agent='{agent_name}'"
            )

        logger.info(
            f"update_topic_progress: user='{scrub(user_id)}', agent='{scrub(agent_name)}', "
            f"topic='{topic}', {result.get('old_status')} → {result.get('new_status')}"
        )
        return result
    except Exception as e:
        logger.error(f"Failed to update topic progress: {e}")
        return {"error": str(e)}


def get_tool_output_message(result: Dict[str, Any]) -> str:
    """Format the tool output for the agent."""
    if "error" in result:
        return f"Error updating progress: {result['error']}"

    overall = result.get("overall", {})
    msg = (
        f"Progress updated: '{result.get('topic')}' is now {result.get('new_status')}. "
        f"Overall: {overall.get('learned', 0)}/{overall.get('total_topics', 0)} topics learned, "
        f"{overall.get('in_progress', 0)} in progress ({overall.get('percent', 0)}% complete)."
    )
    concept = result.get("threshold_concept")
    if concept:
        marker = "🎯 Threshold concept crossed" if result.get("new_status") == "learned" else "Threshold concept in progress"
        msg += (
            f" {marker}: '{concept}' "
            f"({result.get('threshold_concepts_learned', 0)}/{result.get('threshold_concepts_total', 0)} crossed)."
        )
    recorded = result.get("misconceptions_recorded") or []
    if recorded:
        msg += f" Recorded {len(recorded)} misconception(s) as resolved."
    rejected = result.get("rejected_misconceptions") or []
    if rejected:
        msg += (
            f" {len(rejected)} misconception(s) were NOT recorded because they are not in this "
            "concept's misconception bank — use the exact text from get_threshold_concepts."
        )
    return msg


class UpdateTopicProgressTool(CustomTool):
    """Record a student's per-topic learning progress in the learning state."""

    name = "update_topic_progress"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        return handle_update_topic_progress(
            arguments,
            agent_name=context.get("agent_name", ""),
            user_id=context.get("user_id", ""),
        )

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        return get_tool_output_message(result)

