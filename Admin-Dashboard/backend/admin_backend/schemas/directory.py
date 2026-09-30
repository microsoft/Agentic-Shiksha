from typing import Optional

from pydantic import BaseModel


class InviteUserRequest(BaseModel):
    email: str
    name: str = ""
    role: str = "student"
    institute: str = ""
    department: str = ""


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    institute: Optional[str] = None
    department: Optional[str] = None


class RenameInstituteRequest(BaseModel):
    old_name: str
    new_name: str


class DeleteInstituteRequest(BaseModel):
    name: str


class RenameDepartmentRequest(BaseModel):
    institute: str
    old_name: str
    new_name: str


class DeleteDepartmentRequest(BaseModel):
    institute: str
    department: str


class SwitchAffiliationRequest(BaseModel):
    index: int
