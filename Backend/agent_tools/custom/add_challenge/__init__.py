"""Interactive challenges (coding, problems, case studies). See README.md."""

import json
import logging
from typing import Dict, Any, List

from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

# Tool definition for Azure AI Agents - responses API format
ADD_CHALLENGE_TOOL_DEFINITION = load_tool_definition("add_challenge")


class AddChallengeTool(CustomTool):
    """Create an interactive challenge (problem, coding task, case study, ...)."""

    name = "add_challenge"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        title = arguments.get("title", "Challenge")
        description = arguments.get("description", "")
        difficulty = arguments.get("difficulty", "medium")
        hints = arguments.get("hints", [])
        solution = arguments.get("solution", "")
        challenge_type = arguments.get("challenge_type", "problem")

        # Validate difficulty
        if difficulty not in ("easy", "medium", "hard"):
            difficulty = "medium"

        # Validate challenge_type
        if challenge_type not in ("coding", "problem", "case_study", "equation", "puzzle"):
            challenge_type = "problem"

        # Sanitize hints
        sanitized_hints = [h for h in hints if isinstance(h, str) and h.strip()]

        logger.info(f"add_challenge called: title='{title}', difficulty={difficulty}, type={challenge_type}, hints={len(sanitized_hints)}")

        return {
            "type": "challenge",
            "title": title,
            "description": description,
            "difficulty": difficulty,
            "hints": sanitized_hints,
            "solution": solution,
            "challenge_type": challenge_type,
        }

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        title = result.get("title", "Challenge")
        difficulty = result.get("difficulty", "medium")
        return f"Challenge '{title}' (difficulty: {difficulty}) created and shown to the user. Do NOT repeat the challenge in text."
