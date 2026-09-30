import re
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator


MAX_COURSE_NOTES_LENGTH = 100_000
MAX_FORM_CONTEXT_LENGTH = 160_000
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]


class FormModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)


class CourseLink(FormModel):
    url: str = Field(min_length=1, max_length=2000)
    description: str = Field(default="", max_length=1000)

    @field_validator("url")
    @classmethod
    def valid_web_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Course links must be HTTP or HTTPS URLs without credentials")
        return value


class FormTextbook(FormModel):
    name: ShortText
    edition: str = Field(default="", max_length=100)
    authors: list[ShortText] = Field(default_factory=list, max_length=12)
    type: Literal["primary", "reference"]
    description: str = Field(default="", max_length=2000)


class FormStarter(FormModel):
    title: str = Field(min_length=1, max_length=300)
    prompt: str = Field(min_length=1, max_length=1000)


class AvailableCourse(FormModel):
    id: ShortText
    name: ShortText


class CourseFormDraft(FormModel):
    courseName: str = Field(default="", max_length=300)
    courseLevel: str = Field(default="", max_length=100)
    courseSpan: str = Field(default="", max_length=100)
    courseNotes: str = Field(default="", max_length=MAX_COURSE_NOTES_LENGTH)
    courseCode: str = Field(default="", max_length=100)
    prerequisites: list[ShortText] = Field(default_factory=list, max_length=30)
    courseUrls: list[CourseLink] = Field(default_factory=list, max_length=20)
    textbooks: list[FormTextbook] = Field(default_factory=list, max_length=20)
    conversationStarters: list[FormStarter] = Field(default_factory=list, max_length=8)


class CourseFormTurn(FormModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=2000)


class CourseFormAttachment(FormModel):
    name: str = Field(min_length=1, max_length=255, pattern=r"^[^/\\\x00-\x1f]+$")
    contentType: Literal["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg", "image/webp"]
    data: str = Field(min_length=1, max_length=2796204, repr=False)


class CourseFormRequest(FormModel):
    text: str = Field(min_length=1, max_length=16000)
    form: CourseFormDraft
    availablePrerequisites: list[AvailableCourse] = Field(default_factory=list, max_length=100)
    history: list[CourseFormTurn] = Field(default_factory=list, max_length=6)
    allowEdits: bool = True
    attachments: list[CourseFormAttachment] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def limit_request_size(self):
        if len(self.model_dump_json(exclude={"attachments"})) > MAX_FORM_CONTEXT_LENGTH:
            raise ValueError("Course form context is too large")
        return self


class CourseFormFields(FormModel):
    courseName: ShortText | None
    courseLevel: Annotated[str, StringConstraints(min_length=1, max_length=100)] | None
    courseSpan: Annotated[str, StringConstraints(min_length=1, max_length=100)] | None
    courseNotes: Description | None
    courseCode: Annotated[str, StringConstraints(min_length=1, max_length=100)] | None
    prerequisites: Annotated[list[ShortText], Field(max_length=30)] | None
    courseUrls: Annotated[list[CourseLink], Field(max_length=20)] | None
    textbooks: Annotated[list[FormTextbook], Field(max_length=20)] | None
    conversationStarters: Annotated[list[FormStarter], Field(max_length=8)] | None

    @field_validator("courseSpan")
    @classmethod
    def canonical_duration(cls, value: str | None) -> str | None:
        if value is None:
            return None
        match = re.fullmatch(r"([1-9]\d{0,2})\s+(week|month|trimester|semester|year)(?:s|\(s\))?", value, re.IGNORECASE)
        if not match:
            raise ValueError("Duration must be a positive whole number of supported units")
        amount = int(match[1])
        unit = match[2].capitalize()
        return f"{amount} {unit}{'s' if amount != 1 else ''}"

    @field_validator("courseLevel")
    @classmethod
    def valid_level(cls, value: str | None) -> str | None:
        if value and value.startswith("__"):
            raise ValueError("Select a real course level, not a form placeholder")
        return value

    @field_validator("prerequisites")
    @classmethod
    def exclusive_none(cls, value: list[str] | None) -> list[str] | None:
        if value and "__none__" in value and len(value) != 1:
            raise ValueError("No prerequisites cannot be combined with prerequisite courses")
        return value


class CourseFormResult(FormModel):
    message: str = Field(min_length=1, max_length=1500)
    fields: CourseFormFields


def validate_form_result(payload: str, request: CourseFormRequest) -> CourseFormResult:
    result = CourseFormResult.model_validate_json(payload)
    if not request.allowEdits:
        return result.model_copy(update={"fields": CourseFormFields.model_validate(dict.fromkeys(CourseFormFields.model_fields))})
    allowed = {course.id for course in request.availablePrerequisites} | {"__none__"}
    if any(course not in allowed for course in result.fields.prerequisites or []):
        raise ValueError("A prerequisite did not match an available course")
    return result


def form_output_schema() -> dict:
    schema = CourseFormResult.model_json_schema()

    def require_properties(node: object) -> None:
        if isinstance(node, dict):
            node.pop("default", None)
            if node.get("type") == "object":
                node["required"] = list(node.get("properties", {}))
                node["additionalProperties"] = False
            for value in node.values():
                require_properties(value)
        elif isinstance(node, list):
            for value in node:
                require_properties(value)

    require_properties(schema)
    return schema