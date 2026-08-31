"""Agent declares its tool-execution plan upfront. See README.md."""

import json
import logging
from typing import Dict, Any, List

from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

DECLARE_PLAN_TOOL_DEFINITION = load_tool_definition("declare_plan")


class DeclarePlanTool(CustomTool):
    """Let the agent declare its tool-execution plan up front."""

    name = "declare_plan"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        tools = arguments.get("tools", [])

        if not tools:
            return {"status": "error", "message": "Plan must include at least one tool"}

        # If plan is just ["add_message"], it's unnecessary — tell model to respond normally
        if tools == ["add_message"]:
            logger.info("Plan is just ['add_message'] — skipping plan, model should respond normally")
            return {
                "status": "skip",
                "plan": [],
                "message": "No plan needed for a simple text response. Just respond with your message directly — do not call add_message.",
            }

        # Validate tool names
        valid_tools = {
            "add_message", "add_document", "add_quiz", "add_flashcard",
            "add_challenge", "add_tikz_diagram",
            "generate_image",
            "get_threshold_concepts", "update_topic_progress",
            "ask_clarification", "suggest_next_queries",
        }
        invalid = [t for t in tools if t not in valid_tools]
        if invalid:
            return {
                "status": "error",
                "message": f"Invalid tools in plan: {invalid}. Valid: {sorted(valid_tools)}",
            }

        logger.info(f"Plan declared: {' → '.join(tools)}")

        return {
            "status": "accepted",
            "plan": tools,
            "message": f"Plan accepted: {' → '.join(tools)}. Execute each tool in order.",
        }

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        tools = arguments.get("tools", [])
        return f"Plan accepted: {' → '.join(tools)}. Now execute the first tool: {tools[0]}"
