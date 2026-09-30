"""Adapter for the existing active-user and invitation persistence helpers."""

import logging
from typing import Any


logger = logging.getLogger(__name__)
Record = dict[str, Any]


class CosmosDirectoryRepository:
    def __init__(self):
        from azure_services.persistence import cosmos_db

        self._store = cosmos_db

    def get_invite_by_email(self, email: str) -> Record | None:
        return self._store.get_invite_by_email(email)

    def get_user_by_email(self, email: str) -> Record | None:
        return self._store.get_user_by_email(email)

    def promote_invited_user(
        self, email: str, user_id: str, *, auth_provider: str, display_name: str
    ) -> Record | None:
        return self._store.promote_invited_user(
            email, user_id, auth_provider=auth_provider, display_name=display_name
        )

    def list_directory_users(self, role: str | None, status: str | None) -> list[Record]:
        return self._store.list_directory_users(role=role, status=status)

    def invite_user(self, **values: Any) -> tuple[Record, bool, bool]:
        return self._store.invite_user(**values)

    def find_target(self, user_id: str) -> tuple[Record | None, bool]:
        target = self._store.get_user_profile(user_id)
        if target:
            return target, False
        self._store.get_cosmos_client()
        try:
            hits = list(self._store._invited_users_container.query_items(
                query="SELECT * FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": user_id}],
                enable_cross_partition_query=True,
            ))
        except Exception:
            # Legacy directory endpoints map a failed invitation lookup to 404.
            logger.exception("Unable to look up a directory invitation")
            return None, False
        target = hits[0] if hits else None
        return target, bool(target)

    def save_invitation(self, target: Record) -> None:
        self._store._invited_users_container.upsert_item(body=target)

    def upsert_user_profile(self, **values: Any) -> Record:
        return self._store.upsert_user_profile(**values)

    def remove_directory_user(self, user_id: str) -> bool:
        return self._store.remove_directory_user(user_id)

    def switch_active_affiliation(self, user_id: str, index: int) -> Record | None:
        return self._store.switch_active_affiliation(user_id, index)

    def rename_institute(self, old_name: str, new_name: str) -> int:
        return self._store.rename_institute(old_name, new_name)

    def delete_institute(self, name: str) -> int:
        return self._store.delete_institute(name)

    def rename_department(self, institute: str, old_name: str, new_name: str) -> int:
        return self._store.rename_department(institute, old_name, new_name)

    def delete_department(self, institute: str, department: str) -> int:
        return self._store.delete_department(institute, department)

    def get_department_onboarding_progress(self, institute: str, department: str) -> Record:
        return self._store.get_department_onboarding_progress(institute, department)
