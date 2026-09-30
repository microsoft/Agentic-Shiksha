from typing import Literal

from pydantic import BaseModel, ConfigDict

AnswerDepth = Literal["quick", "balanced", "detailed"]


class ChatAnswerPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer_depth: AnswerDepth = "balanced"
