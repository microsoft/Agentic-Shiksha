from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from backend.schemas.course_avatar import CourseAvatar


UserId = Annotated[str, Field(min_length=1, max_length=256)]


class AgentAccessRecord(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    id: str = Field(min_length=1)
    created_by: str | None = Field(default=None, alias="createdById")
    teachers: list[str] = Field(default_factory=list, alias="teacherIds")
    students: list[str] = Field(default_factory=list, alias="studentIds")
    status: str = "active"


class StudentAssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)

    student_ids: list[UserId]
    revision: str = Field(min_length=1, max_length=256)

    @field_validator("student_ids")
    @classmethod
    def unique_students(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(values))


class StudentAssignmentResult(BaseModel):
    agent_id: str
    student_ids: list[str]
    revision: str


class AssignmentStudent(BaseModel):
    user_id: str
    name: str
    email: str
    institute: str
    department: str
    status: Literal["active", "invited", "unavailable"]


class StudentAssignmentDirectory(StudentAssignmentResult):
    students: list[AssignmentStudent]


class StudentDirectoryRecord(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    id: str = Field(min_length=1)
    role: Literal["student"]
    status: Literal["active", "invited", "promoted"]
    name: str = ""
    displayName: str = ""
    fullName: str = ""
    email: str = ""
    institute: str = ""
    department: str = ""
    oauthUserId: str | None = None


class AgentMemberPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)

    user_id: UserId
    member_type: Literal["teacher", "student"]


class AgentMembers(BaseModel):
    teacherIds: list[str]
    studentIds: list[str]


class AgentMemberChange(BaseModel):
    status: Literal["ok"] = "ok"
    agent_id: str
    added: str | None = None
    removed: str | None = None
    member_type: str | None = Field(default=None, serialization_alias="as")


class AgentCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    code: str = Field(pattern=r"^[A-Z0-9]{6}$")

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value: object) -> object:
        return value.strip().upper() if isinstance(value, str) else value


class AgentCodeResult(BaseModel):
    agent_id: str
    course_name: str
    agent_name: str
    already_joined: bool


class ConversationStarter(BaseModel):
    title: str = ""
    prompt: str


class AgentListItem(BaseModel):
    id: str
    name: str
    model: str = ""
    status: str = "active"
    description: str = ""
    created_by_id: str = ""
    created_by: str = ""
    institution: str = ""
    teacher_ids: list[str] = Field(default_factory=list)
    teachers: list[str] = Field(default_factory=list)
    course_name: str = ""
    course_code: str = ""
    course_level: str = ""
    agent_kind: str = "learning"
    conversation_starters: list[str | ConversationStarter] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    agentImageUrl: str = ""
    agentAvatar: CourseAvatar | None = None
    api_version: str = "current"
    department_id: str = ""
