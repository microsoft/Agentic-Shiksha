from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ClarificationAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)

    answer: str = Field(max_length=4000)


class ClarificationAnswers(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    answers: list[ClarificationAnswer] = Field(min_length=1, max_length=3)


class ClarificationExtension(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    revision: int = Field(ge=0)


class ClarificationState(BaseModel):
    clarify_id: str
    phase: Literal["answering", "decision"]
    answer_deadline_ms: int
    decision_deadline_ms: int
    server_now_ms: int
    answer_window_seconds: float
    decision_window_seconds: float
    revision: int
    answers: list[ClarificationAnswer]


class ClarificationSubmitted(BaseModel):
    status: Literal["ok"] = "ok"
    answers: int
