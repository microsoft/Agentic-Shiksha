import logging

from azure.core import MatchConditions
from azure.core.exceptions import HttpResponseError
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from azure_services.persistence.cosmos_db import _get_agents_container
from backend.dependencies.agent_access import load_agent
from backend.routers.agent_membership import AdminUser
from backend.schemas.course_placement import CoursePlacement, CoursePlacementUpdate


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agents", tags=["Course placement"])
CONFLICT_DETAIL = "The course placement changed. Reload it before saving again."


def _placement_from_agent(agent_id: str, agent: dict) -> CoursePlacement:
    if "job_type" in agent:
        raise HTTPException(status_code=404, detail="Teaching assistant not found")
    revision = agent.get("_etag")
    if not isinstance(revision, str) or not revision.strip():
        raise ValueError("Missing course placement revision")
    try:
        placement = CoursePlacement(
            agent_id=agent_id, institute=agent.get("institute", ""),
            department=agent.get("department", ""), revision=revision,
        )
        if not placement.institute and "institution" in agent:
            placement = CoursePlacement(
                agent_id=agent_id, institute=agent["institution"],
                department=placement.department, revision=revision,
            )
    except ValidationError:
        raise HTTPException(status_code=422, detail="Saved course placement is invalid") from None
    if not placement.institute or not placement.department:
        placement.institute = placement.department = ""
    return placement


def _placement_error(error: Exception) -> HTTPException:
    if isinstance(error, CosmosResourceNotFoundError):
        return HTTPException(status_code=404, detail="Teaching assistant not found")
    if isinstance(error, HttpResponseError) and error.status_code == 412:
        return HTTPException(status_code=409, detail=CONFLICT_DETAIL)
    logger.exception("Teaching assistant placement request failed")
    return HTTPException(status_code=503, detail="Course placement is unavailable. Please retry.")


def _invalidate_placement_cache() -> None:
    from backend.main import _invalidate_agent_list_caches

    _invalidate_agent_list_caches(invalidate_teacher_scope=False)


@router.get("/{agent_id}/placement", response_model=CoursePlacement)
def get_course_placement(agent_id: str, user: AdminUser) -> CoursePlacement:
    try:
        return _placement_from_agent(agent_id, load_agent(agent_id))
    except HTTPException:
        raise
    except Exception as error:
        raise _placement_error(error) from None


@router.put("/{agent_id}/placement", response_model=CoursePlacement)
def set_course_placement(
    agent_id: str, body: CoursePlacementUpdate, user: AdminUser,
) -> CoursePlacement:
    try:
        current = _placement_from_agent(agent_id, load_agent(agent_id))
        if current.revision != body.revision:
            raise HTTPException(status_code=409, detail=CONFLICT_DETAIL)
        updated = _get_agents_container().patch_item(
            item=agent_id,
            partition_key=agent_id,
            patch_operations=[
                {"op": "set", "path": "/institute", "value": body.institute},
                {"op": "set", "path": "/department", "value": body.department},
                {"op": "set", "path": "/departmentId", "value": ""},
            ],
            etag=body.revision,
            match_condition=MatchConditions.IfNotModified,
        )
        _invalidate_placement_cache()
        return _placement_from_agent(agent_id, updated)
    except HTTPException:
        raise
    except Exception as error:
        raise _placement_error(error) from None
