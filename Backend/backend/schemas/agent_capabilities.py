"""Teacher-selected optional output tools for a teaching assistant."""

from pydantic import BaseModel, ConfigDict, StrictBool


CAPABILITY_TOOLS = {
    "documents": "add_document",
    "quizzes": "add_quiz",
    "flashcards": "add_flashcard",
    "challenges": "add_challenge",
    "images": "generate_image",
}


class AgentCapabilities(BaseModel):
    model_config = ConfigDict(extra="forbid")

    documents: StrictBool = True
    quizzes: StrictBool = True
    flashcards: StrictBool = True
    challenges: StrictBool = True
    images: StrictBool = True

    @property
    def disabled_tools(self) -> set[str]:
        return {
            tool_name
            for capability, tool_name in CAPABILITY_TOOLS.items()
            if not getattr(self, capability)
        }
