from pydantic import BaseModel, ConfigDict, Field


class ShareSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_ids: list[str] = Field(min_length=1, max_length=10000)
    refresh: bool = False


class ShareResult(BaseModel):
    success: bool
    share_token: str
    thread_id: str


class RevokeShareResult(BaseModel):
    success: bool