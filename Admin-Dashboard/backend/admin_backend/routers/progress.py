import logging

from fastapi import APIRouter, HTTPException

from admin_backend.core.log_safe import scrub
from admin_backend.dependencies import Services

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/dashboard/agents/{agent_name}/overview", tags=["Progress"])
def agent_overview(agent_name: str, *, services: Services):
    """
    Aggregate learning-progress stats for an agent:
    student count, avg completion %, distribution buckets, top struggle topics,
    per-student summaries, and real usage stats (active students/teachers).
    """
    try:
        overview = services.queries.agent_overview(agent_name)
        usage = services.queries.agent_usage_stats(agent_name)
        overview["usage"] = usage
        return overview
    except Exception as e:
        logger.error(f"Failed to get overview for agent '{scrub(agent_name)}': {scrub(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/dashboard/agents/{agent_name}/students/{user_id}", tags=["Progress"])
def student_detail(agent_name: str, user_id: str, *, services: Services):
    """
    Full per-topic breakdown for a single student on an agent.
    """
    try:
        detail = services.queries.student_detail(user_id, agent_name)
        if detail is None:
            raise HTTPException(
                status_code=404,
                detail=f"No learning state found for user '{user_id}' on agent '{agent_name}'",
            )
        return detail
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get detail for user '{scrub(user_id)}' on agent '{scrub(agent_name)}': {scrub(e)}")
        raise HTTPException(status_code=500, detail=str(e))
