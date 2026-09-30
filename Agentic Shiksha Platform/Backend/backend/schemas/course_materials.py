from typing import Literal

from fastapi import UploadFile
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from backend.schemas.course_creation import CourseCreationState


MaterialScope = Literal["course", "exam", "textbook"]
IndexingState = Literal["indexing", "ready", "failed", "changed"]


class CourseAccessRecord(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    id: str = Field(min_length=1, max_length=160)
    revision: str = Field(alias="_etag", min_length=1)
    created_by: str | None = Field(default=None, alias="createdById")
    teachers: list[str] = Field(default_factory=list, alias="teacherIds")
    students: list[str] = Field(default_factory=list, alias="studentIds")


class CourseMaterialScope(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    session_uuid: str = Field(alias="sessionUuid", pattern=r"^[A-Za-z0-9-]{1,128}$")


class CourseIndexRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    agent_name: str = Field(min_length=1, max_length=160)
    session_uuid: str = Field(pattern=r"^[A-Za-z0-9-]{1,128}$")
    kb_scope: MaterialScope = "course"


class MaterialFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255, pattern=r"^[^/\\\x00-\x1f]+$")
    etag: str = Field(min_length=1, max_length=128)


class IndexingOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    session_uuid: str = Field(pattern=r"^[A-Za-z0-9-]{1,128}$")
    kb_scope: MaterialScope
    requested_at: AwareDatetime
    files: list[MaterialFile] = Field(max_length=500)
    state: IndexingState = "indexing"


class CourseIndexStatus(BaseModel):
    ok: bool
    operation_id: str
    status: IndexingState
    expected_files: int
    indexed_files: int = 0
    message: str


class IndexerExecution(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    status: str
    start_time: AwareDatetime | None = Field(default=None, alias="startTime")
    end_time: AwareDatetime | None = Field(default=None, alias="endTime")
    failed_items: int = Field(default=0, ge=0, alias="itemsFailed")
    errors: list[dict] = Field(default_factory=list)


class IndexedPassage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    content_id: str = Field(min_length=1, max_length=2048)
    document_title: str = Field(min_length=1, max_length=255)
    content_path: str = Field(min_length=1, max_length=4096)
    content_text: str = Field(min_length=1, max_length=100000)
    session_id: str
    file_category: MaterialScope
    page_number: int | None = Field(default=None, ge=1)
    logical_section: str | None = Field(default=None, max_length=1000)


class CourseMaterialSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["course_material"] = "course_material"
    citation_id: str = Field(pattern=r"^course-[a-f0-9]{24}$")
    title: str = Field(min_length=1, max_length=255)
    filename: str = Field(min_length=1, max_length=255)
    url: str = Field(max_length=2048)
    excerpt: str = Field(min_length=1, max_length=4000)
    page_number: int | None = Field(default=None, ge=1)
    section: str | None = Field(default=None, max_length=1000)
    truncated: bool = False


class MaterialPreflight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str
    stored_filename: str
    source_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    size_bytes: int = Field(gt=0)
    pages: int | None = None
    ocr_pages: int = 0
    needs_preparation: bool = False


class MaterialPreflightResult(BaseModel):
    filename: str
    accepted: bool
    details: MaterialPreflight | None = None
    error: str | None = None


class MaterialPreflightResponse(BaseModel):
    accepted: bool
    max_file_bytes: int
    max_batch_bytes: int
    max_files: int
    max_pdf_pages: int
    index_part_bytes: int
    index_part_pages: int
    extensions: list[str]
    files: list[MaterialPreflightResult] = Field(default_factory=list)


class MaterialPart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255, pattern=r"^[^/\\\x00-\x1f]+$")
    etag: str = Field(min_length=1)
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)


class MaterialJobFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: MaterialPreflight
    kb_scope: MaterialScope
    status: Literal["uploaded", "preparing", "indexing", "ready", "failed", "removed"] = "uploaded"
    operation: Literal["index", "remove"] = "index"
    parts: list[MaterialPart] = Field(default_factory=list, max_length=500)
    error: str | None = None
    attempts: int = Field(default=0, ge=0)
    generation: int = Field(default=0, ge=0)


class MaterialJob(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str = Field(pattern=r"^materials-[a-f0-9-]{36}$")
    job_type: Literal["course_materials"] = "course_materials"
    owner_id: str = Field(min_length=1, max_length=160)
    session_uuid: str = Field(pattern=r"^[a-f0-9-]{36}$")
    agent_name: str | None = Field(default=None, max_length=160)
    status: Literal["PENDING", "RUNNING", "COMPLETED", "FAILED"] = "PENDING"
    progress: Literal["uploading", "preparing", "indexing", "ready", "failed"] = "uploading"
    attempts: int = Field(default=0, ge=0)
    failures: int = Field(default=0, ge=0)
    files: list[MaterialJobFile] = Field(default_factory=list, max_length=500)
    created_at: AwareDatetime
    updated_at: AwareDatetime
    next_attempt_at: AwareDatetime
    index_requested_at: AwareDatetime | None = None
    index_started_at: AwareDatetime | None = None
    lease_owner: str | None = None
    lease_until: AwareDatetime | None = None
    output_ref: str | None = None
    creation: CourseCreationState | None = None
    revision: str | None = Field(default=None, alias="_etag", exclude=True)


class MaterialDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(pattern=r"^[a-f0-9-]{36}$")


class MaterialJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_ids: list[str] = Field(default_factory=list, max_length=500)


class MaterialFileStatus(BaseModel):
    source_id: str
    filename: str
    kb_scope: MaterialScope
    status: str
    parts: int
    error: str | None = None


class MaterialJobStatus(BaseModel):
    job_id: str
    session_uuid: str
    status: str
    progress: str
    files: list[MaterialFileStatus] = Field(default_factory=list)
    index_name: str
    files_uploaded: int = 0
    ta_status: str | None = None
    ta_error: str | None = None


class MaterialUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session: str = Field(pattern=r"^[a-f0-9-]{36}$")
    kb_scope: MaterialScope
    files: list[UploadFile] = Field(min_length=1, max_length=100)
    agent_name: str | None = Field(default=None, max_length=160)
    index_name: str | None = Field(default=None, max_length=160)
    file_descriptions: str | None = Field(default=None, max_length=50000)


class CourseFileItem(BaseModel):
    filename: str
    kind: str
    size: int
    download_url: str
    source_id: str | None = None


class CourseFileList(BaseModel):
    files: list[CourseFileItem] = Field(default_factory=list)