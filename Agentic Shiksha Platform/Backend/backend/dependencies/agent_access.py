import logging
from typing import Annotated

from azure.cosmos.exceptions import CosmosResourceNotFoundError
from fastapi import Depends, HTTPException, Request

from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.schemas.agent_membership import AgentAccessRecord


logger = logging.getLogger(__name__)
CurrentUser = Annotated[ActiveUser, Depends(get_current_active_user)]


def load_agent(agent_id: str) -> dict:
    from azure_services.persistence.cosmos_db import _get_agents_container

    try:
        agent = _get_agents_container().read_item(item=agent_id, partition_key=agent_id)
        record = AgentAccessRecord.model_validate(agent)
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Teaching assistant not found") from None
    except Exception:
        logger.exception("Could not verify teaching assistant access")
        raise HTTPException(status_code=503, detail="TA access could not be verified. Please retry.") from None
    if record.id != agent_id:
        raise HTTPException(status_code=403, detail="Teaching assistant access required")
    return agent


def student_assignment_ids(user_id: str) -> list[str]:
    from azure_services.persistence.cosmos_db import get_student_assignment_ids

    return get_student_assignment_ids(user_id)


def has_agent_access(agent: dict, user: ActiveUser) -> bool:
    record = AgentAccessRecord.model_validate(agent)
    if user.role in {"admin", "superadmin"}:
        return True
    if user.role == "teacher":
        return user.id == record.created_by or user.id in record.teachers
    if record.status != "active":
        return False
    if user.id in record.students:
        return True
    if not record.students:
        return False
    return bool(set(student_assignment_ids(user.id)).intersection(record.students))


def check_agent_access(agent: dict, user: ActiveUser) -> None:
    try:
        allowed = has_agent_access(agent, user)
    except Exception:
        logger.exception("Could not verify teaching assistant membership")
        raise HTTPException(status_code=503, detail="TA access could not be verified. Please retry.") from None
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="You are not assigned to this teaching assistant. Ask an administrator for access.",
        )


def require_agent_access(request: Request, user: CurrentUser) -> None:
    agent_id = (
        request.path_params.get("agent_id") or request.path_params.get("agent_name")
        or request.query_params.get("agent_name")
    )
    if not agent_id:
        raise HTTPException(status_code=400, detail="Teaching assistant is required")
    target_user = request.path_params.get("user_id")
    if user.role == "student" and target_user is not None and target_user != user.id:
        raise HTTPException(status_code=403, detail="Student account must match the signed-in account")
    check_agent_access(load_agent(agent_id), user)
    request.state.agent_user = user


def require_agent_editor(request: Request, user: CurrentUser) -> None:
    if user.role == "student":
        raise HTTPException(status_code=403, detail="Teacher access required")
    require_agent_access(request, user)


async def require_body_agent_access(request: Request, user: CurrentUser) -> None:
    body = await request.json()
    agent_id = body.get("agent_name") if isinstance(body, dict) else None
    if agent_id:
        if not isinstance(agent_id, str):
            raise HTTPException(status_code=400, detail="Invalid teaching assistant")
        check_agent_access(load_agent(agent_id), user)
    request.state.agent_user = user
