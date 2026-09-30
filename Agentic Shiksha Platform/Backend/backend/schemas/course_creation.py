from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, JsonValue
from backend.schemas.course_avatar import CourseAvatar


class CreationTextbook(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=500)
    edition: str = Field(default="", max_length=100)
    authors: list[str] = Field(default_factory=list, max_length=30)
    type: str = Field(default="primary", max_length=40)
    description: str = Field(default="", max_length=10000)


class CreationStarter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=500)
    prompt: str = Field(min_length=1, max_length=2000)


class CourseCreationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["learning", "exam", "course"] = "course"
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    courseName: str = Field(min_length=1, max_length=500)
    courseLevel: str | None = Field(default=None, max_length=200)
    courseDuration: str | None = Field(default=None, max_length=200)
    additionalContext: str | None = Field(default=None, max_length=160000)
    model: str | None = Field(default=None, max_length=160)
    createdById: str | None = Field(default=None, max_length=160)
    createdByName: str | None = Field(default=None, max_length=500)
    sessionUuid: str = Field(pattern=r"^[a-f0-9-]{36}$")
    kbScope: Literal["course", "exam", "textbook"] = "course"
    indexName: str | None = Field(default=None, max_length=160)
    agentImageUrl: str | None = Field(default=None, max_length=4096)
    agentAvatar: CourseAvatar | None = None
    customSearchInstanceName: str | None = Field(default=None, max_length=160)
    courseCode: str | None = Field(default=None, max_length=160)
    prerequisites: list[str] = Field(default_factory=list, max_length=100)
    courseUrls: list[str] = Field(default_factory=list, max_length=100)
    textbooks: list[CreationTextbook] = Field(default_factory=list, max_length=100)
    conversationStarters: list[CreationStarter] = Field(default_factory=list, max_length=15)
    departmentId: str | None = Field(default=None, max_length=160)


class CourseSpecification(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    description: str = Field(min_length=1, max_length=300)
    instructions: str = Field(min_length=20, max_length=120000)


class CreatedCourse(BaseModel):
    agent_id: str
    name: str
    description: str
    conversation_starters: list[CreationStarter] = Field(default_factory=list)
    index_name: str
    knowledge_attached: bool = True
    knowledge_pending: bool
    materials_job_id: str
    materials_status: str
    manage_code: str


class CourseCreationState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request: CourseCreationRequest
    input_digest: str
    status: Literal["PENDING", "RUNNING", "COMPLETED", "FAILED"] = "PENDING"
    progress: Literal["preparing", "creating", "saving", "created"] = "preparing"
    attempts: int = 0
    specification: CourseSpecification | None = None
    memory_store_name: str | None = None
    agent_create_started: bool = False
    agent_version: str | None = None
    manage_code: str
    error: str | None = None


class CourseCreationStatus(BaseModel):
    job_id: str
    status: Literal["NOT_STARTED", "PENDING", "RUNNING", "COMPLETED", "FAILED"]
    progress: Literal["not_started", "preparing", "creating", "saving", "created"]
    course_name: str | None = None
    materials_status: str
    error: str | None = None
    result: CreatedCourse | None = None


class CurriculumResearchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_name: str = Field(min_length=1, max_length=500)
    course_level: str = Field(default="", max_length=200)
    additional_context: str = Field(default="", max_length=160000)
    textbooks: list[CreationTextbook] = Field(default_factory=list, max_length=100)


class CurriculumResearchJob(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str = Field(pattern=r"^curriculum-[a-f0-9-]{36}$")
    job_type: Literal["course_curriculum"] = "course_curriculum"
    source_job_id: str | None = None
    owner_id: str
    inputs: CurriculumResearchInput | None = None
    agent_name: str
    mode: Literal["full", "threshold"] = "full"
    status: Literal["PENDING", "RUNNING", "COMPLETED", "FAILED"] = "PENDING"
    attempts: int = 0
    next_attempt_at: AwareDatetime
    lease_owner: str | None = None
    lease_until: AwareDatetime | None = None
    output_ref: str | None = None
    error: str | None = None
    revision: str | None = Field(default=None, alias="_etag", exclude=True)


CurriculumState = Literal["not_available", "processing", "ready", "failed"]


class CurriculumStatus(BaseModel):
    agent_name: str
    status: CurriculumState
    course_curriculum: dict[str, JsonValue] | None = None
    can_retry: bool = False
    message: str


class CurriculumRetryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CurriculumUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_curriculum: dict[str, JsonValue]
    commit_message: str = Field(default="", max_length=1000)
    user_id: str | None = None


class CurriculumUpdateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    message: str = "Curriculum updated successfully."
    version_id: str | None = None