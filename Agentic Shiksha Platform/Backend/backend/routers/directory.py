"""Directory HTTP contracts; workflow and persistence live below the router."""

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.dependencies.service_errors import service_errors
from backend.dependencies.session import get_session_token
from backend.schemas.directory import (
    DeleteDepartmentRequest,
    DeleteInstituteRequest,
    InviteUserRequest,
    RenameDepartmentRequest,
    RenameInstituteRequest,
    SwitchAffiliationRequest,
    UpdateUserRequest,
)
from backend.services.directory import DirectoryService


def create_directory_router(service: DirectoryService) -> APIRouter:
    router = APIRouter()
    identity = service.identity

    @router.get("/api/directory", tags=["directory"])
    def api_list_directory(role: Optional[str] = None, status: Optional[str] = None, request: Request = None):
        """List all users in the directory (invited + active)."""
        with service_errors():
            caller = identity.resolve_caller(get_session_token(request) if request is not None else None)
            return service.list_users(caller, role=role, status=status)

    @router.post("/api/directory", tags=["directory"])
    def api_invite_user(body: InviteUserRequest, request: Request):
        """Invite (allowlist) a new user. They won't be able to login until added here."""
        with service_errors():
            identity.require_directory_admin(get_session_token(request))
            result, created = service.invite(body)
            return JSONResponse(content=result, status_code=201 if created else 200)

    @router.patch("/api/directory/{user_id}", tags=["directory"])
    def api_update_directory_user(user_id: str, body: UpdateUserRequest, request: Request):
        """Edit an existing user in the directory (name, role, institute, department)."""
        with service_errors():
            caller = identity.require_directory_admin(get_session_token(request))
            return service.update(user_id, body, caller)

    @router.delete("/api/directory/{user_id}", tags=["directory"])
    def api_remove_directory_user(user_id: str, request: Request):
        """Remove a user from the directory."""
        with service_errors():
            caller = identity.require_directory_admin(get_session_token(request))
            return service.remove(user_id, caller)

    @router.post("/api/directory/{user_id}/switch-affiliation", tags=["directory"])
    def api_switch_affiliation(user_id: str, body: SwitchAffiliationRequest, request: Request):
        """Switch the user's active affiliation. Users can switch their own; super-admin can switch anyone."""
        with service_errors():
            claims = identity.session_claims(get_session_token(request))
            return service.switch_affiliation(user_id, body.index, claims)

    @router.post("/api/directory/institutes/rename", tags=["directory"])
    def api_rename_institute(body: RenameInstituteRequest, request: Request):
        """Rename an institution across all user records."""
        with service_errors():
            identity.require_super_admin(get_session_token(request))
            return service.rename_institute(body.old_name, body.new_name)

    @router.post("/api/directory/institutes/delete", tags=["directory"])
    def api_delete_institute(body: DeleteInstituteRequest, request: Request):
        """Delete an institution — clears institute & department on affected users."""
        with service_errors():
            identity.require_super_admin(get_session_token(request))
            return service.delete_institute(body.name)

    @router.post("/api/directory/departments/rename", tags=["directory"])
    def api_rename_department(body: RenameDepartmentRequest, request: Request):
        """Rename a department within an institution across all user records."""
        with service_errors():
            identity.require_super_admin(get_session_token(request))
            return service.rename_department(body.institute, body.old_name, body.new_name)

    @router.post("/api/directory/departments/delete", tags=["directory"])
    def api_delete_department(body: DeleteDepartmentRequest, request: Request):
        """Delete a department — clears the department field on affected users."""
        with service_errors():
            identity.require_super_admin(get_session_token(request))
            return service.delete_department(body.institute, body.department)

    @router.get("/api/directory/onboarding-progress", tags=["directory"])
    def api_onboarding_progress(institute: str, department: str, request: Request):
        """Return onboarding progress (invited vs active counts) for a department."""
        with service_errors():
            identity.require_super_admin(get_session_token(request))
            return service.onboarding_progress(institute, department)

    return router
