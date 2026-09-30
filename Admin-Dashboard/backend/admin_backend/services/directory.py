from datetime import datetime
from typing import Optional

from admin_backend.core.contracts import DashboardRepository
from admin_backend.core.errors import ResourceNotFound
from admin_backend.schemas.directory import InviteUserRequest, UpdateUserRequest


class DirectoryService:
    def __init__(self, queries: DashboardRepository) -> None:
        self.queries = queries

    def list_users(self, role: Optional[str]=None, status: Optional[str]=None):
        """List all users in the directory (invited + active). No auth required (Dashboard admin tool)."""
        users = self.queries.list_directory_users(role=role, status=status)
        result = []
        for u in users:
            result.append({
                "id": u.get("id", ""),
                "userId": u.get("userId", ""),
                "name": u.get("displayName") or u.get("fullName", ""),
                "email": u.get("email", ""),
                "role": u.get("role", "student"),
                "status": u.get("status", "active"),
                "institute": u.get("institute", u.get("college", "")),
                "department": u.get("department", ""),
                "authProvider": u.get("authProvider", ""),
                "affiliations": u.get("affiliations", []),
                "activeAffiliation": u.get("activeAffiliation", 0),
            })
        return result

    def invite_user(self, body: InviteUserRequest):
        """Invite (allowlist) a new user."""
        doc, is_new_user, affiliation_added = self.queries.invite_user(
            email=body.email, name=body.name, role=body.role,
            institute=body.institute, department=body.department,
        )
        result = {
            "id": doc.get("id", ""), "userId": doc.get("userId", ""),
            "name": doc.get("displayName") or doc.get("fullName", ""),
            "email": doc.get("email", ""), "role": doc.get("role", "student"),
            "status": doc.get("status", "invited"), "institute": doc.get("institute", ""),
            "department": doc.get("department", ""), "affiliations": doc.get("affiliations", []),
            "affiliationAdded": affiliation_added,
            "alreadyExists": not is_new_user and not affiliation_added,
        }
        return result, is_new_user

    def update_user(self, user_id: str, body: UpdateUserRequest):
        """Edit an existing user in the directory."""
        target = self.queries.get_user_profile(user_id)
        target_in_c1 = False
        if not target:
            target = self.queries.get_invite_by_id(user_id)
            target_in_c1 = bool(target)
        if not target:
            raise ResourceNotFound("User not found")

        if target_in_c1:
            if body.name is not None: target["name"] = body.name
            if body.role is not None: target["role"] = body.role
            if body.institute is not None: target["institute"] = body.institute
            if body.department is not None: target["department"] = body.department
            # Keep affiliations in sync with top-level fields
            affs = target.get("affiliations", [])
            active_idx = target.get("activeAffiliation", 0)
            if affs and 0 <= active_idx < len(affs):
                if body.institute is not None: affs[active_idx]["institute"] = body.institute
                if body.department is not None: affs[active_idx]["department"] = body.department
                if body.role is not None: affs[active_idx]["role"] = body.role
                target["affiliations"] = affs
            target["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            self.queries.save_directory_record(target, invited=True)
            updated = target
            updated.setdefault("fullName", target.get("name", ""))
            updated.setdefault("displayName", target.get("name", ""))
        else:
            kwargs: dict = {}
            if body.name is not None:
                kwargs["fullName"] = body.name
                kwargs["displayName"] = body.name
            if body.role is not None:
                kwargs["role"] = body.role
            if body.institute is not None:
                kwargs["institute"] = body.institute
            if body.department is not None:
                kwargs["department"] = body.department
            updated = self.queries.upsert_user_profile(user_id, **kwargs)
            # Sync affiliations for C2 users too
            affs = updated.get("affiliations", [])
            active_idx = updated.get("activeAffiliation", 0)
            if affs and 0 <= active_idx < len(affs):
                changed = False
                if body.institute is not None:
                    affs[active_idx]["institute"] = body.institute
                    changed = True
                if body.department is not None:
                    affs[active_idx]["department"] = body.department
                    changed = True
                if body.role is not None:
                    affs[active_idx]["role"] = body.role
                    changed = True
                if changed:
                    updated["affiliations"] = affs
                    self.queries.save_directory_record(updated, invited=False)
        return {
            "id": updated.get("id", ""), "userId": updated.get("userId", ""),
            "name": updated.get("displayName") or updated.get("fullName", ""),
            "email": updated.get("email", ""), "role": updated.get("role", "student"),
            "status": updated.get("status", "active"),
            "institute": updated.get("institute", ""), "department": updated.get("department", ""),
        }

    def remove_user(self, user_id: str):
        """Remove a user from the directory."""
        # Check target exists
        target = self.queries.get_user_profile(user_id)
        if not target:
            target = self.queries.get_invite_by_id(user_id)

        if not target:
            raise ResourceNotFound("User not found")
        deleted = self.queries.remove_directory_user(user_id)
        if not deleted:
            raise ResourceNotFound("User not found")
        return {"status": "ok", "deleted": user_id}
