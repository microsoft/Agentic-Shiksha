from pydantic import BaseModel, ConfigDict, Field


class SpeechTokenResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, repr=False)
    region: str = Field(min_length=1)
