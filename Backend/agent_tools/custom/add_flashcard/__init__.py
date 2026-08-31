"""Interactive swipeable/flippable flashcard sets. See README.md."""

import json
import logging
from typing import Dict, Any, List

from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

# Tool definition for Azure AI Agents - responses API format
ADD_FLASHCARD_TOOL_DEFINITION = load_tool_definition("add_flashcard")


class AddFlashcardTool(CustomTool):
    """Create a set of interactive flashcards rendered in the chat pane."""

    name = "add_flashcard"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        title = arguments.get("title", "Flashcards")
        cards = arguments.get("cards", [])

        # Sanitize cards
        sanitized_cards = []
        for c in cards:
            card = {
                "front": c.get("front", ""),
                "back": c.get("back", ""),
            }
            if card["front"] and card["back"]:
                sanitized_cards.append(card)

        logger.info(f"add_flashcard called: title='{title}', cards={len(sanitized_cards)}")

        return {
            "type": "flashcard",
            "title": title,
            "cards": sanitized_cards,
        }

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        title = result.get("title", "Flashcards")
        num_cards = len(result.get("cards", []))
        return f"Flashcard set '{title}' with {num_cards} cards created and shown to the user. Do NOT repeat the cards in text."
