"""Directory privacy, membership administration, and affiliation workflows."""

import random
from datetime import datetime
from typing import Any, Protocol

from backend.schemas.directory import InviteUserRequest, UpdateUserRequest
from backend.services.errors import AccessDenied, InvalidInput, MissingResource
from backend.services.identity import DirectoryCaller, IdentityService, Record


class DirectoryStore(Protocol):
    def list_directory_users(self, role: str | None, status: str | None) -> list[Record]: ...
    def invite_user(self, **values: Any) -> tuple[Record, bool, bool]: ...
    def find_target(self, user_id: str) -> tuple[Record | None, bool]: ...
    def save_invitation(self, target: Record) -> None: ...
    def upsert_user_profile(self, **values: Any) -> Record: ...
    def remove_directory_user(self, user_id: str) -> bool: ...
    def switch_active_affiliation(self, user_id: str, index: int) -> Record | None: ...
    def rename_institute(self, old_name: str, new_name: str) -> int: ...
    def delete_institute(self, name: str) -> int: ...
    def rename_department(self, institute: str, old_name: str, new_name: str) -> int: ...
    def delete_department(self, institute: str, department: str) -> int: ...
    def get_department_onboarding_progress(self, institute: str, department: str) -> Record: ...


class DirectoryService:
    def __init__(self, store: DirectoryStore, identity: IdentityService):
        self.store = store
        self.identity = identity

    def list_users(
        self, caller: DirectoryCaller, role: str | None = None, status: str | None = None
    ) -> list[Record]:
        users = self.store.list_directory_users(role=role, status=status)
        if caller.is_super:
            return [
                {
                    "id": user.get("id", ""),
                    "userId": user.get("userId", ""),
                    "name": user.get("displayName") or user.get("fullName", ""),
                    "email": user.get("email", ""),
                    "role": user.get("role", "student"),
                    "status": user.get("status", "active"),
                    "institute": user.get("institute", user.get("college", "")),
                    "department": user.get("department", ""),
                    "authProvider": user.get("authProvider", ""),
                    "affiliations": user.get("affiliations", []),
                    "activeAffiliation": user.get("activeAffiliation", 0),
                }
                for user in users
            ]

        admins, teachers, students = [], [], []
        for user in users:
            role = user.get("role", "student")
            if role == "admin":
                admins.append(user)
            elif role == "teacher":
                teachers.append(user)
            else:
                students.append(user)
        rng = random.Random(caller.email)
        rng.shuffle(teachers)
        rng.shuffle(students)

        def entry(user: Record, pseudonym: str | None = None) -> Record:
            is_self = (user.get("email") or "").lower() == caller.email
            real_name = user.get("displayName") or user.get("fullName", "")
            return {
                "id": user.get("id", ""),
                "userId": user.get("userId", ""),
                "name": real_name if (is_self or pseudonym is None) else pseudonym,
                "email": user.get("email", "") if (is_self or pseudonym is None) else "\u2014",
                "role": user.get("role", "student"),
                "status": user.get("status", "active"),
                "institute": user.get("institute", user.get("college", "")),
                "department": user.get("department", ""),
                "authProvider": user.get("authProvider", "") if is_self else "",
                "affiliations": user.get("affiliations", []) if is_self else [],
                "activeAffiliation": user.get("activeAffiliation", 0) if is_self else 0,
            }

        return (
            [entry(user) for user in admins]
            + [entry(user, f"Teacher {index}") for index, user in enumerate(teachers, start=1)]
            + [entry(user, f"Student {index}") for index, user in enumerate(students, start=1)]
        )

    def invite(self, body: InviteUserRequest) -> tuple[Record, bool]:
        doc, is_new_user, affiliation_added = self.store.invite_user(**body.model_dump())
        return {
            "id": doc.get("id", ""),
            "userId": doc.get("userId", ""),
            "name": doc.get("displayName") or doc.get("fullName", ""),
            "email": doc.get("email", ""),
            "role": doc.get("role", "student"),
            "status": doc.get("status", "invited"),
            "institute": doc.get("institute", ""),
            "department": doc.get("department", ""),
            "affiliations": doc.get("affiliations", []),
            "affiliationAdded": affiliation_added,
            "alreadyExists": not is_new_user and not affiliation_added,
        }, is_new_user

    def update(self, user_id: str, body: UpdateUserRequest, caller: DirectoryCaller) -> Record:
        if body.role and body.role.lower() == "admin" and not caller.is_super:
            raise AccessDenied("Only the super-admin can grant the admin role")
        target, invited = self.store.find_target(user_id)
        if not target:
            raise MissingResource("User not found")
        if invited:
            for field in ("name", "role", "institute", "department"):
                value = getattr(body, field)
                if value:
                    target[field] = value
            target["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            self.store.save_invitation(target)
            updated = target
            updated.setdefault("fullName", target.get("name", ""))
            updated.setdefault("displayName", target.get("name", ""))
        else:
            updated = self.store.upsert_user_profile(
                user_id=user_id,
                full_name=body.name or "",
                display_name=body.name or "",
                role=body.role or "",
                institute=body.institute or "",
                department=body.department or "",
            )
        return {
            "id": updated.get("id", ""),
            "userId": updated.get("userId", ""),
            "name": updated.get("displayName") or updated.get("fullName", ""),
            "email": updated.get("email", ""),
            "role": updated.get("role", "student"),
            "status": updated.get("status", "active"),
            "institute": updated.get("institute", ""),
            "department": updated.get("department", ""),
        }

    def remove(self, user_id: str, caller: DirectoryCaller) -> Record:
        target, _invited = self.store.find_target(user_id)
        if not target:
            raise MissingResource("User not found")
        if (target.get("email") or "").lower() == self.identity.super_admin_email.lower():
            raise AccessDenied("The super-admin account cannot be removed")
        if (target.get("role") or "student") == "admin" and not caller.is_super:
            raise AccessDenied("Only the super-admin can remove other admins")
        if caller.role != "admin" and not caller.is_super:
            raise AccessDenied("Only admins can remove users")
        if not self.store.remove_directory_user(user_id):
            raise MissingResource("User not found")
        return {"status": "ok", "deleted": user_id}

    def switch_affiliation(self, user_id: str, index: int, claims: Record) -> Record:
        email = (claims.get("email") or "").lower()
        is_super = email == self.identity.super_admin_email.lower()
        caller_user = self.identity.directory.get_user_by_email(email)
        caller_id = (caller_user or {}).get("id", "")
        if caller_id != user_id and not is_super:
            raise AccessDenied("You can only switch your own affiliation")
        updated = self.store.switch_active_affiliation(user_id, index)
        if not updated:
            raise InvalidInput("Invalid affiliation index or user not found")
        return {
            "id": updated.get("id", ""),
            "userId": updated.get("userId", ""),
            "institute": updated.get("institute", ""),
            "department": updated.get("department", ""),
            "role": updated.get("role", ""),
            "affiliations": updated.get("affiliations", []),
            "activeAffiliation": updated.get("activeAffiliation", 0),
        }

    def rename_institute(self, old_name: str, new_name: str) -> Record:
        if not old_name.strip() or not new_name.strip():
            raise InvalidInput("old_name and new_name are required")
        count = self.store.rename_institute(old_name.strip(), new_name.strip())
        return {"status": "ok", "updated": count}

    def delete_institute(self, name: str) -> Record:
        if not name.strip():
            raise InvalidInput("name is required")
        return {"status": "ok", "cleared": self.store.delete_institute(name.strip())}

    def rename_department(self, institute: str, old_name: str, new_name: str) -> Record:
        if not institute.strip() or not old_name.strip() or not new_name.strip():
            raise InvalidInput("institute, old_name and new_name are required")
        count = self.store.rename_department(institute.strip(), old_name.strip(), new_name.strip())
        return {"status": "ok", "updated": count}

    def delete_department(self, institute: str, department: str) -> Record:
        if not institute.strip() or not department.strip():
            raise InvalidInput("institute and department are required")
        count = self.store.delete_department(institute.strip(), department.strip())
        return {"status": "ok", "cleared": count}

    def onboarding_progress(self, institute: str, department: str) -> Record:
        return self.store.get_department_onboarding_progress(institute.strip(), department.strip())
