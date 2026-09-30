"""Authorize a learner partition before touching graph or learner records."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from azure.cosmos.exceptions import CosmosResourceNotFoundError
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.dependencies import agent_access
from backend.dependencies.auth import ActiveUser
from backend.schemas.agent_membership import AgentAccessRecord

if TYPE_CHECKING:
    from backend.schemas.learner_memory import MemoryScope


class MemoryIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    tenant_id: str = Field(min_length=1, max_length=256)
    institute_id: str = Field(min_length=1, max_length=256)


class CurriculumBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    curriculum_id: str = Field(min_length=1, max_length=256)
    curriculum_version: str = Field(min_length=1, max_length=128)


@dataclass(frozen=True)
class LearnerAccess:
    scope: MemoryScope
    actor: ActiveUser
    agent: dict
    mode: Literal["shadow", "authoritative"]


def memory_enabled() -> bool:
    from learner_memory.settings import get_memory_settings

    return get_memory_settings().enabled


def require_memory_enabled() -> None:
    if not memory_enabled():
        raise HTTPException(status_code=404, detail="Graph memory is not enabled")


def course_memory_mode(agent: dict) -> str:
    mode = agent.get("graph_memory_mode", "off")
    if mode not in {"off", "shadow", "authoritative"}:
        raise HTTPException(status_code=403, detail="Course memory configuration is invalid")
    return mode


def course_identity(agent: dict) -> MemoryIdentity:
    try:
        return MemoryIdentity.model_validate(agent.get("memory_scope"))
    except ValidationError:
        raise HTTPException(status_code=409, detail="A reviewed course memory scope is required") from None


def course_binding(agent: dict) -> CurriculumBinding:
    value = agent.get("curriculum_binding") or {}
    try:
        return CurriculumBinding.model_validate({
            "curriculum_id": value.get("curriculum_id"),
            "curriculum_version": value.get("curriculum_version"),
        })
    except (ValidationError, AttributeError):
        raise HTTPException(status_code=409, detail="A published curriculum binding is required") from None


def read_scope_registry(identity: MemoryIdentity) -> dict:
    from learner_memory.service import get_service

    record = get_service().read_scope_registry(identity.tenant_id, identity.institute_id)
    if (
        not isinstance(record, dict)
        or record.get("tenant_id") != identity.tenant_id
        or record.get("institute_id") != identity.institute_id
    ):
        raise HTTPException(status_code=403, detail="A reviewed memory scope registry is required")
    return record


def require_scope_administrator(user: ActiveUser, identity: MemoryIdentity) -> dict:
    if user.role not in {"admin", "superadmin"}:
        raise HTTPException(status_code=403, detail="Scoped administrator access required")
    registry = read_scope_registry(identity)
    administrators = registry.get("administrator_ids")
    if not isinstance(administrators, list) or user.id not in administrators:
        raise HTTPException(status_code=403, detail="Scoped administrator access required")
    return registry


def require_course_actor(
    agent: dict, user: ActiveUser, *, edit: bool = False, identity: MemoryIdentity | None = None
) -> None:
    record = AgentAccessRecord.model_validate(agent)
    if record.status != "active":
        raise HTTPException(status_code=403, detail="An active course is required")
    if user.role == "student":
        if edit:
            raise HTTPException(status_code=403, detail="Assigned teacher access required")
        if not _is_enrolled(record, user.id):
            raise HTTPException(status_code=403, detail="Explicit course enrollment required")
    elif user.role == "teacher":
        if user.id != record.created_by and user.id not in record.teachers:
            raise HTTPException(status_code=403, detail="Assigned teacher access required")
    else:
        require_scope_administrator(user, identity or course_identity(agent))


def _is_enrolled(record: AgentAccessRecord, student_id: str) -> bool:
    if student_id in record.students:
        return True
    if not record.students:
        return False
    return bool(set(agent_access.student_assignment_ids(student_id)).intersection(record.students))


def load_target_profile(student_id: str) -> dict | None:
    from azure_services.persistence.cosmos_db import read_learner_profile

    try:
        profile = read_learner_profile(student_id)
    except CosmosResourceNotFoundError:
        return None
    if not isinstance(profile, dict) or profile.get("id") != student_id:
        raise HTTPException(status_code=403, detail="Learner profile identity does not match")
    return profile


def load_roster_invitations(student_ids: list[str]) -> dict[str, dict]:
    if not student_ids:
        return {}
    from azure_services.persistence import cosmos_db

    cosmos_db.get_cosmos_client()
    invitations = {}
    for start in range(0, len(student_ids), 100):
        chunk = student_ids[start:start + 100]
        parameters = [{"name": f"@id{index}", "value": identity} for index, identity in enumerate(chunk)]
        query = (
            "SELECT c.id, c.role, c.status, c.oauthUserId FROM c WHERE c.id IN ("
            + ", ".join(parameter["name"] for parameter in parameters) + ")"
        )
        for invitation in cosmos_db._invited_users_container.query_items(
            query=query, parameters=parameters, enable_cross_partition_query=True,
        ):
            if invitation.get("id") not in chunk:
                raise HTTPException(status_code=403, detail="Invitation is outside the explicit course roster")
            invitations[invitation["id"]] = invitation
    return invitations


def resolve_learner_access(
    agent_id: str,
    student_id: str,
    user: ActiveUser,
    *,
    agent: dict | None = None,
    edit: bool = False,
) -> LearnerAccess:
    require_memory_enabled()
    # Reject an explicit cross-student target even before metadata/registry reads.
    if user.role == "student" and student_id != user.id:
        raise HTTPException(status_code=403, detail="Students may access only their own memory")
    if user.role == "student" and edit:
        raise HTTPException(status_code=403, detail="Assigned teacher access required")
    agent = agent if agent is not None else agent_access.load_agent(agent_id)
    if agent.get("id") != agent_id:
        raise HTTPException(status_code=403, detail="Course identity does not match")
    require_course_actor(agent, user, edit=edit)
    identity = course_identity(agent)
    mode = course_memory_mode(agent)
    if mode == "off":
        raise HTTPException(status_code=404, detail="Graph memory is not enabled for this course")
    binding = course_binding(agent)
    record = AgentAccessRecord.model_validate(agent)
    if user.role != "student" and not _is_enrolled(record, student_id):
        raise HTTPException(status_code=403, detail="The learner is not in the explicit course roster")
    if user.role != "student":
        profile = load_target_profile(student_id)
        if (
            not isinstance(profile, dict)
            or profile.get("id") != student_id
            or profile.get("status") != "active"
            or profile.get("role") != "student"
        ):
            raise HTTPException(status_code=403, detail="An active enrolled student is required")
    read_scope_registry(identity)
    from backend.schemas.learner_memory import MemoryScope

    scope = MemoryScope(
        tenant_id=identity.tenant_id,
        institute_id=identity.institute_id,
        course_id=agent_id,
        student_id=student_id,
        curriculum_id=binding.curriculum_id,
        curriculum_version=binding.curriculum_version,
    )
    from learner_memory.service import get_service

    scope = get_service().current_scope(scope)
    return LearnerAccess(scope=scope, actor=user, agent=agent, mode=mode)


def resolve_course_roster(agent_id: str, user: ActiveUser) -> list[LearnerAccess]:
    """Resolve active canonical roster IDs; chat activity never grants enrollment."""
    require_memory_enabled()
    if user.role == "student":
        raise HTTPException(status_code=403, detail="Assigned teacher access required")
    agent = agent_access.load_agent(agent_id)
    require_course_actor(agent, user, edit=True)
    if course_memory_mode(agent) == "off":
        raise HTTPException(status_code=404, detail="Graph memory is not enabled for this course")
    identity = course_identity(agent)
    course_binding(agent)
    read_scope_registry(identity)
    from learner_memory.settings import get_memory_settings

    roster = AgentAccessRecord.model_validate(agent).students
    if len(roster) > get_memory_settings().max_query_items:
        raise HTTPException(status_code=422, detail="Select a smaller authorized learner cohort")
    users = {student: load_target_profile(student) for student in roster}
    unresolved = [student for student, profile in users.items() if profile is None]
    invited = load_roster_invitations(unresolved)
    canonical: set[str] = set()
    for student in roster:
        profile = users.get(student)
        if profile and profile.get("role") == "student" and profile.get("status") == "active":
            canonical.add(student)
        else:
            invitation = invited.get(student) or {}
            if (
                invitation.get("role") == "student" and invitation.get("status") == "promoted"
                and isinstance(invitation.get("oauthUserId"), str)
            ):
                identity = invitation["oauthUserId"]
                promoted = load_target_profile(identity)
                if promoted and promoted.get("role") == "student" and promoted.get("status") == "active":
                    canonical.add(identity)
    return [resolve_learner_access(agent_id, student, user, agent=agent) for student in sorted(canonical)]
