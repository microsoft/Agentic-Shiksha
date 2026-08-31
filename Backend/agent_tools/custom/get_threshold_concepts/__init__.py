"""Threshold concepts and per-user learning state. See README.md."""

import json
import logging
from typing import Dict, Any, Optional
from pathlib import Path

from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────
# Local fallback for curriculum files. Anchored to the backend package so it
# resolves the same however the app is launched; blob storage is the primary.
AGENT_SETUPS_BASE = Path(__file__).resolve().parents[3] / "user_data" / "agent_setups"


def _setup_dir(agent_name: str) -> Optional[Path]:
    """Setup folder for ``agent_name``, or None if the name would escape the base dir."""
    name = Path((agent_name or "").strip()).name
    if not name or name in (".", ".."):
        return None
    return AGENT_SETUPS_BASE / name

GET_THRESHOLD_CONCEPTS_TOOL_DEFINITION = load_tool_definition("get_threshold_concepts")

# Backward-compatible alias so old imports still work
GET_COURSE_CURRICULUM_TOOL_DEFINITION = GET_THRESHOLD_CONCEPTS_TOOL_DEFINITION


def _get_full_course_curriculum(agent_name: str) -> Optional[Dict[str, Any]]:
    """
    Get the full raw course curriculum from blob storage or local file.
    This is the original fetch logic, used for initialization and frontend.
    """
    # Try blob storage (with in-memory cache)
    try:
        from azure_services.persistence.cosmos_db import get_course_curriculum as get_cc_from_store
        plan = get_cc_from_store(agent_name)
        if plan:
            return plan
    except Exception as e:
        logger.warning(f"Blob storage course curriculum lookup failed for '{agent_name}': {e}")

    # Fallback: check local file (backward compatibility)
    setup_dir = _setup_dir(agent_name)
    if setup_dir is None:
        return None
    plan_path = setup_dir / "course_curriculum.json"

    if not plan_path.exists():
        alt_path = setup_dir / "textbook_research.json"
        if alt_path.exists():
            plan_path = alt_path
        else:
            return None

    try:
        with open(plan_path, "r", encoding="utf-8") as f:
            plan = json.load(f)

        # Migrate: save to Cosmos DB for future reads
        try:
            from azure_services.persistence.cosmos_db import save_course_curriculum
            save_course_curriculum(agent_name, plan)
            logger.info(f"Migrated local course curriculum for '{agent_name}' to blob storage")
        except Exception as e:
            logger.warning(f"Failed to migrate course curriculum to blob storage: {e}")

        return plan
    except Exception as e:
        logger.error(f"Error loading course curriculum for '{agent_name}': {e}")
        return None


