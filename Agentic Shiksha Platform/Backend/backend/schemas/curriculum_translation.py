from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


TranslationLanguage = Literal["te", "hi", "ta", "kn", "ml", "mr", "bn", "gu", "pa", "ur", "or", "as"]
TranslationStyle = Literal["pure", "mixed"]
InstructionsHash = Annotated[str, Field(pattern=r"^(default|[0-9a-f]{64})$")]
MAX_TRANSLATION_INSTRUCTIONS_LENGTH = 2000
DEFAULT_TRANSLATION_INSTRUCTIONS = (
    Path(__file__).resolve().parents[2] / "prompt_store" / "tools" / "syllabus_translation_default_v1.md"
).read_text(encoding="utf-8").strip()


def normalize_translation_instructions(instructions: str) -> str:
    return instructions.replace("\r\n", "\n").replace("\r", "\n").strip()


class CurriculumTranslationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: TranslationLanguage
    style: TranslationStyle = "mixed"
    source_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    instructions: str = Field(default=DEFAULT_TRANSLATION_INSTRUCTIONS, min_length=1, max_length=MAX_TRANSLATION_INSTRUCTIONS_LENGTH)

    @field_validator("instructions", mode="before")
    @classmethod
    def normalize_instructions(cls, value: object) -> object:
        return normalize_translation_instructions(value) if isinstance(value, str) else value


class TranslationBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    translations: list[str] = Field(min_length=1)


class CurriculumTranslationSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: TranslationLanguage
    style: TranslationStyle
    source_hash: str
    created_at: datetime
    instructions_hash: InstructionsHash = "default"


class CurriculumTranslation(CurriculumTranslationSummary):
    translations: dict[str, str]


class CurriculumTranslationCatalog(BaseModel):
    source_hash: str
    translations: list[CurriculumTranslationSummary] = Field(default_factory=list)
    default_instructions: str = DEFAULT_TRANSLATION_INSTRUCTIONS
    max_instructions_length: int = MAX_TRANSLATION_INSTRUCTIONS_LENGTH
