import logging
from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException

from admin_backend.dependencies import Services

logger = logging.getLogger(__name__)
router = APIRouter()

listing_router = APIRouter()


@listing_router.get("/api/dashboard/agents", tags=["Agents"])
def list_agents(*, services: Services):
    """List all agents (courses) with basic metadata."""
    try:
        agents = services.queries.list_agents()
        return {"agents": agents, "count": len(agents)}
    except Exception as e:
        logger.error(f"Failed to list agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/dashboard/agents/{agent_id}/transfer-ownership", tags=["Agents"])
def transfer_ownership(agent_id: str, payload: Dict[str, Any]=Body(...), *, services: Services):
    """
    Transfer agent ownership to another user.

    Request body:
        new_owner_id: The userId of the new owner
    """
    return services.agents.transfer_ownership(agent_id, payload)


@router.get("/api/dashboard/agents/{agent_id}/teachers", tags=["Agents"])
def get_agent_teachers(agent_id: str, *, services: Services):
    """Return the teachers currently assigned to a course."""
    return services.agents.get_agent_teachers(agent_id)


@router.post("/api/dashboard/agents/{agent_id}/teachers", tags=["Agents"])
def set_agent_teachers(agent_id: str, payload: Dict[str, Any]=Body(...), *, services: Services):
    """
    Replace the teachers assigned to a course.

    Request body:
        teacher_ids: List of userIds to assign as teachers
    """
    return services.agents.set_agent_teachers(agent_id, payload)
