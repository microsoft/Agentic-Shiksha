"""
Azure AI Content Safety guardrail for tutor claims about a student's history.

The tutor is encouraging by nature and will sometimes narrate the curriculum back
as if the student had already studied it. This module checks such claims against
the student's real learning state using Content Safety groundedness detection.

Only sentences that actually assert prior work are sent for checking. Submitting a
whole reply produces false positives, because ordinary teaching language ("we will
build up from the basics") is not supported by a progress record and is therefore
reported as ungrounded.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# Groundedness detection is preview-only; the GA versions 404 on this route.
_API_VERSION = "2024-09-15-preview"
_SCOPE = "https://cognitiveservices.azure.com/.default"
_TIMEOUT_SECONDS = float(os.getenv("CONTENT_GUARDRAIL_TIMEOUT", "10"))

# Phrases that assert the student has covered material before.
_PRIOR_WORK_PATTERN = re.compile(
    r"\b("
    r"already (?:crossed|covered|learn(?:ed|t)|explored|studied|mastered|seen|done)"
    r"|earlier (?:exploration|work|session|chat|conversation)"
    r"|previous(?:ly)? (?:explored|covered|learn(?:ed|t)|studied|session)"
    r"|from your (?:earlier|previous|prior|past)"
    r"|you(?:'ve| have) (?:already|previously)"
    r"|last time|so far you|building on what you|picking up where"
    r"|not starting from (?:zero|scratch)"
    r")\b",
    re.IGNORECASE,
)

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")

# A claim usually carries a teaching aside ("… so let's go deeper"). That tail is not
# in the progress record, so scoring it would fail an otherwise truthful claim.
_CLAIM_TAIL = re.compile(
    r"\s*(?:[,;\u2014-]\s*)?\b(?:so|and now|now|then|which means|let'?s|we(?:'ll| will)|i(?:'ll| will))\b.*$",
    re.IGNORECASE,
)


def _normalise_claim(sentence: str) -> str:
    """Keep the factual assertion, drop the teaching aside that follows it."""
    trimmed = _CLAIM_TAIL.sub("", sentence).strip(" ,;:-\u2014")
    return f"{trimmed}." if trimmed and not trimmed.endswith((".", "!", "?")) else trimmed


def _endpoint() -> Optional[str]:
    raw = os.getenv("CONTENT_SAFETY_ENDPOINT") or os.getenv("AI_SERVICES_ENDPOINT")
    return raw.rstrip("/") if raw else None


def claim_sentences(reply: str) -> List[str]:
    """Sentences in ``reply`` that assert the student has prior history."""
    if not reply:
        return []
    claims = []
    for sentence in _SENTENCE_SPLIT.split(reply):
        if not _PRIOR_WORK_PATTERN.search(sentence):
            continue
        normalised = _normalise_claim(sentence.strip())
        if normalised:
            claims.append(normalised)
    return claims


def progress_grounding_source(prior_progress: Dict[str, Any], course: str = "") -> str:
    """
    Render a learning state into a factual statement for the detector.

    Names are included when available: a source that only carries counts cannot
    support a claim about a specific topic, so a legitimate reference to real
    prior work would otherwise be reported as ungrounded.
    """
    learned = [str(t) for t in (prior_progress.get("learned_topics") or []) if t]
    in_progress = [str(t) for t in (prior_progress.get("in_progress_topics") or []) if t]
    concepts = [str(c) for c in (prior_progress.get("learned_concepts") or []) if c]

    learned_count = int(prior_progress.get("topics_learned", len(learned)) or 0)
    in_progress_count = int(prior_progress.get("topics_in_progress", len(in_progress)) or 0)
    concept_count = int(prior_progress.get("concepts_learned", len(concepts)) or 0)

    scope = f" for the course {course}" if course else ""
    if not (learned_count or in_progress_count or concept_count):
        return (
            f"Student learning record{scope}: no topics learned, no topics in progress, "
            "no threshold concepts crossed. The student has no recorded prior activity "
            "and has not studied or explored any of this material before."
        )

    parts = [f"Student learning record{scope}."]
    parts.append(
        f"The student has learned these {learned_count} topics: {', '.join(learned)}."
        if learned
        else f"The student has learned {learned_count} topics."
    )
    if in_progress_count:
        parts.append(
            f"These {in_progress_count} topics are in progress: {', '.join(in_progress)}."
            if in_progress
            else f"{in_progress_count} topics are in progress."
        )
    if concept_count:
        parts.append(
            f"The student has crossed these threshold concepts: {', '.join(concepts)}."
            if concepts
            else f"The student has crossed {concept_count} threshold concepts."
        )
    parts.append("The student has studied and explored this material before.")
    return " ".join(parts)


def check_progress_claims(
    reply: str,
    prior_progress: Dict[str, Any],
    *,
    question: str = "",
    course: str = "",
    credential: Any = None,
) -> Dict[str, Any]:
    """
    Check the reply's prior-work claims against the student's real progress.

    Returns a verdict dict. ``checked`` is False when the guardrail did not run —
    no claims present, no endpoint configured, or the service was unreachable.
    Callers must treat an unchecked verdict as "not proven bad", never as a block.
    """
    verdict: Dict[str, Any] = {
        "checked": False,
        "violation": False,
        "claims": [],
        "ungrounded_percentage": 0.0,
        "reason": "",
    }

    claims = claim_sentences(reply)
    if not claims:
        verdict["reason"] = "no prior-work claims in reply"
        return verdict

    verdict["claims"] = claims

    endpoint = _endpoint()
    if not endpoint:
        verdict["reason"] = "no Content Safety endpoint configured"
        return verdict

    try:
        if credential is None:
            from common_azure_auth import get_sync_credential

            credential = get_sync_credential()
        token = credential.get_token(_SCOPE).token
        response = httpx.post(
            f"{endpoint}/contentsafety/text:detectGroundedness?api-version={_API_VERSION}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "domain": "Generic",
                # Summarization scores the claim on its own; QnA additionally weighs
                # the reply against the question and flags ordinary teaching asides.
                "task": "Summarization",
                "text": " ".join(claims),
                "groundingSources": [progress_grounding_source(prior_progress, course)],
                "reasoning": False,
            },
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        body = response.json()
    except Exception as e:
        # Never block a lesson because the guardrail is unavailable.
        logger.warning(f"Groundedness guardrail unavailable: {type(e).__name__}: {e}")
        verdict["reason"] = f"guardrail unavailable: {type(e).__name__}"
        return verdict

    verdict["checked"] = True
    verdict["violation"] = bool(body.get("ungroundedDetected"))
    verdict["ungrounded_percentage"] = float(body.get("ungroundedPercentage") or 0.0)
    verdict["reason"] = "ungrounded prior-work claim" if verdict["violation"] else "claims grounded"

    if verdict["violation"]:
        logger.warning(
            "Guardrail: tutor asserted unearned progress (%.0f%% ungrounded): %s",
            verdict["ungrounded_percentage"] * 100,
            claims[0][:160],
        )
    return verdict
