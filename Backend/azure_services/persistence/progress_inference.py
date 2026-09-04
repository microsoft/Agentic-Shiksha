"""Marks curriculum topics as in-progress from what was actually taught.

Progress previously depended entirely on the tutor remembering to call
``update_topic_progress``, which happened for well under 10% of students. This
derives the ``in_progress`` signal from the turn itself so tracking no longer
relies on model compliance. ``learned`` is deliberately NOT inferred — that
still requires the tutor's judgement or assessment evidence.
"""

import logging
import re
from typing import Any, Dict, Iterable, List, Optional
from utils.log_safe import scrub

logger = logging.getLogger(__name__)

# Single-word topics ("Protocol", "simple", "process") match ordinary prose and
# produced obvious false positives on real transcripts, so only multi-word topic
# names are inferable. The tutor's own update_topic_progress call still covers the rest.
MIN_TOPIC_LENGTH = 6
MIN_TOPIC_WORDS = 2
MAX_TOPICS_PER_TURN = 3
_NON_WORD = re.compile(r"[^a-z0-9]+")


def _normalise(text: str) -> str:
    return _NON_WORD.sub(" ", (text or "").lower()).strip()


def _matches(topic_norm: str, haystack: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(topic_norm)}(?![a-z0-9])", haystack) is not None


def find_taught_topics(topics: Dict[str, Any], text: str) -> List[str]:
    """Return not-yet-started curriculum topics named in the turn, most specific first."""
    haystack = _normalise(text)
    if not haystack:
        return []

    hits: List[tuple] = []
    for name, entry in (topics or {}).items():
        if (entry or {}).get("status") != "not_started":
            continue
        topic_norm = _normalise(name)
        if len(topic_norm) < MIN_TOPIC_LENGTH or len(topic_norm.split()) < MIN_TOPIC_WORDS:
            continue
        if _matches(topic_norm, haystack):
            hits.append((len(topic_norm), name))

    hits.sort(reverse=True)
    return [name for _, name in hits[:MAX_TOPICS_PER_TURN]]


def record_taught_topics(
    user_id: str,
    agent_id: str,
    texts: Iterable[str],
    summary: Optional[str] = None,
) -> List[str]:
    """Mark topics discussed this turn as in_progress. Never raises."""
    if not user_id or not agent_id:
        return []

    combined = "\n".join(t for t in texts if t)
    if not combined.strip():
        return []

    try:
        from azure_services.persistence.cosmos_db import (
            ensure_learning_state,
            update_topic_in_state,
        )

        state = ensure_learning_state(user_id, agent_id)
        if not state:
            return []

        taught = find_taught_topics(state.get("topics") or {}, combined)
        recorded = []
        for topic in taught:
            result = update_topic_in_state(
                user_id, agent_id, topic, "in_progress", summary=summary
            )
            if not result.get("error"):
                recorded.append(topic)

        if recorded:
            logger.info(
                f"[progress] Inferred in_progress for user='{scrub(user_id)}', agent='{scrub(agent_id)}': {scrub(recorded)}"
            )
        return recorded
    except Exception as e:
        logger.error(f"[progress] Topic inference failed for user='{scrub(user_id)}', agent='{scrub(agent_id)}': {scrub(e)}")
        return []
