from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LearnerProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    customInstructions: str


class LearnerProfileResponse(BaseModel):
    model_config = ConfigDict(strict=True)

    customInstructions: str
    updatedAt: str | None


class LearnerMisconceptionNote(BaseModel):
    model_config = ConfigDict(strict=True)

    note: str = ""
    recorded_at: str | None = None


class LearnerProgressEntry(BaseModel):
    model_config = ConfigDict(strict=True)

    status: Literal["not_started", "in_progress", "learned"]
    module: str | None = None
    latest_summary: str | None = None
    last_touched: str | None = None
    last_updated: str | None = None
    misconceptions_addressed: list[str] = Field(default_factory=list)
    misconception_notes: dict[str, LearnerMisconceptionNote] = Field(default_factory=dict)


class LearnerObjectiveEntry(BaseModel):
    model_config = ConfigDict(strict=True)

    status: Literal["not_started", "in_progress", "learned"]
    evidence: str | None = None


class LearnerLearningProgress(BaseModel):
    model_config = ConfigDict(strict=True)

    # Missing collections are unavailable, not a recorded count of zero.
    topics: dict[str, LearnerProgressEntry] | None = None
    threshold_concepts: dict[str, LearnerProgressEntry] | None = None
    objectives: dict[str, LearnerObjectiveEntry] | None = None


class StoredLearnerLearningState(LearnerLearningProgress):
    id: str
    agent_id: str | None = None
    partitionKey: str | None = None
    userId: str | None = None


class StoredLearnerPreferences(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    preferences: str | None = None


class LearnerLearningResponse(BaseModel):
    model_config = ConfigDict(strict=True)

    user_id: str
    agent_id: str
    status: Literal["ok", "no_state"]
    progress: LearnerLearningProgress | None
    learning_preferences: list[str]
