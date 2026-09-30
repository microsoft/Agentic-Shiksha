from typing import Any, Dict

from admin_backend.core.contracts import DashboardRepository
from admin_backend.core.errors import InvalidOperation, ResourceNotFound


class AgentService:
    def __init__(self, queries: DashboardRepository) -> None:
        self.queries = queries

    def transfer_ownership(self, agent_id: str, payload: Dict[str, Any]):
        """
        Transfer agent ownership to another user.

        Request body:
            new_owner_id: The userId of the new owner
        """
        new_owner_id = (payload.get("new_owner_id") or "").strip()
        if not new_owner_id:
            raise InvalidOperation("new_owner_id is required")

        # Verify new owner exists — check C2 (active users) first, then C1 (invited)
        profile = self.queries.get_user_profile(new_owner_id)
        if not profile:
            profile = self.queries.get_invite_by_id(new_owner_id)
        if not profile:
            raise ResourceNotFound("New owner user not found")

        updated = self.queries.transfer_agent_ownership(agent_id, new_owner_id)
        if not updated:
            raise ResourceNotFound("Agent not found")

        return {
            "status": "ok",
            "agent_id": agent_id,
            "new_owner_id": new_owner_id,
            "new_owner_name": profile.get("displayName") or profile.get("fullName") or profile.get("name", ""),
        }

    def get_agent_teachers(self, agent_id: str):
        """Return the teachers currently assigned to a course."""
        agent = self.queries.get_agent_metadata(agent_id)
        if not agent:
            raise ResourceNotFound("Agent not found")

        teachers = []
        for tid in agent.get("teacherIds") or []:
            profile = self.queries.get_user_profile(tid) or self.queries.get_invite_by_id(tid) or {}
            teachers.append({
                "user_id": tid,
                "name": profile.get("displayName") or profile.get("fullName") or profile.get("name", ""),
                "email": profile.get("email", ""),
                "is_owner": tid == agent.get("createdById"),
            })

        return {"agent_id": agent_id, "owner_id": agent.get("createdById", ""), "teachers": teachers}

    def set_agent_teachers(self, agent_id: str, payload: Dict[str, Any]):
        """
        Replace the teachers assigned to a course.

        Request body:
            teacher_ids: List of userIds to assign as teachers
        """
        raw_ids = payload.get("teacher_ids")
        if not isinstance(raw_ids, list):
            raise InvalidOperation("teacher_ids must be a list")

        teacher_ids = [str(tid).strip() for tid in raw_ids if str(tid or "").strip()]
        for tid in teacher_ids:
            if not (self.queries.get_user_profile(tid) or self.queries.get_invite_by_id(tid)):
                raise ResourceNotFound(f"User not found: {tid}")

        updated = self.queries.set_agent_teachers(agent_id, teacher_ids)
        if not updated:
            raise ResourceNotFound("Agent not found")

        return {"status": "ok", "agent_id": agent_id, "teacher_ids": updated.get("teacherIds", [])}
