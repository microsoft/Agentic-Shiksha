import logging
from typing import Annotated

from azure.core.exceptions import HttpResponseError
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from fastapi import APIRouter, Depends, HTTPException

from backend.dependencies.agent_access import CurrentUser, check_agent_access, has_agent_access, load_agent
from backend.dependencies.auth import ActiveUser
from backend.schemas.agent_membership import (
    AgentAccessRecord,
    AgentCodeRequest,
    AgentCodeResult,
    AgentListItem,
    AgentMemberChange,
    AgentMemberPayload,
    AgentMembers,
    AssignmentStudent,
    StudentAssignmentDirectory,
    StudentAssignmentResult,
    StudentAssignmentUpdate,
    StudentDirectoryRecord,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Agent membership"])


def require_admin(user: CurrentUser) -> ActiveUser:
    if user.role not in {"admin", "superadmin"}:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user


AdminUser = Annotated[ActiveUser, Depends(require_admin)]


def membership_error(error: Exception) -> HTTPException:
    if isinstance(error, CosmosResourceNotFoundError):
        return HTTPException(status_code=404, detail="Teaching assistant not found")
    if isinstance(error, HttpResponseError) and error.status_code == 412:
        return HTTPException(status_code=409, detail="The roster changed. Reload it before saving again.")
    logger.error("Teaching assistant membership request failed", exc_info=True)
    return HTTPException(status_code=503, detail="Student assignments are unavailable. Please retry.")


def invalidate_membership(teacher_id: str | None = None, *, teachers: bool = False) -> None:
    from backend.main import _invalidate_agent_list_caches

    _invalidate_agent_list_caches(teacher_id, invalidate_teacher_scope=teachers)


def student_directory() -> tuple[dict[str, AssignmentStudent], dict[str, str]]:
    from azure_services.persistence.cosmos_db import list_student_assignment_candidates

    users, invitations = list_student_assignment_candidates()
    candidates: dict[str, AssignmentStudent] = {}
    aliases: dict[str, str] = {}
    for raw in users:
        record = StudentDirectoryRecord.model_validate(raw)
        if record.status not in {"active", "invited"}:
            raise ValueError("Invalid student directory status")
        candidates[record.id] = AssignmentStudent(
            user_id=record.id,
            name=record.displayName or record.fullName or record.email or record.id,
            email=record.email, institute=record.institute, department=record.department,
            status="active" if record.status == "active" else "invited",
        )
    for raw in invitations:
        record = StudentDirectoryRecord.model_validate(raw)
        if record.status == "promoted":
            if record.oauthUserId and record.oauthUserId in candidates:
                aliases[record.id] = record.oauthUserId
        elif record.status == "invited":
            candidates[record.id] = AssignmentStudent(
                user_id=record.id, name=record.name or record.email or record.id,
                email=record.email, institute=record.institute, department=record.department,
                status="invited",
            )
    return candidates, aliases


def assignment_revision(agent: dict) -> str:
    revision = agent.get("_etag")
    if not isinstance(revision, str) or not revision:
        raise ValueError("Missing agent revision")
    return revision


def validate_students(ids: list[str], candidates: dict[str, AssignmentStudent]) -> None:
    if any(student_id not in candidates for student_id in ids):
        raise HTTPException(
            status_code=422,
            detail="Select only active or invited students from the directory. Remove unavailable entries and retry.",
        )


@router.get("/agents/{agent_id}/students", response_model=StudentAssignmentDirectory)
def get_student_assignments(agent_id: str, user: AdminUser):
    try:
        agent = load_agent(agent_id)
        candidates, aliases = student_directory()
        record = AgentAccessRecord.model_validate(agent)
        student_ids = list(dict.fromkeys(aliases.get(uid, uid) for uid in record.students))
        for uid in student_ids:
            if uid not in candidates:
                candidates[uid] = AssignmentStudent(
                    user_id=uid, name="No longer in the student directory", email="",
                    institute="", department="", status="unavailable",
                )
        return StudentAssignmentDirectory(
            agent_id=agent_id, student_ids=student_ids, revision=assignment_revision(agent),
            students=sorted(candidates.values(), key=lambda student: (student.name.casefold(), student.user_id)),
        )
    except HTTPException:
        raise
    except Exception as error:
        raise membership_error(error) from None


@router.put("/agents/{agent_id}/students", response_model=StudentAssignmentResult)
def set_student_assignments(agent_id: str, body: StudentAssignmentUpdate, user: AdminUser):
    from azure_services.persistence.cosmos_db import set_agent_students

    try:
        agent = load_agent(agent_id)
        if assignment_revision(agent) != body.revision:
            raise HTTPException(status_code=409, detail="The roster changed. Reload it before saving again.")
        candidates, _aliases = student_directory()
        validate_students(body.student_ids, candidates)
        updated = set_agent_students(agent_id, body.student_ids, body.revision)
        invalidate_membership()
        return StudentAssignmentResult(
            agent_id=agent_id, student_ids=AgentAccessRecord.model_validate(updated).students,
            revision=assignment_revision(updated),
        )
    except HTTPException:
        raise
    except Exception as error:
        raise membership_error(error) from None


def require_manager(agent_id: str, user: ActiveUser, requester_id: str | None = None) -> dict:
    if requester_id is not None and requester_id != user.id:
        raise HTTPException(status_code=403, detail="Requester must match the signed-in account")
    if user.role == "student":
        raise HTTPException(status_code=403, detail="Teacher or administrator access required")
    agent = load_agent(agent_id)
    check_agent_access(agent, user)
    return agent


@router.get("/agents/{agent_id}/members", response_model=AgentMembers)
def get_members(agent_id: str, user: CurrentUser):
    agent = AgentAccessRecord.model_validate(require_manager(agent_id, user))
    return AgentMembers(teacherIds=agent.teachers, studentIds=agent.students)


@router.post("/agents/{agent_id}/members", response_model=AgentMemberChange, response_model_exclude_none=True)
def add_member(agent_id: str, body: AgentMemberPayload, user: CurrentUser, requester_id: str | None = None):
    from azure_services.persistence.cosmos_db import add_agent_member

    require_manager(agent_id, user, requester_id)
    try:
        if body.member_type == "student":
            require_admin(user)
            candidates, _aliases = student_directory()
            validate_students([body.user_id], candidates)
        updated = add_agent_member(agent_id, body.user_id, body.member_type)
        if updated is None:
            raise HTTPException(status_code=404, detail="Teaching assistant not found")
        invalidate_membership(
            body.user_id if body.member_type == "teacher" else None,
            teachers=body.member_type == "teacher",
        )
        return AgentMemberChange(agent_id=agent_id, added=body.user_id, member_type=body.member_type)
    except HTTPException:
        raise
    except Exception as error:
        raise membership_error(error) from None


@router.delete("/agents/{agent_id}/members/{target_user_id}", response_model=AgentMemberChange, response_model_exclude_none=True)
def remove_member(agent_id: str, target_user_id: str, user: CurrentUser, requester_id: str | None = None):
    from azure_services.persistence.cosmos_db import remove_agent_member

    agent = require_manager(agent_id, user, requester_id)
    if target_user_id in AgentAccessRecord.model_validate(agent).students:
        require_admin(user)
    try:
        remove_agent_member(agent_id, target_user_id, "teacher")
        updated = remove_agent_member(agent_id, target_user_id, "student")
        if updated is None:
            raise HTTPException(status_code=404, detail="Teaching assistant not found")
        invalidate_membership(target_user_id, teachers=True)
        return AgentMemberChange(agent_id=agent_id, removed=target_user_id)
    except HTTPException:
        raise
    except Exception as error:
        raise membership_error(error) from None


@router.post("/agents/connect-by-code", response_model=AgentCodeResult)
def connect_agent_by_code(body: AgentCodeRequest, user: CurrentUser):
    from azure_services.persistence.cosmos_db import add_agent_member, find_agent_by_manage_code

    try:
        agent = find_agent_by_manage_code(body.code)
        if not agent:
            raise HTTPException(status_code=404, detail="No agent found with that code")
        if user.role == "student":
            check_agent_access(agent, user)
            already_joined = True
        else:
            already_joined = has_agent_access(agent, user)
        if not already_joined:
            membership = add_agent_member(agent["id"], user.id, member_type="teacher")
            if membership is None:
                raise HTTPException(status_code=404, detail="No agent found with that code")
            invalidate_membership(user.id, teachers=True)
        return AgentCodeResult(
            agent_id=agent["id"], course_name=agent.get("courseName") or "",
            agent_name=agent.get("agentName") or agent["id"], already_joined=already_joined,
        )
    except HTTPException:
        raise
    except Exception as error:
        raise membership_error(error) from None


@router.get("/azure/agents/list", response_model=list[AgentListItem])
def list_agents(
    user: CurrentUser, force_refresh: bool = False,
    user_id: str | None = None, created_by_id: str | None = None,
):
    from backend.main import azure_agents_list

    if user_id is not None and user_id != user.id:
        raise HTTPException(status_code=403, detail="User must match the signed-in account")
    agents = azure_agents_list(
        force_refresh=force_refresh, created_by_id=None, user_id=user.id, user_role=user.role,
    )
    if created_by_id:
        agents = [agent for agent in agents if agent.get("created_by_id") == created_by_id]
    return agents
