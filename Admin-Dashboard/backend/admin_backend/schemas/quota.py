from typing import Optional

from pydantic import BaseModel, Field


class ImageQuotaUpdate(BaseModel):
    """Weekly per-student image allowance."""
    medium: Optional[int] = Field(default=None, ge=0, le=1000)
    low: Optional[int] = Field(default=None, ge=0, le=1000)
