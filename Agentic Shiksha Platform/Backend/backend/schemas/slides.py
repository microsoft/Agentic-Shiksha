from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator


def xml_text(value: str) -> str:
    if any(
        (ord(char) < 32 and char not in "\t\n\r")
        or 0xD800 <= ord(char) <= 0xDFFF
        or ord(char) in {0xFFFE, 0xFFFF}
        for char in value
    ):
        raise ValueError("Slide text contains unsupported control characters")
    return value


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120), AfterValidator(xml_text)]
Subtitle = Annotated[str, StringConstraints(strip_whitespace=True, max_length=180), AfterValidator(xml_text)]
Bullet = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160), AfterValidator(xml_text)]
ColumnBullet = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=140), AfterValidator(xml_text)]


class SlideSource(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: Title
    url: str | None = Field(default=None, max_length=2048)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str | None) -> str | None:
        if value is not None:
            parsed = urlsplit(value)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or any(char.isspace() or ord(char) < 32 for char in value)
                or "\\" in value
            ):
                raise ValueError("Sources require an HTTP(S) URL without credentials")
            xml_text(value)
        return value


class SlideColumn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    heading: Annotated[str, StringConstraints(min_length=1, max_length=60), AfterValidator(xml_text)]
    bullets: list[ColumnBullet] = Field(min_length=1, max_length=4)


class SlideComponentNote(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: Literal[
        "title", "subtitle",
        "bullet-1", "bullet-2", "bullet-3", "bullet-4", "bullet-5",
        "column-1", "column-2",
        "column-1-bullet-1", "column-1-bullet-2", "column-1-bullet-3", "column-1-bullet-4",
        "column-2-bullet-1", "column-2-bullet-2", "column-2-bullet-3", "column-2-bullet-4",
    ]
    text: Annotated[str, StringConstraints(min_length=1, max_length=1200), AfterValidator(xml_text)]

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Component notes require nonblank text")
        return value


class SlideSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    layout: Literal["title", "section", "content", "two_column", "question", "summary", "process", "timeline", "quote", "key_stat"]
    title: Title
    subtitle: Subtitle = ""
    bullets: list[Bullet] = Field(default_factory=list, max_length=5)
    columns: list[SlideColumn] = Field(default_factory=list, max_length=2)
    speaker_notes: Annotated[str, StringConstraints(strip_whitespace=False, max_length=4000), AfterValidator(xml_text)] = ""
    component_notes: list[SlideComponentNote] = Field(default_factory=list, max_length=12)
    sources: list[SlideSource] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_layout(self) -> "SlideSpec":
        if self.layout == "two_column":
            if len(self.columns) != 2 or self.bullets:
                raise ValueError("Two-column slides require exactly two columns and no top-level bullets")
        elif self.columns:
            raise ValueError("Only two-column slides may contain columns")
        elif self.layout in {"title", "section"}:
            if self.bullets:
                raise ValueError("Title and section slides use a subtitle, not bullets")
        elif self.layout in {"process", "timeline"}:
            if not 2 <= len(self.bullets) <= 5:
                raise ValueError("Process and timeline slides require two to five step or event captions")
        elif self.layout in {"quote", "key_stat"}:
            if len(self.bullets) != 1:
                raise ValueError("Quote and key-statistic slides require exactly one bullet")
            if self.layout == "key_stat" and len(self.bullets[0]) > 40:
                raise ValueError("A key statistic must contain at most 40 Unicode code points")
        elif not self.bullets:
            raise ValueError("Content, question and summary slides require at least one bullet")
        return self

    @model_validator(mode="after")
    def validate_component_notes(self) -> "SlideSpec":
        targets = {"title"}
        if self.subtitle:
            targets.add("subtitle")
        targets.update(f"bullet-{index}" for index in range(1, len(self.bullets) + 1))
        for column_index, column in enumerate(self.columns, start=1):
            targets.add(f"column-{column_index}")
            targets.update(
                f"column-{column_index}-bullet-{index}" for index in range(1, len(column.bullets) + 1)
            )
        seen = set()
        for note in self.component_notes:
            if note.target in seen:
                raise ValueError("Component note targets must be unique")
            if note.target not in targets:
                raise ValueError("Component notes must target existing slide components")
            seen.add(note.target)
        if len(self.speaker_notes) + sum(len(note.text) for note in self.component_notes) > 8000:
            raise ValueError("Slide speaker and component notes must total at most 8000 Unicode code points")
        return self


class SlideDeck(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: Title
    subtitle: Subtitle = ""
    theme: Literal["academic", "midnight", "warm"] = "academic"
    slides: list[SlideSpec] = Field(min_length=1, max_length=20)


class SlidesBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["slides"] = "slides"
    slidesId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,160}$")
    title: Title
    deck: SlideDeck

    @model_validator(mode="after")
    def validate_title(self) -> "SlidesBlock":
        if self.title != self.deck.title:
            raise ValueError("Presentation title must match its deck")
        return self


class SlidesExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deck: SlideDeck


class SlidesSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deck: SlideDeck


class SlidesSaveResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assetId: str = Field(min_length=1, pattern=r"^\S+$")
    block: SlidesBlock


class SlidesToolStatus(BaseModel):
    enabled: bool
    agent_version: str
    update_available: bool = False


class EnableSlidesToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: str = Field(pattern=r"^[A-Za-z0-9._-]{1,64}$")


SlideSpeechVoiceId = Literal[
    "en-IN-NeerjaNeural", "en-IN-PrabhatNeural", "hi-IN-SwaraNeural", "hi-IN-MadhurNeural",
]


class SlideSpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Annotated[
        str, StringConstraints(strict=True, min_length=1, max_length=1200), AfterValidator(xml_text),
    ]
    voice: SlideSpeechVoiceId

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Speech requires nonblank text")
        return value


class SlideSpeechVoice(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: SlideSpeechVoiceId
    name: str
    language: Literal["en-IN", "hi-IN"]


class SlideSpeechVoicesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    available: bool
    voices: list[SlideSpeechVoice] = Field(default_factory=list)
    detail: str | None = None
