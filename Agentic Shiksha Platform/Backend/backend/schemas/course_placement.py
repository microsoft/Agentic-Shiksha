import unicodedata
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class _PlacementFields(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)

    institute: str = Field(max_length=200)
    department: str = Field(max_length=200)
    revision: str = Field(min_length=1, max_length=256)

    @field_validator("institute", "department", "revision", mode="before")
    @classmethod
    def reject_control_characters(cls, value: object) -> object:
        if isinstance(value, str) and any(unicodedata.category(char) == "Cc" for char in value):
            raise ValueError("Control characters are not allowed")
        return value


class CoursePlacement(_PlacementFields):
    agent_id: str


class CoursePlacementUpdate(_PlacementFields):
    @model_validator(mode="after")
    def require_complete_pair(self) -> Self:
        if bool(self.institute) != bool(self.department):
            raise ValueError("Institute and department must both be provided or both be empty")
        return self