def _prior_progress(
    topics: Dict[str, Any], concepts: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Count what the student has genuinely covered.

    The tutor is encouraging by nature and will otherwise narrate the curriculum
    back as if the student had already studied it, so it needs an explicit
    signal that a fresh learner has no history.
    """
    def count(items: Dict[str, Any], status: str) -> int:
        return sum(1 for entry in items.values() if (entry or {}).get("status") == status)

    topics_learned = count(topics, "learned")
    topics_in_progress = count(topics, "in_progress")
    concepts_learned = count(concepts, "learned")
    concepts_in_progress = count(concepts, "in_progress")
    return {
        "topics_learned": topics_learned,
        "topics_in_progress": topics_in_progress,
        "concepts_learned": concepts_learned,
        "concepts_in_progress": concepts_in_progress,
        "has_prior_progress": bool(
            topics_learned or topics_in_progress or concepts_learned or concepts_in_progress
        ),
    }


def _grounding_rule(result: Dict[str, Any]) -> str:
    """Prefix the tool output with what the tutor may and may not claim."""
    privacy_rule = (
        "CONCEPT-INVENTORY PRIVACY RULE: threshold-concept names, misconception-bank "
        "entries, and question-to-misconception mappings are internal diagnostic data. "
        "Use them to design the check, but never label or list them in student-facing "
        "quiz titles, questions, options, explanations, or surrounding text.\n"
    )
    prior = result.get("prior_progress")
    if not isinstance(prior, dict):
        return privacy_rule
    if prior.get("has_prior_progress"):
        return privacy_rule + (
            "GROUNDING RULE: You may only reference prior work that appears below with "
            "status 'learned' or 'in_progress'. Everything else is untouched — do not "
            "imply the student has already covered it.\n"
        )
    return privacy_rule + (
        "GROUNDING RULE: This student has no recorded progress on this course. They are "
        "starting fresh. Do not claim or imply they have already studied, explored, or "
        "crossed any topic or concept here, and do not reference any 'earlier "
        "exploration'. Open as a genuine beginning.\n"
    )


def _with_private_diagnostic_bank(
    concepts: Dict[str, Any],
    curriculum: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Attach curriculum diagnostics to a copy of progress for tutor tool use only."""
    enriched = {name: dict(entry or {}) for name, entry in concepts.items()}
    if not curriculum:
        return enriched

    legacy = {
        str(item.get("name") or item.get("concept") or item.get("title") or ""): item
        for item in curriculum.get("threshold_concepts") or []
        if isinstance(item, dict)
    }
    for concept_name, entry in enriched.items():
        details = curriculum.get(concept_name) or legacy.get(concept_name) or {}
        if not isinstance(details, dict):
            continue
        for field in (
            "description",
            "why_threshold",
            "misconceptions",
            "concept_inventory_questions",
        ):
            if field in details:
                entry[field] = details[field]
    return enriched


def _resolve_threshold_concepts(
    arguments: Dict[str, Any],
    agent_name: str = "",
    user_id: str = "",
) -> Dict[str, Any]:
    """
    Handle the get_threshold_concepts tool call.

    When user_id is provided: Returns the learning state (topic map + progress).
    When user_id is NOT provided: Returns the full raw curriculum (legacy behavior).

    Args:
        arguments: Tool call arguments (empty — no args needed)
        agent_name: The agent name to find its course curriculum
        user_id: The user ID (enables per-user state tracking)

    Returns:
        The learning state (if user_id) or full curriculum (if no user_id), or an error
    """
    if not agent_name:
        return {"error": "No agent name provided — cannot locate threshold concepts."}

    # -------------------------------------------------------------------
    # State-aware path: user_id available → return topic map with progress
    # -------------------------------------------------------------------
    if user_id:
        try:
            from azure_services.persistence.cosmos_db import (
                get_learning_state, init_learning_state, get_progress_summary,
            )

            # Check if learning state already exists
            state = get_learning_state(user_id, agent_name)

            if state:
                # State exists — return topics + progress summary
                progress = get_progress_summary(user_id, agent_name)
                topics = state.get("topics", {})
                concepts = state.get("threshold_concepts", {}) or {}
                curriculum = _get_full_course_curriculum(agent_name)

                logger.info(
                    f"Returning learning state for user='{user_id}', agent='{agent_name}': "
                    f"{progress.get('overall', {}).get('learned', 0)}/{progress.get('overall', {}).get('total_topics', 0)} learned"
                )
                return {
                    "all_topics": topics,
                    "objectives": state.get("objectives", {}),
                    "threshold_concepts": _with_private_diagnostic_bank(
                        concepts, curriculum
                    ),
                    "progress": progress,
                    "prior_progress": _prior_progress(
                        topics, concepts
                    ),
                }

            # No state yet — cold start: fetch full curriculum and initialize
            plan = _get_full_course_curriculum(agent_name)
            if not plan:
                return {
                    "status": "not_ready",
                    "message": "Threshold concepts are still being generated from textbook research. "
                               "They will be available shortly. For now, teach based on the course topic and your knowledge."
                }

            state = init_learning_state(user_id, agent_name, plan)
            progress = get_progress_summary(user_id, agent_name)
            topics = state.get("topics", {})
            concepts = state.get("threshold_concepts", {}) or {}
            logger.info(f"Cold start: initialized learning state for user='{user_id}', agent='{agent_name}'")
            return {
                "all_topics": topics,
                "objectives": state.get("objectives", {}),
                "threshold_concepts": _with_private_diagnostic_bank(concepts, plan),
                "progress": progress,
                "prior_progress": _prior_progress(
                    topics, concepts
                ),
            }

        except Exception as e:
            logger.error(f"Learning state lookup failed for user='{user_id}', agent='{agent_name}': {e}")
            # Fall through to legacy path
            logger.info("Falling back to full curriculum return")

    # -------------------------------------------------------------------
    # Legacy path: no user_id → return full raw curriculum
    # -------------------------------------------------------------------
    plan = _get_full_course_curriculum(agent_name)
    if plan:
        logger.info(f"Loaded threshold concepts for agent '{agent_name}' ({len(json.dumps(plan))} chars)")
        return plan

    return {
        "status": "not_ready",
        "message": "Threshold concepts are still being generated from textbook research. "
                   "They will be available shortly. For now, teach based on the course topic and your knowledge."
    }


# Backward-compatible alias
handle_get_course_curriculum = _resolve_threshold_concepts


class GetThresholdConceptsTool(CustomTool):
    """Return the learning state (topic map + progress) or full curriculum."""

    name = "get_threshold_concepts"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        return _resolve_threshold_concepts(
            arguments,
            agent_name=context.get("agent_name", ""),
            user_id=context.get("user_id", ""),
        )

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        # The model consumes the full topic map / curriculum directly.
        return _grounding_rule(result) + json.dumps(result, ensure_ascii=False)


def get_tool_output_message(agent_name: str) -> str:
    """Return a status message about threshold-concept availability for ``agent_name``."""
    # Check cache/blob first
    try:
        from azure_services.persistence.cosmos_db import get_course_curriculum as get_cc_from_store
        if get_cc_from_store(agent_name):
            return "Threshold concepts and learning state loaded successfully. Use the topic map to see what the student has learned, what's in progress, and what to teach next."
    except Exception:
        pass

    # Fallback: check local file
    setup_dir = _setup_dir(agent_name)
    plan_path = setup_dir / "course_curriculum.json" if setup_dir else None
    if plan_path and plan_path.exists():
        return "Threshold concepts and learning state loaded successfully. Use the topic map to see what the student has learned, what's in progress, and what to teach next."
    return "Threshold concepts not yet available. Teach based on your knowledge of the course topic."
