import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from admin_backend.dependencies import Services

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/dashboard/feedback", tags=["Feedback"])
def get_feedback(limit: int=Query(200, ge=1, le=1000), *, services: Services):
    """List all user feedback, newest first."""
    try:
        items = services.queries.list_feedback(limit=limit)
        stats = services.queries.get_feedback_stats()
        return {"feedback": items, "count": len(items), "stats": stats}
    except Exception as e:
        logger.error(f"Failed to list feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/dashboard/blob/proxy", tags=["Feedback"])
def proxy_blob(url: str=Query(...), *, services: Services):
    """Proxy a blob from Azure Storage (for feedback attachments)."""
    location = services.attachments.resolve(url)
    try:
        attachment = services.attachments.download(*location)
        return StreamingResponse(
            iter([attachment.content]),
            media_type=attachment.content_type,
            headers={"Cache-Control": "public, max-age=86400", "Content-Length": str(len(attachment.content))},
        )
    except Exception as e:
        logger.error(f"Blob proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
