import unicodedata

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CourseAvatar(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    initials: str | None = Field(default=None, max_length=24)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")

    @field_validator("initials")
    @classmethod
    def validate_initials(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = unicodedata.normalize("NFC", value.strip().upper())
        if not normalized:
            return None
        letters = 0
        for character in normalized:
            category = unicodedata.category(character)[0]
            if category in {"L", "N"}:
                letters += 1
            elif category != "M" or not letters:
                raise ValueError("Initials must contain only letters or numbers")
        if not 1 <= letters <= 3:
            raise ValueError("Initials must contain at most three letters or numbers")
        return normalized
