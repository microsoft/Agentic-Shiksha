"""Parse structured research-agent output with a narrow repair fallback."""

import json
import re
from typing import Any, Dict

from json_repair import repair_json


def _extract_json_text(raw_response: str) -> str:
    text = (raw_response or "").strip()
    if "```json" in text:
        start = text.find("```json") + len("```json")
        end = text.find("```", start)
        if end > start:
            text = text[start:end].strip()
    elif "```" in text:
        start = text.find("```") + len("```")
        end = text.find("```", start)
        if end > start:
            text = text[start:end].strip()
    return re.sub(r",\s*([\]}])", r"\1", text)


def parse_research_json(raw_response: str) -> Dict[str, Any]:
    """Return one JSON object, repairing common model quoting mistakes only."""
    json_text = _extract_json_text(raw_response)
    if not json_text:
        raise json.JSONDecodeError("Research response was empty", raw_response, 0)

    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError:
        parsed = repair_json(json_text, return_objects=True)

    if not isinstance(parsed, dict) or not parsed:
        raise json.JSONDecodeError(
            "Research response did not contain a JSON object",
            raw_response,
            0,
        )
    return parsed