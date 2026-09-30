import json
import logging
from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse

from admin_backend.core.log_safe import scrub
from admin_backend.dependencies import Services

logger = logging.getLogger(__name__)
router = APIRouter()


@router.options("/api/dashboard/logging-agent/chat/stream", tags=["Chat"])
def logging_agent_chat_options():
    return {}


@router.post("/api/dashboard/logging-agent/chat/stream", tags=["Chat"])
def logging_agent_chat_stream(payload: Dict[str, Any]=Body(...), *, services: Services):
    """
    Stream a conversation with the logging-agent via SSE.

    Request body:
        text: The user's message (required)
        conversation_id: Optional existing conversation ID for continuation
    """
    text = payload.get("text", "")
    conversation_id = payload.get("thread_id") or payload.get("conversation_id")

    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    logger.info(
        f"[Logging Chat] text_len={scrub(len(text))}, conv_id={scrub(conversation_id)}"
    )

    def generate_sse():
        try:
            for event_type, data, conv_id in services.chat_stream(text, conversation_id):
                if event_type == "thread_id":
                    yield f"data: {json.dumps({'type': 'thread_id', 'thread_id': data, 'conversation_id': data})}\n\n"
                elif event_type == "delta":
                    yield f"data: {json.dumps({'type': 'delta', 'content': data, 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "message_block_start":
                    yield f"data: {json.dumps({'type': 'message_block_start', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "message_block_delta":
                    try:
                        dd = json.loads(data)
                        yield f"data: {json.dumps({'type': 'message_block_delta', 'delta': dd.get('delta', ''), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        pass
                elif event_type == "message_block":
                    try:
                        md = json.loads(data)
                        yield f"data: {json.dumps({'type': 'message_block', 'content': md.get('content', ''), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        pass
                elif event_type == "done":
                    yield f"data: {json.dumps({'type': 'done', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "error":
                    # `data` can carry upstream exception text; keep it server-side only.
                    logger.error("Agent stream error event: %s", scrub(data))
                    yield f"data: {json.dumps({'type': 'error', 'error': 'Internal error', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
        except Exception as e:
            logger.error(f"SSE stream error: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'error': 'Internal error'})}\n\n"

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
