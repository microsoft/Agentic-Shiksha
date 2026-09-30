import json
import logging
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from agent_tools.custom.base import CustomTool
from backend.schemas.slides import SlideDeck, SlidesBlock
from utils.slide_export import render_presentation
from utils.tool_definitions import load_tool_definition


logger = logging.getLogger(__name__)
ADD_SLIDES_TOOL_DEFINITION = load_tool_definition("add_slides")


class AddSlidesTool(CustomTool):
    name = "add_slides"

    def execute(self, arguments: dict[str, Any], **context: Any) -> dict[str, Any]:
        try:
            deck = SlideDeck.model_validate(arguments)
        except ValidationError:
            logger.warning("Rejected invalid slide deck")
            raise ValueError("Invalid slides. Use 1-20 slides, supported layouts, short titles and bullets, and HTTP(S) source links. Title/section slides use subtitles; two_column requires two columns; other layouts require bullets.") from None
        render_presentation(deck)
        return SlidesBlock(slidesId=str(uuid4()), title=deck.title, deck=deck).model_dump(mode="json")

    def output(self, result: Any, arguments: dict[str, Any]) -> str:
        block = SlidesBlock.model_validate(result)
        return json.dumps({
            "status": "created",
            "presentation_id": block.slidesId,
            "slide_count": len(block.deck.slides),
            "message": "The presentation is shown with preview, speaker notes and editable PowerPoint download. Do not repeat its full content in chat.",
        })
