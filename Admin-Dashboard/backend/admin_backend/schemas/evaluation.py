from typing import Optional

from pydantic import BaseModel


class GroundednessRequest(BaseModel):
    query: str
    response: str
    session_uuid: Optional[str] = None
    context: Optional[str] = None
    method: Optional[str] = "auto"  # "sdk", "llm", or "auto"


class RAGEvalRequest(BaseModel):
    query: str
    response: str
    session_uuid: Optional[str] = None
    context: Optional[str] = None
