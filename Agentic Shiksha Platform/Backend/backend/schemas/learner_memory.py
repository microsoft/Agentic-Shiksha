"""Versioned learner-memory contracts; confidence scores are not probabilities."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import (
    AliasChoices,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)

Identifier = Annotated[StrictStr, Field(min_length=1, max_length=256, pattern=r"^[^\s\x00-\x1f\x7f][^\x00-\x1f\x7f]*$")]
Score = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
PositiveScore = Annotated[float, Field(gt=0, le=1, allow_inf_nan=False)]
Answer = StrictStr | dict[Identifier, StrictStr] | None


def opaque_key(namespace: str, *parts: str) -> str:
    encoded = json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode()
    return f"{namespace}_{hashlib.sha256(encoded).hexdigest()}"


class MemoryModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class ImmutableMemoryModel(MemoryModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class NodeType(StrEnum):
    COURSE = "COURSE"
    TC = "TC"
    MISCONCEPTION = "MISCONCEPTION"
    CONCEPT_INVENTORY = "CONCEPT_INVENTORY"
    PROBLEM = "PROBLEM"
    CURRICULUM_VERSION = "CURRICULUM_VERSION"


class EdgeRelation(StrEnum):
    HAS_THRESHOLD = "HAS_THRESHOLD"
    PREREQUISITE_OF = "PREREQUISITE_OF"
    ASSOCIATED_WITH = "ASSOCIATED_WITH"
    ASSESSED_BY = "ASSESSED_BY"
    CONTAINS = "CONTAINS"
    HAS_PROBLEM = "HAS_PROBLEM"
    TESTS = "TESTS"
    DIAGNOSES = "DIAGNOSES"
    HAS_TRANSFER_PROBE = "HAS_TRANSFER_PROBE"


class ThresholdRelevance(StrEnum):
    BLOCKING = "BLOCKING"
    SIGNIFICANT = "SIGNIFICANT"
    PERIPHERAL = "PERIPHERAL"


class MisconceptionStatus(StrEnum):
    NOT_ASSESSED = "NOT_ASSESSED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    SUSPECTED = "SUSPECTED"
    PRESENT = "PRESENT"
    RESOLVING = "RESOLVING"
    CLEARED = "CLEARED"


class ConceptStatus(StrEnum):
    NOT_ATTEMPTED = "NOT_ATTEMPTED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    STRUGGLING = "STRUGGLING"
    PROGRESSING = "PROGRESSING"
    MASTERED = "MASTERED"


class ThresholdStatus(StrEnum):
    NOT_CROSSED = "NOT_CROSSED"
    CANDIDATE = "CANDIDATE"
    CROSSED = "CROSSED"


class TransferStatus(StrEnum):
    NOT_ATTEMPTED = "NOT_ATTEMPTED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    FAIL = "FAIL"
    PASS = "PASS"


class Trend(StrEnum):
    UNKNOWN = "UNKNOWN"
    IMPROVING = "IMPROVING"
    STABLE = "STABLE"
    DECLINING = "DECLINING"


class EvidenceSource(StrEnum):
    LEARNER_CHAT = "LEARNER_CHAT"
    DIAGNOSTIC_RESPONSE = "DIAGNOSTIC_RESPONSE"
    QUIZ_RESPONSE = "QUIZ_RESPONSE"
    TRANSFER_RESPONSE = "TRANSFER_RESPONSE"
    TEACHER_ASSESSMENT = "TEACHER_ASSESSMENT"
    TEACHING_EXPOSURE = "TEACHING_EXPOSURE"
    PROGRESS_PROPOSAL = "PROGRESS_PROPOSAL"
    EXPLICIT_SELECTION = "EXPLICIT_SELECTION"
    LEGACY_IMPORT = "LEGACY_IMPORT"
    SYSTEM_REVALIDATION = "SYSTEM_REVALIDATION"
    SIMULATION_RESULT = "SIMULATION_RESULT"
    ASSIGNMENT_RESPONSE = "ASSIGNMENT_RESPONSE"
    REFLECTION = "REFLECTION"


class EventType(StrEnum):
    LEARNER_MESSAGE = "LEARNER_MESSAGE"
    ASSESSMENT_RESPONSE = "ASSESSMENT_RESPONSE"
    DIAGNOSTIC_RESPONSE = "DIAGNOSTIC_RESPONSE"
    TRANSFER_RESPONSE = "TRANSFER_RESPONSE"
    QUIZ_SUBMISSION = "QUIZ_SUBMISSION"
    EXPOSURE = "EXPOSURE"
    ENGAGEMENT = "ENGAGEMENT"
    PROGRESS_PROPOSAL = "PROGRESS_PROPOSAL"
    SELECTION = "SELECTION"
    REVALIDATION = "REVALIDATION"
    RESET = "RESET"
    RECOMPUTE = "RECOMPUTE"
    ARTIFACT_SUBMISSION = "ARTIFACT_SUBMISSION"
    TEACHER_EVIDENCE = "TEACHER_EVIDENCE"


class Assistance(StrEnum):
    UNKNOWN = "UNKNOWN"
    NO_RECORDED_HINT = "NO_RECORDED_HINT"
    HINT_USED = "HINT_USED"
    ASSISTED = "ASSISTED"
    ANSWER_REVEALED = "ANSWER_REVEALED"


class AnswerKeySource(StrEnum):
    NONE = "NONE"
    SERVER_FROZEN_ASSESSMENT = "SERVER_FROZEN_ASSESSMENT"
    CATALOG_REVIEWED_RUBRIC = "CATALOG_REVIEWED_RUBRIC"
    TEACHER_REVIEWED = "TEACHER_REVIEWED"


class ReasoningResult(StrEnum):
    UNAVAILABLE = "UNAVAILABLE"
    AMBIGUOUS = "AMBIGUOUS"
    SATISFIES_RUBRIC = "SATISFIES_RUBRIC"
    DOES_NOT_SATISFY_RUBRIC = "DOES_NOT_SATISFY_RUBRIC"


class EvidencePolarity(StrEnum):
    NO_INFERENCE = "NO_INFERENCE"
    SUPPORTS = "SUPPORTS"
    CONTRADICTS = "CONTRADICTS"


class DemonstrationResult(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    AMBIGUOUS = "AMBIGUOUS"


class PublicationStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"


class TaskType(StrEnum):
    MULTIPLE_CHOICE = "MULTIPLE_CHOICE"
    SHORT_ANSWER = "SHORT_ANSWER"
    WORKED_PROBLEM = "WORKED_PROBLEM"
    TRANSFER = "TRANSFER"


class ProcessingStatus(StrEnum):
    ACCEPTED = "ACCEPTED"
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    RETRY_PENDING = "RETRY_PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REJECTED = "REJECTED"
    SUPERSEDED = "SUPERSEDED"


class ProcessingStage(StrEnum):
    INTAKE = "INTAKE"
    EVIDENCE = "EVIDENCE"
    EXTRACTION = "EXTRACTION"
    REDUCTION = "REDUCTION"
    PUBLICATION = "PUBLICATION"
    COMPLETED = "COMPLETED"


class MemoryScope(ImmutableMemoryModel):
    tenant_id: Identifier
    institute_id: Identifier
    course_id: Identifier
    student_id: Identifier
    curriculum_id: Identifier
    curriculum_version: Identifier
    learning_epoch: Annotated[StrictInt, Field(ge=1)] = 1

    @field_validator(
        "tenant_id", "institute_id", "course_id", "student_id",
        "curriculum_id", "curriculum_version",
    )
    @classmethod
    def nonblank_identity(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Scope identifiers must not be blank")
        return value

    @property
    def partition_key(self) -> str:
        return opaque_key(
            "lm", self.tenant_id, self.institute_id, self.course_id, self.student_id
        )

    @property
    def graph_key(self) -> str:
        return opaque_key("cg", self.tenant_id, self.curriculum_id, self.curriculum_version)


class PolicySet(ImmutableMemoryModel):
    """Safe example operating rules. Teacher review is required for crossing."""

    version: Identifier = "example-uncalibrated-v1"
    misconception_policy_version: Identifier = "misconception-example-v1"
    concept_policy_version: Identifier = "concept-example-v1"
    threshold_policy_version: Identifier = "threshold-example-v1"
    quality_policy_version: Identifier = "quality-example-v1"
    independence_policy_version: Identifier = "independence-example-v1"
    teacher_reviewed: StrictBool = False
    reviewed_by: Identifier | None = None
    reviewed_at: AwareDatetime | None = None
    confidence_calibrated: Literal[False] = False
    calibration_note: StrictStr = (
        "Uncalibrated illustrative defaults; not validated pedagogical probabilities."
    )
    min_present_independent_support: Annotated[StrictInt, Field(ge=1, le=20)] = 2
    min_clearance_independent_probes: Annotated[StrictInt, Field(ge=2, le=20)] = 2
    min_clearance_contexts: Annotated[StrictInt, Field(ge=2, le=20)] = 2
    min_clearance_families: Annotated[StrictInt, Field(ge=2, le=20)] = 2
    min_mastery_independent_demonstrations: Annotated[StrictInt, Field(ge=2, le=20)] = 2
    min_struggle_independent_failures: Annotated[StrictInt, Field(ge=2, le=20)] = 2
    min_transfer_independent_passes: Annotated[StrictInt, Field(ge=1, le=20)] = 1
    min_strong_observation_confidence: PositiveScore = 0.8
    min_clearance_confidence: PositiveScore = 0.85
    min_concept_confidence: PositiveScore = 0.85
    min_transfer_confidence: PositiveScore = 0.9
    min_catalog_diagnostic_strength: PositiveScore = 0.8
    min_evidence_quality: PositiveScore = 0.8
    min_reasoning_rubric_score: PositiveScore = 0.8
    min_concept_rubric_score: PositiveScore = 0.8
    min_transfer_rubric_score: PositiveScore = 0.8
    min_mastery_rubric_coverage: Annotated[float, Field(gt=0, le=1)] = 1.0
    required_misconception_coverage: Literal[1.0] = 1.0
    evidence_max_age_days: Annotated[StrictInt, Field(ge=1, le=3650)] = 90
    recent_support_window_days: Annotated[StrictInt, Field(ge=1, le=3650)] = 14
    concept_max_age_days: Annotated[StrictInt, Field(ge=1, le=3650)] = 90
    transfer_max_age_days: Annotated[StrictInt, Field(ge=1, le=3650)] = 30
    require_reasoning_for_clearance: Literal[True] = True
    require_distinct_families: StrictBool = True
    require_distinct_contexts: StrictBool = True
    require_transfer_for_crossing: StrictBool = True
    require_novel_transfer_family: StrictBool = False
    qualifying_sources: tuple[EvidenceSource, ...] = (
        EvidenceSource.DIAGNOSTIC_RESPONSE,
        EvidenceSource.QUIZ_RESPONSE,
        EvidenceSource.TRANSFER_RESPONSE,
        EvidenceSource.TEACHER_ASSESSMENT,
    )
    qualifying_answer_key_sources: tuple[AnswerKeySource, ...] = (
        AnswerKeySource.SERVER_FROZEN_ASSESSMENT,
        AnswerKeySource.CATALOG_REVIEWED_RUBRIC,
        AnswerKeySource.TEACHER_REVIEWED,
    )
    qualifying_assistance: tuple[Assistance, ...] = (Assistance.NO_RECORDED_HINT,)
    max_state_evidence_refs: Annotated[StrictInt, Field(ge=1, le=100)] = 20

    @model_validator(mode="after")
    def conservative_policy(self) -> Self:
        if self.teacher_reviewed and (not self.reviewed_by or self.reviewed_at is None):
            raise ValueError("Teacher-reviewed policies require reviewer and review time")
        if self.recent_support_window_days > self.evidence_max_age_days:
            raise ValueError("Recent-support window must fit inside evidence recency window")
        if self.min_clearance_confidence < self.min_strong_observation_confidence:
            raise ValueError("Clearance confidence cannot be weaker than support confidence")
        if not self.qualifying_sources or not self.qualifying_answer_key_sources:
            raise ValueError("Qualifying evidence sources and answer-key provenance are required")
        if not self.qualifying_assistance or any(
            item in self.qualifying_assistance
            for item in (Assistance.UNKNOWN, Assistance.ANSWER_REVEALED)
        ):
            raise ValueError("Unknown assistance and revealed answers cannot qualify")
        if AnswerKeySource.NONE in self.qualifying_answer_key_sources:
            raise ValueError("An unknown answer-key source cannot qualify")
        if self.require_distinct_families and self.min_transfer_independent_passes > 1:
            raise ValueError(
                "One fixed transfer problem has one family; configure multiple required transfer "
                "problems instead of repeated same-family passes"
            )
        return self


class CurriculumProvenance(ImmutableMemoryModel):
    source: Identifier = "AUTHORED"
    source_ref: StrictStr | None = None
    source_content_hash: StrictStr | None = None
    reviewed_aliases: tuple[Identifier, ...] = ()
    review_note: StrictStr | None = None


class RubricDimension(ImmutableMemoryModel):
    id: Identifier
    description: StrictStr = ""
    required: StrictBool = True


class ProblemOption(ImmutableMemoryModel):
    key: Identifier
    text: Annotated[StrictStr, Field(min_length=1)]


class CurriculumNode(ImmutableMemoryModel):
    type: NodeType
    id: Identifier
    name: Identifier
    schema_version: Literal[1] = 1
    curriculum_id: Identifier | None = None
    curriculum_version: Identifier | None = None
    description: StrictStr = ""
    active: StrictBool = True
    definition_version: Identifier = "1"
    provenance: CurriculumProvenance = Field(default_factory=CurriculumProvenance)
    crossing_policy_version: Identifier | None = None
    inventory_version: Identifier | None = None
    assessment_intent: StrictStr | None = None
    approved: StrictBool = False
    problem_version: Identifier | None = None
    family_id: Identifier | None = None
    task_type: TaskType | None = None
    prompt: StrictStr | None = None
    content_ref: StrictStr | None = None
    rubric_id: Identifier | None = None
    rubric_version: Identifier | None = None
    rubric_dimensions: tuple[RubricDimension, ...] = ()
    assessment_version: Identifier | None = None
    options: tuple[ProblemOption, ...] = ()
    correct_key: Identifier | None = None
    diagnostic_approved: StrictBool = False
    transfer_approved: StrictBool = False
    catalog_diagnostic_reliability: Score | None = None
    requires_reasoning: StrictBool = True

    @model_validator(mode="after")
    def valid_problem_fields(self) -> Self:
        keys = [option.key for option in self.options]
        if len(keys) != len(set(keys)):
            raise ValueError(f"Duplicate option key in problem {self.id}")
        if self.correct_key is not None and self.correct_key not in keys:
            raise ValueError(f"Correct key does not identify an option in problem {self.id}")
        dimensions = [dimension.id for dimension in self.rubric_dimensions]
        if len(dimensions) != len(set(dimensions)):
            raise ValueError(f"Duplicate rubric dimension in node {self.id}")
        if self.diagnostic_approved or self.transfer_approved:
            if self.type != NodeType.PROBLEM:
                raise ValueError("Only a PROBLEM may be approved as a diagnostic or transfer")
            if not all((
                self.problem_version, self.family_id, self.rubric_id, self.rubric_version,
                self.assessment_version, self.prompt or self.content_ref,
            )):
                raise ValueError(f"Approved problem {self.id} needs frozen task/rubric versions")
            if self.catalog_diagnostic_reliability is None:
                raise ValueError(f"Approved problem {self.id} needs catalog diagnostic reliability")
            if not self.rubric_dimensions:
                raise ValueError(f"Approved problem {self.id} needs reviewed rubric dimensions")
            if self.task_type == TaskType.MULTIPLE_CHOICE and not self.correct_key:
                raise ValueError(f"Approved multiple-choice problem {self.id} needs a correct key")
        return self


class CurriculumEdge(ImmutableMemoryModel):
    source_id: Identifier
    target_id: Identifier
    relation: EdgeRelation
    id: Identifier | None = None
    schema_version: Literal[1] = 1
    curriculum_id: Identifier | None = None
    curriculum_version: Identifier | None = None
    provenance: CurriculumProvenance = Field(default_factory=CurriculumProvenance)
    required_for_crossing: StrictBool | None = None
    threshold_relevance: ThresholdRelevance | None = None
    pedagogical_priority: Annotated[StrictInt, Field(ge=0, le=1000)] = 0
    diagnostic_strength: Score | None = None
    evidence_if_correct: EvidencePolarity = EvidencePolarity.NO_INFERENCE
    evidence_if_incorrect: EvidencePolarity = EvidencePolarity.NO_INFERENCE
    reasoning_required: StrictBool = True
    problem_version: Identifier | None = None
    rubric_version: Identifier | None = None
    assessment_version: Identifier | None = None
    reviewed: StrictBool = False
    order: Annotated[StrictInt, Field(ge=0)] | None = None
    transfer_condition_id: Identifier | None = None

    @model_validator(mode="after")
    def stable_edge_id(self) -> Self:
        if self.id is None:
            object.__setattr__(
                self, "id",
                opaque_key(
                    "edge", self.source_id, self.relation, self.target_id,
                    self.transfer_condition_id or "",
                ),
            )
        return self


class CurriculumGraph(ImmutableMemoryModel):
    tenant_id: Identifier
    curriculum_id: Identifier
    version: Identifier
    institute_ids: Annotated[tuple[Identifier, ...], Field(min_length=1, max_length=1000)]
    course_name: Identifier
    nodes: Annotated[tuple[CurriculumNode, ...], Field(max_length=5000)] = ()
    edges: Annotated[tuple[CurriculumEdge, ...], Field(max_length=30000)] = ()
    policies: PolicySet = Field(default_factory=PolicySet)
    course_ids: tuple[Identifier, ...] = ()
    status: PublicationStatus = PublicationStatus.DRAFT
    published_ready: StrictBool = False
    reviewed_by: Identifier | None = None
    reviewed_at: AwareDatetime | None = None
    schema_version: Literal[1] = 1
    provenance: CurriculumProvenance = Field(default_factory=CurriculumProvenance)

    @model_validator(mode="after")
    def bind_version_and_review(self) -> Self:
        for collection in ("nodes", "edges"):
            bound = []
            for entity in getattr(self, collection):
                if entity.curriculum_id not in (None, self.curriculum_id):
                    raise ValueError(f"Cross-curriculum entity {entity.id}")
                if entity.curriculum_version not in (None, self.version):
                    raise ValueError(f"Cross-version entity {entity.id}")
                bound.append(entity.model_copy(update={
                    "curriculum_id": self.curriculum_id, "curriculum_version": self.version,
                }))
            object.__setattr__(self, collection, tuple(bound))
        if len(self.institute_ids) != len(set(self.institute_ids)):
            raise ValueError("Duplicate institute grant")
        if self.published_ready:
            if self.status != PublicationStatus.PUBLISHED:
                raise ValueError("A published-ready graph must have PUBLISHED status")
            if not self.reviewed_by or self.reviewed_at is None:
                raise ValueError("Published graph requires teacher review metadata")
            if not self.policies.teacher_reviewed:
                raise ValueError("Published graph requires teacher-reviewed policies")
        elif self.status == PublicationStatus.PUBLISHED:
            raise ValueError("A published graph must be explicitly published-ready")
        return self

    @property
    def graph_key(self) -> str:
        return opaque_key("cg", self.tenant_id, self.curriculum_id, self.version)

    @property
    def content_hash(self) -> str:
        body = json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(body.encode()).hexdigest()


class LearningEventInput(MemoryModel):
    """Untrusted input: no quality, grading, observation, scope, or state authority."""

    event_id: Identifier
    event_type: EventType
    source: EvidenceSource
    source_id: Identifier
    thread_id: Identifier | None = None
    occurred_at: AwareDatetime
    answer: Answer = None
    reasoning: Annotated[StrictStr, Field(max_length=60000)] | None = None
    tc_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    problem_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    assessment_instance_id: Identifier | None = None
    supersedes_event_id: Identifier | None = None

    @field_validator("answer")
    @classmethod
    def bounded_answer(cls, value: Answer) -> Answer:
        if len(json.dumps(value, ensure_ascii=False).encode()) > 120000:
            raise ValueError("Answer exceeds the inline event payload limit")
        return value

    @model_validator(mode="after")
    def valid_lineage(self) -> Self:
        if self.supersedes_event_id == self.event_id:
            raise ValueError("An event cannot supersede itself")
        for name in ("tc_ids", "problem_ids"):
            items = getattr(self, name)
            if len(items) != len(set(items)):
                raise ValueError(f"Duplicate {name}")
        return self


class LearningEvent(LearningEventInput):
    scope: MemoryScope
    sequence: Annotated[StrictInt, Field(ge=1)] = Field(
        validation_alias=AliasChoices("sequence", "event_sequence")
    )
    received_at: AwareDatetime
    content_hash: Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{64}$")]
    policy_version: Identifier
    actor_id: Identifier | None = None
    schema_version: Literal[1] = 1

    @property
    def event_sequence(self) -> int:
        return self.sequence


class EvidenceQuality(ImmutableMemoryModel):
    score: Score = 0.0
    catalog_approved: StrictBool = False
    diagnostic_reliability: Score | None = None
    provenance: Identifier | None = None


class EvidenceProvenance(ImmutableMemoryModel):
    server_verified: StrictBool = False
    assessment_frozen: StrictBool = False
    capture_version: Identifier = "capture-v1"
    actor_id: Identifier | None = None
    artifact_ref: StrictStr | None = None
    content_hash: Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{64}$")] | None = None
    source_event_ids: tuple[Identifier, ...] = ()


class Evidence(MemoryModel):
    evidence_id: Identifier
    event_id: Identifier
    scope: MemoryScope
    source: EvidenceSource
    occurred_at: AwareDatetime
    event_sequence: Annotated[StrictInt, Field(ge=0)] = 0
    source_id: Identifier | None = None
    thread_id: Identifier | None = None
    answer: Answer = None
    reasoning: StrictStr | None = None
    reasoning_available: StrictBool = False
    problem_id: Identifier | None = None
    problem_version: Identifier | None = None
    assessment_instance_id: Identifier | None = None
    assessment_version: Identifier | None = None
    rubric_id: Identifier | None = None
    rubric_version: Identifier | None = None
    family_id: Identifier | None = None
    context_id: Identifier | None = None
    independence_key: Identifier | None = None
    lineage_id: Identifier | None = None
    supersedes_event_id: Identifier | None = None
    tc_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    misconception_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    quality: EvidenceQuality = Field(default_factory=EvidenceQuality)
    assistance: Assistance = Assistance.UNKNOWN
    answer_key_source: AnswerKeySource = AnswerKeySource.NONE
    provenance: EvidenceProvenance = Field(default_factory=EvidenceProvenance)
    schema_version: Literal[1] = 1

    @model_validator(mode="after")
    def reasoning_presence(self) -> Self:
        if self.reasoning and self.reasoning.strip() and not self.reasoning_available:
            object.__setattr__(self, "reasoning_available", True)
        return self


class RubricScore(MemoryModel):
    dimension_id: Identifier
    score: Score
    target_id: Identifier | None = None
    quote: StrictStr | None = None


class EvidenceQuote(MemoryModel):
    evidence_id: Identifier
    quote: Annotated[StrictStr, Field(min_length=1, max_length=60000)]
    start: Annotated[StrictInt, Field(ge=0)] | None = None
    end: Annotated[StrictInt, Field(ge=0)] | None = None

    @model_validator(mode="after")
    def valid_span(self) -> Self:
        if (self.start is None) != (self.end is None):
            raise ValueError("Quote spans need both start and end")
        if self.start is not None and self.end <= self.start:
            raise ValueError("Quote end must follow start")
        return self


class ConceptDemonstration(MemoryModel):
    tc_id: Identifier
    result: DemonstrationResult
    rubric_dimensions: list[RubricScore] = Field(default_factory=list)
    rubric_version: Identifier | None = None


class TransferJudgment(MemoryModel):
    problem_id: Identifier
    outcome: TransferStatus
    tc_id: Identifier | None = None
    condition_id: Identifier | None = None
    assessment_version: Identifier | None = None
    rubric_version: Identifier | None = None
    rubric_dimensions: list[RubricScore] = Field(default_factory=list)


class Observation(MemoryModel):
    observation_id: Identifier
    scope: MemoryScope
    source_evidence: Annotated[list[Identifier], Field(min_length=1, max_length=32)]
    supports: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    contradicts: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    concept_demonstrations: Annotated[
        list[ConceptDemonstration], Field(max_length=100)
    ] = Field(default_factory=list)
    transfer_judgments: Annotated[list[TransferJudgment], Field(max_length=100)] = Field(default_factory=list)
    claim: Annotated[StrictStr, Field(max_length=16000)] = ""
    reasoning_result: ReasoningResult = ReasoningResult.UNAVAILABLE
    rubric_dimensions: Annotated[list[RubricScore], Field(max_length=100)] = Field(default_factory=list)
    quotes: Annotated[list[EvidenceQuote], Field(max_length=100)] = Field(default_factory=list)
    confidence: Score = 0.0
    confidence_calibrated: Literal[False] = False
    extractor_version: Identifier
    extractor_kind: Literal["RULES", "MODEL", "TEACHER"] = "MODEL"
    model_version: Identifier | None = None
    prompt_version: Identifier | None = None
    event_id: Identifier | None = None
    created_at: AwareDatetime | None = None
    schema_version: Literal[1] = 1

    @model_validator(mode="after")
    def valid_claim_links(self) -> Self:
        if len(self.source_evidence) != len(set(self.source_evidence)):
            raise ValueError("Duplicate source evidence")
        if len(self.supports) != len(set(self.supports)) or len(self.contradicts) != len(set(self.contradicts)):
            raise ValueError("Duplicate misconception judgment target")
        if set(self.supports) & set(self.contradicts):
            raise ValueError("An observation cannot both support and contradict the same target")
        if any(quote.evidence_id not in self.source_evidence for quote in self.quotes):
            raise ValueError("A quote must reference the observation's source evidence")
        targets = [item.tc_id for item in self.concept_demonstrations]
        if len(targets) != len(set(targets)):
            raise ValueError("Duplicate concept judgment")
        transfer_keys = [
            (item.tc_id, item.problem_id, item.condition_id) for item in self.transfer_judgments
        ]
        if len(transfer_keys) != len(set(transfer_keys)):
            raise ValueError("Duplicate transfer judgment")
        return self


class ObservationSet(MemoryModel):
    scope: MemoryScope
    event_id: Identifier
    extractor_version: Identifier
    observations: list[Observation] = Field(default_factory=list)
    observation_set_id: Identifier | None = None
    created_at: AwareDatetime | None = None
    schema_version: Literal[1] = 1

    @model_validator(mode="after")
    def single_scope_and_extractor(self) -> Self:
        ids = [observation.observation_id for observation in self.observations]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate observation ID")
        for observation in self.observations:
            if observation.scope != self.scope:
                raise ValueError("Observation set contains a different learner scope")
            if observation.extractor_version != self.extractor_version:
                raise ValueError("Observation set mixes extractor versions")
            if observation.event_id not in (None, self.event_id):
                raise ValueError("Observation set mixes event IDs")
        return self


class ProcessingReceipt(MemoryModel):
    event_id: Identifier
    scope: MemoryScope
    status: ProcessingStatus = ProcessingStatus.PENDING
    stage: ProcessingStage = ProcessingStage.INTAKE
    sequence: Annotated[StrictInt, Field(ge=0)] = 0
    processing_run_id: Identifier | None = None
    attempts: Annotated[StrictInt, Field(ge=0)] = 0
    lease_owner: Identifier | None = None
    lease_expires_at: AwareDatetime | None = None
    next_retry_at: AwareDatetime | None = None
    error_code: Identifier | None = None
    result_snapshot_version: Annotated[StrictInt, Field(ge=0)] | None = None
    accepted_at: AwareDatetime | None = None
    updated_at: AwareDatetime | None = None


class EvidenceExclusion(MemoryModel):
    evidence_id: Identifier
    reason: Identifier
    observation_id: Identifier | None = None


class StateEvidence(MemoryModel):
    state_version: Annotated[StrictInt, Field(ge=1)] = 1
    confidence: Score = 0.0
    confidence_calibrated: Literal[False] = False
    trend: Trend = Trend.UNKNOWN
    first_seen_at: AwareDatetime | None = None
    updated_at: AwareDatetime | None = None
    last_observed_at: AwareDatetime | None = None
    next_revalidation_at: AwareDatetime | None = None
    raw_evidence_count: Annotated[StrictInt, Field(ge=0)] = 0
    qualifying_evidence_count: Annotated[StrictInt, Field(ge=0)] = 0
    independent_context_count: Annotated[StrictInt, Field(ge=0)] = 0
    evidence_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    observation_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    excluded_evidence: Annotated[list[EvidenceExclusion], Field(max_length=100)] = Field(
        default_factory=list
    )
    policy_version: Identifier | None = None
    curriculum_version: Identifier | None = None
    reason_codes: list[Identifier] = Field(default_factory=list)


class MisconceptionState(StateEvidence):
    misconception_id: Identifier
    state: MisconceptionStatus = MisconceptionStatus.NOT_ASSESSED
    direct_probe_count: Annotated[StrictInt, Field(ge=0)] = 0
    qualifying_clearing_count: Annotated[StrictInt, Field(ge=0)] = 0
    clearing_context_count: Annotated[StrictInt, Field(ge=0)] = 0
    clearing_family_count: Annotated[StrictInt, Field(ge=0)] = 0
    coverage_eligible: StrictBool = False
    qualifying_clearing_evidence_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(
        default_factory=list
    )
    qualifying_support_evidence_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(
        default_factory=list
    )


class ConceptState(StateEvidence):
    tc_id: Identifier
    state: ConceptStatus = ConceptStatus.NOT_ATTEMPTED
    rubric_coverage: Score = 0.0
    demonstrated_dimensions: list[Identifier] = Field(default_factory=list)
    demonstration_count: Annotated[StrictInt, Field(ge=0)] = 0
    failure_count: Annotated[StrictInt, Field(ge=0)] = 0


class TransferState(MemoryModel):
    problem_id: Identifier
    condition_id: Identifier | None = None
    state: TransferStatus = TransferStatus.NOT_ATTEMPTED
    assessment_version: Identifier | None = None
    rubric_version: Identifier | None = None
    evidence_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    observation_ids: Annotated[list[Identifier], Field(max_length=100)] = Field(default_factory=list)
    next_revalidation_at: AwareDatetime | None = None
    reason_codes: list[Identifier] = Field(default_factory=list)


class ThresholdState(StateEvidence):
    tc_id: Identifier
    state: ThresholdStatus = ThresholdStatus.NOT_CROSSED
    required_total: Annotated[StrictInt, Field(ge=0)] = 0
    required_cleared: Annotated[StrictInt, Field(ge=0)] = 0
    required_covered: Annotated[StrictInt, Field(ge=0)] = 0
    required_coverage: Score = 0.0
    evidence_sufficient: StrictBool = False
    transfer_state: TransferStatus = TransferStatus.NOT_ATTEMPTED
    transfers: dict[Identifier, TransferState] = Field(default_factory=dict)


class ProfileMisconception(MemoryModel):
    state: MisconceptionStatus
    trend: Trend


class ProbeRecommendation(MemoryModel):
    tc_id: Identifier
    misconception_id: Identifier | None = None
    problem_id: Identifier | None = None
    reason_code: Identifier


class LearningProfile(MemoryModel):
    active_tc: Identifier | None = None
    strong_tcs: list[Identifier] = Field(default_factory=list)
    weak_tcs: list[Identifier] = Field(default_factory=list)
    candidate_tcs: list[Identifier] = Field(default_factory=list)
    crossed_tcs: list[Identifier] = Field(default_factory=list)
    active_misconceptions: dict[Identifier, ProfileMisconception] = Field(default_factory=dict)
    unresolved_prerequisites: list[Identifier] = Field(default_factory=list)
    learning_trend: Trend = Trend.UNKNOWN
    next_recommended_probe: ProbeRecommendation | None = None
    curriculum_id: Identifier | None = None
    curriculum_version: Identifier | None = None
    policy_version: Identifier | None = None
    snapshot_version: Annotated[StrictInt, Field(ge=0)] = 0
    evidence_watermark: Annotated[StrictInt, Field(ge=0)] = 0
    updated_at: AwareDatetime | None = None
    next_revalidation_at: AwareDatetime | None = None
    needs_revalidation: StrictBool = False


class LearnerSnapshot(MemoryModel):
    scope: MemoryScope
    snapshot_version: Annotated[StrictInt, Field(ge=0)] = 0
    last_processed_sequence: Annotated[StrictInt, Field(ge=0)] = 0
    as_of: AwareDatetime = datetime(1970, 1, 1, tzinfo=timezone.utc)
    next_revalidation_at: AwareDatetime | None = None
    misconception_states: Annotated[
        dict[Identifier, MisconceptionState], Field(max_length=5000)
    ] = Field(default_factory=dict)
    concept_states: Annotated[dict[Identifier, ConceptState], Field(max_length=5000)] = Field(
        default_factory=dict
    )
    threshold_states: Annotated[dict[Identifier, ThresholdState], Field(max_length=5000)] = Field(
        default_factory=dict
    )
    profile: LearningProfile = Field(default_factory=LearningProfile)
    policy_version: Identifier | None = None
    schema_version: Literal[1] = 1

    @model_validator(mode="after")
    def stable_state_keys(self) -> Self:
        for key, value in self.misconception_states.items():
            if key != value.misconception_id:
                raise ValueError("Misconception-state key differs from its target")
        for collection in (self.concept_states, self.threshold_states):
            if any(key != value.tc_id for key, value in collection.items()):
                raise ValueError("State key differs from its TC target")
        return self
