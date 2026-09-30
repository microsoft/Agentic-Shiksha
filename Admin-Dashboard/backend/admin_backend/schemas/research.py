from typing import Optional

from pydantic import BaseModel


class InstituteResearchRequest(BaseModel):
    name: str
    instructions: Optional[str] = None


class DepartmentResearchRequest(BaseModel):
    institute: str
    department: str
    instructions: Optional[str] = None
