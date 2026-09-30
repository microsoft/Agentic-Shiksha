import logging

from fastapi import APIRouter, HTTPException

from admin_backend.dependencies import Services
from admin_backend.schemas.quota import ImageQuotaUpdate
from admin_backend.services.quota import quota_payload

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/dashboard/image-quota", tags=["Image Quota"])
def get_image_quota(*, services: Services):
    """Current weekly image quota applied to every student, per course."""
    try:
        return quota_payload(services.queries.get_image_quota_config())
    except Exception as e:
        logger.error(f"Failed to read image quota: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/api/dashboard/image-quota", tags=["Image Quota"])
def update_image_quota(body: ImageQuotaUpdate, *, services: Services):
    """Set the weekly image quota. Applies to every student on every course."""
    supplied = {k: v for k, v in body.model_dump().items() if v is not None}
    if not supplied:
        raise HTTPException(status_code=400, detail="Provide at least one of: medium, low")
    try:
        limits = services.queries.set_image_quota_config(supplied)
        logger.info(f"Image quota updated to {limits}")
        return quota_payload(limits)
    except Exception as e:
        logger.error(f"Failed to update image quota: {e}")
        raise HTTPException(status_code=500, detail=str(e))
