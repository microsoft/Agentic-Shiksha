from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from admin_backend.dependencies import Services
from admin_backend.schemas.directory import InviteUserRequest, UpdateUserRequest, RenameInstituteRequest, DeleteInstituteRequest, RenameDepartmentRequest, DeleteDepartmentRequest, SwitchAffiliationRequest

router = APIRouter()


@router.get("/api/directory", tags=["Directory"])
def api_list_directory(role: Optional[str]=None, status: Optional[str]=None, *, services: Services):
    """List all users in the directory (invited + active). No auth required (Dashboard admin tool)."""
    return services.directory.list_users(role=role, status=status)


@router.post("/api/directory", tags=["Directory"])
def api_invite_user(body: InviteUserRequest, *, services: Services):
    """Invite (allowlist) a new user."""
    result, is_new_user = services.directory.invite_user(body)
    return JSONResponse(content=result, status_code=201 if is_new_user else 200)


@router.patch("/api/directory/{user_id}", tags=["Directory"])
def api_update_directory_user(user_id: str, body: UpdateUserRequest, *, services: Services):
    """Edit an existing user in the directory."""
    return services.directory.update_user(user_id, body)


@router.delete("/api/directory/{user_id}", tags=["Directory"])
def api_remove_directory_user(user_id: str, *, services: Services):
    """Remove a user from the directory."""
    return services.directory.remove_user(user_id)


@router.post("/api/directory/{user_id}/switch-affiliation", tags=["Directory"])
def api_switch_affiliation(user_id: str, body: SwitchAffiliationRequest, *, services: Services):
    """Switch the user's active affiliation."""
    updated = services.queries.switch_active_affiliation(user_id, body.index)
    if not updated:
        raise HTTPException(status_code=400, detail="Invalid affiliation index or user not found")
    return {
        "id": updated.get("id", ""), "userId": updated.get("userId", ""),
        "institute": updated.get("institute", ""), "department": updated.get("department", ""),
        "role": updated.get("role", ""), "affiliations": updated.get("affiliations", []),
        "activeAffiliation": updated.get("activeAffiliation", 0),
    }


@router.post("/api/directory/institutes/rename", tags=["Directory"])
def api_rename_institute(body: RenameInstituteRequest, *, services: Services):
    """Rename an institution across all user records."""
    if not body.old_name.strip() or not body.new_name.strip():
        raise HTTPException(status_code=400, detail="old_name and new_name are required")
    count = services.queries.rename_institute(body.old_name.strip(), body.new_name.strip())
    return {"status": "ok", "updated": count}


@router.post("/api/directory/institutes/delete", tags=["Directory"])
def api_delete_institute(body: DeleteInstituteRequest, *, services: Services):
    """Delete an institution — clears institute & department on affected users."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    count = services.queries.delete_institute(body.name.strip())
    return {"status": "ok", "cleared": count}


@router.post("/api/directory/departments/rename", tags=["Directory"])
def api_rename_department(body: RenameDepartmentRequest, *, services: Services):
    """Rename a department within an institution across all user records."""
    if not body.institute.strip() or not body.old_name.strip() or not body.new_name.strip():
        raise HTTPException(status_code=400, detail="institute, old_name and new_name are required")
    count = services.queries.rename_department(body.institute.strip(), body.old_name.strip(), body.new_name.strip())
    return {"status": "ok", "updated": count}


@router.post("/api/directory/departments/delete", tags=["Directory"])
def api_delete_department(body: DeleteDepartmentRequest, *, services: Services):
    """Delete a department — clears the department field on affected users."""
    if not body.institute.strip() or not body.department.strip():
        raise HTTPException(status_code=400, detail="institute and department are required")
    count = services.queries.delete_department_users(body.institute.strip(), body.department.strip())
    return {"status": "ok", "cleared": count}


@router.get("/api/directory/onboarding-progress", tags=["Directory"])
def api_onboarding_progress(institute: str, department: str, *, services: Services):
    """Return onboarding progress (invited vs active counts) for a department."""
    return services.queries.get_department_onboarding_progress(institute.strip(), department.strip())


@router.get("/api/user/{user_id}", tags=["Directory"])
def api_get_user_profile(user_id: str, *, services: Services):
    """Get a user profile by ID."""
    profile = services.queries.get_user_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "success": True,
        "profile": {
            "id": profile.get("id", ""),
            "userId": profile.get("userId", ""),
            "fullName": profile.get("fullName", ""),
            "displayName": profile.get("displayName", ""),
            "email": profile.get("email", ""),
            "role": profile.get("role", "student"),
            "status": profile.get("status", "active"),
            "institute": profile.get("institute", ""),
            "department": profile.get("department", ""),
            "affiliations": profile.get("affiliations", []),
            "activeAffiliation": profile.get("activeAffiliation", 0),
        },
    }
