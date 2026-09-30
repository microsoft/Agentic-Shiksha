from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SuggestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    question: str = Field(min_length=1, max_length=16000)
    answer: str = Field(min_length=1, max_length=12000)


class CourseSuggestions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    queries: list[Annotated[str, Field(min_length=1, max_length=160)]] = Field(min_length=3, max_length=3)

    @field_validator("queries")
    @classmethod
    def distinct_queries(cls, queries: list[str]) -> list[str]:
        normalized = [query.strip() for query in queries]
        if any(not query for query in normalized) or len({query.casefold() for query in normalized}) != 3:
            raise ValueError("Three distinct questions are required")
        return normalized