"""Text message blocks in the content-block sequence. See README.md."""

import json
import logging
from typing import Dict, Any

from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

# Tool definition for Azure AI Agents - responses API format
ADD_MESSAGE_TOOL_DEFINITION = load_tool_definition("add_message")


class AddMessageTool(CustomTool):
    """Emit a text message block in the content-block sequence."""

    name = "add_message"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        content = arguments.get("content", "")

        logger.info(f"add_message called: content_length={len(content)}")

        return {
            "type": "message_block",
            "content": content,
        }

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        return "Message delivered to user. Do NOT call add_message again unless the user asks a new question. Your response is complete."
