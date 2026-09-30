"""Structured educational documents shown in a side panel. See README.md."""

import json
import logging
from typing import Dict, Any

from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

# Tool definition for Azure AI Agents - responses API format
ADD_DOCUMENT_TOOL_DEFINITION = load_tool_definition("add_document")


class AddDocumentTool(CustomTool):
    """Create a structured educational document shown in a side panel."""

    name = "add_document"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        title = arguments.get("title") or "Untitled Document"
        content = arguments.get("content") or ""
        doc_type = arguments.get("doc_type", "markdown")

        if not isinstance(content, str):
            content = str(content)

        # An empty document still renders an openable card, so the student clicks
        # through to nothing. Refuse it here: the caller turns this into a
        # block_cancel that removes the placeholder and tells the model to retry.
        if not content.strip():
            logger.warning(
                f"add_document called with empty content (title='{title}') — rejecting"
            )
            raise ValueError(
                "add_document was called with empty content. A document must contain "
                "the full written material. If the diagram or message already answers "
                "the question, do not call add_document at all."
            )

        logger.info(f"add_document called: title='{title}', doc_type='{doc_type}', content_length={len(content)}")

        return {
            "type": "document",
            "title": title,
            "content": content,
            "doc_type": doc_type,
        }

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        title = result.get("title", "Untitled Document")
        return f"Document '{title}' created and shown to the user. Your response is complete — do NOT generate additional messages or documents unless the user asks."
