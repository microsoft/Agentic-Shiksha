import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from admin_backend.dependencies import Services

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/dashboard/overview/courses", tags=["Overview"])
def courses_overview(*, services: Services):
    """
    Returns per-course analytics: name, institute, department, professors,
    active/total users.
    """
    try:
        courses, unique_total_users = services.queries.courses_overview()
        return {"courses": courses, "uniqueTotalUsers": unique_total_users}
    except Exception as e:
        logger.error(f"Failed to get courses overview: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/dashboard/overview/tokens", tags=["Overview"])
def token_usage_overview(*, services: Services):
    """
    Returns per-agent token + round stats from Azure AI Foundry.
    Cached for 10 minutes.
    """
    try:
        return {"tokens": services.token_stats()}
    except Exception as e:
        logger.error(f"Failed to get token stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/dashboard/overview/tokens/per-student", tags=["Overview"])
def token_usage_per_student(agent_id: Optional[str]=Query(None), *, services: Services):
    """
    Returns per-student token usage, optionally filtered by agent_id (course).
    Each entry: { userId, displayName, email, totalTokens, rounds }.
    """
    try:
        return {"students": services.queries.per_student_token_usage(agent_id=agent_id)}
    except Exception as e:
        logger.error(f"Failed to get per-student token usage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/dashboard/overview/today", tags=["Overview"])
def today_overview(start_date: Optional[str]=Query(None), end_date: Optional[str]=Query(None), *, services: Services):
    """
    Returns usage stats for a date range (defaults to today).
    """
    try:
        return services.queries.today_stats(start_date=start_date, end_date=end_date)
    except Exception as e:
        logger.error(f"Failed to get period stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))
