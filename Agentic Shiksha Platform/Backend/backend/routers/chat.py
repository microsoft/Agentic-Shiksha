"""Typed chat entry points; legacy stream formatting remains a compatibility adapter."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, JsonValue, field_validator

from backend.dependencies.agent_access import require_agent_access
from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.schemas.chat_preferences import AnswerDepth
from learner_memory.integration import capture_chat, memory_api_errors

router = APIRouter(
    prefix="/api/agents", tags=["Chat"], dependencies=[Depends(require_agent_access)]
)
CurrentUser = Annotated[ActiveUser, Depends(get_current_active_user)]


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(default="", max_length=60000)
    thread_id: str | None = None
    conversation_id: str | None = None
    user_id: str | None = None
    user_profile: dict[str, JsonValue] | None = None
    inject_profile: bool = True
    tool_choice: Literal["auto", "required", "none"] = "auto"
    research_mode: bool = False
    web_search_enabled: bool = False
    answer_depth: AnswerDepth = "balanced"
    image_urls: list[str] = Field(default_factory=list, max_length=8)
    usage_event_id: str | None = Field(default=None, max_length=256)
    event_id: str | None = Field(default=None, min_length=1, max_length=256)
    supersedes_event_id: str | None = Field(default=None, min_length=1, max_length=256)
    occurred_at: AwareDatetime | None = None

    @field_validator("answer_depth", mode="before")
    @classmethod
    def valid_answer_depth(cls, value: object) -> str:
        if not isinstance(value, str) or value not in {"quick", "balanced", "detailed"}:
            raise HTTPException(status_code=422, detail="answer_depth must be quick, balanced, or detailed")
        return value


class ChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: str
    conversation_id: str | None = None
    thread_id: str | None = None
    blocks: list[JsonValue] = Field(default_factory=list)
    event_id: str | None = None
    memory_status: str | None = None


def prepare_chat(agent_id: str, body: ChatRequest, request: Request, user: ActiveUser) -> dict:
    if body.user_id and body.user_id != user.id:
        raise HTTPException(status_code=403, detail="Chat account must match the signed-in account")
    if not body.text and not body.image_urls:
        raise HTTPException(status_code=400, detail="text or image_urls is required")
    with memory_api_errors():
        context, receipt = capture_chat(
            agent_id, user, event_id=body.event_id, occurred_at=body.occurred_at,
            text=body.text, thread_id=body.thread_id or body.conversation_id,
            image_urls=body.image_urls, supersedes_event_id=body.supersedes_event_id,
        )
    request.state.agent_user = user
    request.state.memory_context = context
    request.state.memory_receipt = receipt
    payload = body.model_dump(mode="json", exclude_none=True)
    payload["user_id"] = user.id
    return payload


def _receipt_headers(response: StreamingResponse, request: Request) -> StreamingResponse:
    receipt = getattr(request.state, "memory_receipt", None)
    if receipt is not None:
        response.headers["X-Memory-Event-Id"] = receipt.event_id
        response.headers["X-Memory-Status"] = str(receipt.status)
    return response


@router.post("/{agent_id}/chat/stream", response_class=StreamingResponse, response_model=None)
def chat_stream(agent_id: str, body: ChatRequest, request: Request, user: CurrentUser):
    from backend import main

    payload = prepare_chat(agent_id, body, request, user)
    return _receipt_headers(main.agent_chat_stream(agent_id, request, payload), request)


@router.post("/{agent_id}/chat/agui", response_class=StreamingResponse, response_model=None)
def chat_agui(agent_id: str, body: ChatRequest, request: Request, user: CurrentUser):
    from backend import main

    payload = prepare_chat(agent_id, body, request, user)
    return _receipt_headers(main.agent_chat_agui(agent_id, request, payload), request)


def _nonstream(agent_id: str, body: ChatRequest, request: Request, user: ActiveUser, continuing: bool):
    from backend import main

    if continuing and not (body.thread_id or body.conversation_id):
        raise HTTPException(status_code=422, detail="A conversation ID is required")
    payload = prepare_chat(agent_id, body, request, user)
    if request.state.memory_context is None:
        return (
            main.agent_chat_continue(agent_id, payload) if continuing
            else main.agent_chat_start(agent_id, payload)
        )
    stream, conversation_id, _user_id = main._open_agent_stream(agent_id, payload, request)
    blocks, replies = [], []
    for event_type, data, conv_id in stream:
        conversation_id = conv_id or conversation_id
        if event_type == "error":
            raise HTTPException(status_code=503, detail="The assistant could not complete the response")
        if event_type == "message_block":
            block = json.loads(data) if isinstance(data, str) else data
            replies.append(str(block.get("content") or ""))
        elif event_type in {"quiz", "document", "challenge", "circuit", "slides"}:
            block = json.loads(data) if isinstance(data, str) else data
            blocks.append({"type": event_type, **block})
    return ChatResponse(
        reply="\n\n".join(replies), blocks=blocks,
        conversation_id=conversation_id, thread_id=conversation_id,
        event_id=request.state.memory_receipt.event_id,
        memory_status=str(request.state.memory_receipt.status),
    )


@router.post("/{agent_id}/chat/start", response_model=ChatResponse, response_model_exclude_none=True, response_model_exclude_defaults=True)
def chat_start(agent_id: str, body: ChatRequest, request: Request, user: CurrentUser):
    return _nonstream(agent_id, body, request, user, False)


@router.post("/{agent_id}/chat/continue", response_model=ChatResponse, response_model_exclude_none=True, response_model_exclude_defaults=True)
def chat_continue(agent_id: str, body: ChatRequest, request: Request, user: CurrentUser):
    return _nonstream(agent_id, body, request, user, True)
