"""Scoped memory, curriculum review and configuration API. No state-write API."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from azure.core import MatchConditions
from azure.cosmos.exceptions import CosmosHttpResponseError
from azure_services.persistence.learner_memory import MemoryConflictError, MemoryIntegrityError
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, JsonValue

from backend.dependencies import agent_access
from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.dependencies.learner_access import (
    CurriculumBinding,
    MemoryIdentity,
    course_binding,
    course_identity,
    course_memory_mode,
    memory_enabled,
    read_scope_registry,
    require_course_actor,
    require_memory_enabled,
    require_scope_administrator,
    resolve_course_roster,
    resolve_learner_access,
)
from backend.schemas.learner_memory import (
    CurriculumGraph,
    EvidenceSource,
    EventType,
    LearningEventInput,
    LearnerSnapshot,
    ProcessingReceipt,
    opaque_key,
)
from learner_memory.integration import memory_api_errors, verify_hosted_memory_disabled

router = APIRouter(prefix="/api", tags=["Learner memory"])
CurrentUser = Annotated[ActiveUser, Depends(get_current_active_user)]


class StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MemoryConfiguration(StrictResponse):
    enabled: bool
    graph_memory_mode: Literal["off", "shadow", "authoritative"] = "off"
    memory_scope: MemoryIdentity | None = None
    curriculum_binding: CurriculumBinding | None = None
    revision: str
    can_manage: bool = False


class MemoryConfigurationUpdate(StrictResponse):
    graph_memory_mode: Literal["off", "shadow", "authoritative"]
    memory_scope: MemoryIdentity
    curriculum_binding: CurriculumBinding
    revision: str = Field(min_length=1, max_length=256)


class GraphDraftRequest(StrictResponse):
    graph: CurriculumGraph
    expected_revision: str | None = Field(default=None, max_length=256)


class GraphImportRequest(StrictResponse):
    curriculum_version: str = Field(min_length=1, max_length=128)
    expected_revision: str | None = Field(default=None, max_length=256)


class GraphDraftResponse(StrictResponse):
    id: str
    revision: str | None
    graph: CurriculumGraph


class GraphPublishRequest(StrictResponse):
    curriculum_version: str = Field(min_length=1, max_length=128)
    expected_revision: str = Field(min_length=1, max_length=256)
    expected_course_revision: str = Field(min_length=1, max_length=256)
    event_id: str = Field(min_length=1, max_length=256)
    reviewed: Literal[True]


class MemoryStateResponse(LearnerSnapshot):
    memory_source: Literal["graph_memory"] = "graph_memory"
    mode: Literal["shadow", "authoritative"]
    freshness: Literal["current", "stale"]
    pending_count: int = Field(ge=0)
    processing_receipt: ProcessingReceipt | None = None


class MemoryContextResponse(StrictResponse):
    schema_version: Literal[1]
    scope_ref: str
    curriculum_id: str
    curriculum_version: str
    policy_version: str
    snapshot_version: int
    learning_epoch: int
    mode: Literal["ta", "individual"]
    active_tc: str | None
    freshness: str
    pending_count: int
    nodes: list[dict[str, JsonValue]]
    edges: list[dict[str, JsonValue]]
    evidence: list[dict[str, JsonValue]]
    observations: list[dict[str, JsonValue]]
    prerequisite_gaps: list[dict[str, JsonValue]]
    likely_bottlenecks: list[dict[str, JsonValue]]
    next_recommended_probe: dict[str, JsonValue] | None
    truncated: bool
    bounds_applied: list[str]
    authority: str


class CohortResponse(StrictResponse):
    schema_version: Literal[1] = 1
    student_count: int
    total_students: int
    with_evidence: int = 0
    unassessed_students: int = 0
    complete: bool
    partial: bool = False
    coverage: float = 1.0
    stale_students: int = 0
    curriculum_id: str | None = None
    curriculum_version: str | None = None
    policy_version: str | None = None
    threshold_counts: dict[str, dict[str, int]]
    concept_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    concept_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    misconception_counts: dict[str, dict[str, int]]
    transfer_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    blockers: dict[str, dict[str, int]] = Field(default_factory=dict)
    prerequisite_bottlenecks: dict[str, dict[str, int]] = Field(default_factory=dict)
    prerequisite_bottlenecks: dict[str, dict[str, int]] = Field(default_factory=dict)
    learning_trends: dict[str, int] = Field(default_factory=dict)
    evidence_source_distribution: dict[str, int] = Field(default_factory=dict)
    students: list[dict[str, JsonValue]]
    evidence_loaded: Literal[False] = False
    offset: int = 0
    next_offset: int | None = None


class EvidenceResponse(StrictResponse):
    evidence_id: str
    event_id: str
    source: str
    occurred_at: datetime
    answer: JsonValue
    reasoning: str | None
    assistance: str
    tc_ids: list[str]
    misconception_ids: list[str]
    curriculum_version: str
    learning_epoch: int


class MemoryOperationRequest(StrictResponse):
    event_id: str = Field(min_length=1, max_length=256)


class TeacherEvidenceRequest(StrictResponse):
    event_id: str = Field(min_length=1, max_length=256)
    source_id: str = Field(min_length=1, max_length=256)
    answer: str = Field(min_length=1, max_length=60000)
    reasoning: str | None = Field(default=None, max_length=60000)
    problem_ids: list[str] = Field(default_factory=list, max_length=50)
    tc_ids: list[str] = Field(default_factory=list, max_length=100)
    verified_learner_work: Literal[True]


class LegacyProgressResponse(StrictResponse):
    agent_name: str
    user_id: str
    status: str
    message: str | None = None
    progress: dict[str, JsonValue] | None = None
    memory_source: str | None = None


def service():
    from learner_memory.service import get_service

    return get_service()


def _config(agent: dict, user: ActiveUser) -> MemoryConfiguration:
    return MemoryConfiguration(
        enabled=memory_enabled(), graph_memory_mode=course_memory_mode(agent),
        memory_scope=course_identity(agent) if agent.get("memory_scope") else None,
        curriculum_binding=course_binding(agent) if agent.get("curriculum_binding") else None,
        revision=agent["_etag"], can_manage=user.role in {"admin", "superadmin"},
    )


def _replace_binding(agent: dict, revision: str, updates: dict) -> dict:
    if agent.get("_etag") != revision:
        raise HTTPException(status_code=409, detail="Course configuration changed; reload before saving")
    from azure_services.persistence.cosmos_db import _get_agents_container

    document = {
        key: value for key, value in agent.items()
        if key not in {"_etag", "_rid", "_self", "_ts", "_attachments"}
    }
    document.update(updates)
    try:
        result = _get_agents_container().replace_item(
            item=agent["id"], body=document, etag=revision,
            match_condition=MatchConditions.IfNotModified,
        )
    except CosmosHttpResponseError as error:
        if error.status_code in {409, 412}:
            raise HTTPException(status_code=409, detail="Course configuration changed; reload before saving") from None
        raise
    from teacher_dashboard.teacher_scope import invalidate_teacher_agents_cache
    from utils.metadata_cache import invalidate_agent_metadata

    invalidate_teacher_agents_cache()
    invalidate_agent_metadata(agent["id"])
    return result


@router.get("/agents/{agent_id}/memory/config", response_model=MemoryConfiguration)
def memory_configuration(agent_id: str, user: CurrentUser):
    with memory_api_errors():
        agent = agent_access.load_agent(agent_id)
        if agent.get("memory_scope"):
            require_course_actor(agent, user)
        else:
            agent_access.check_agent_access(agent, user)
        return _config(agent, user)


@router.put("/agents/{agent_id}/memory/config", response_model=MemoryConfiguration)
def update_memory_configuration(agent_id: str, body: MemoryConfigurationUpdate, user: CurrentUser):
    require_memory_enabled()
    with memory_api_errors():
        # Admin role alone is insufficient, including for the initial binding.
        require_scope_administrator(user, body.memory_scope)
        agent = agent_access.load_agent(agent_id)
        if agent.get("memory_scope") and course_identity(agent) != body.memory_scope:
            raise HTTPException(status_code=409, detail="An existing immutable memory scope cannot be changed")
        require_course_actor(agent, user, edit=True, identity=body.memory_scope)
        if body.graph_memory_mode != "off":
            graph = service().read_graph(
                body.memory_scope.tenant_id, body.curriculum_binding.curriculum_id,
                body.curriculum_binding.curriculum_version,
            )
            if (
                graph is None or not graph.published_ready or not graph.policies.teacher_reviewed
                or body.memory_scope.institute_id not in graph.institute_ids
                or (graph.course_ids and agent_id not in graph.course_ids)
            ):
                raise HTTPException(status_code=409, detail="Publish and review the scoped curriculum before enabling memory")
            if body.graph_memory_mode == "authoritative":
                verify_hosted_memory_disabled(agent_id)
        return _config(_replace_binding(agent, body.revision, {
            "memory_scope": body.memory_scope.model_dump(),
            "curriculum_binding": body.curriculum_binding.model_dump(),
            "graph_memory_mode": body.graph_memory_mode,
        }), user)


def _editor(agent_id: str, user: ActiveUser) -> tuple[dict, MemoryIdentity, CurriculumBinding]:
    require_memory_enabled()
    agent = agent_access.load_agent(agent_id)
    require_course_actor(agent, user, edit=True)
    identity = course_identity(agent)
    read_scope_registry(identity)
    return agent, identity, course_binding(agent)


def _scoped_graph(graph: CurriculumGraph, agent_id: str, identity: MemoryIdentity, binding: CurriculumBinding):
    if (
        graph.tenant_id != identity.tenant_id or graph.curriculum_id != binding.curriculum_id
        or set(graph.institute_ids) != {identity.institute_id}
        or (graph.course_ids and agent_id not in graph.course_ids)
    ):
        raise HTTPException(status_code=403, detail="The curriculum graph is outside the authorized course scope")
    return graph


@router.get("/agents/{agent_id}/course-curriculum/graph", response_model=GraphDraftResponse)
def get_graph_draft(agent_id: str, user: CurrentUser, version: str | None = None):
    with memory_api_errors():
        _agent, identity, binding = _editor(agent_id, user)
        selected = version or binding.curriculum_version
        draft = service().read_draft(identity.tenant_id, binding.curriculum_id, selected)
        if draft:
            _scoped_graph(CurriculumGraph.model_validate(draft["graph"]), agent_id, identity, binding)
            return draft
        graph = service().read_graph(identity.tenant_id, binding.curriculum_id, selected)
        if graph is None:
            raise HTTPException(status_code=404, detail="Curriculum graph draft not found")
        _scoped_graph(graph, agent_id, identity, binding)
        return GraphDraftResponse(id=graph.graph_key, revision=None, graph=graph)


@router.put("/agents/{agent_id}/course-curriculum/graph", response_model=GraphDraftResponse)
def put_graph_draft(agent_id: str, body: GraphDraftRequest, user: CurrentUser):
    with memory_api_errors():
        _agent, identity, binding = _editor(agent_id, user)
        graph = _scoped_graph(body.graph, agent_id, identity, binding)
        return service().save_draft(graph, expected_revision=body.expected_revision)


@router.post("/agents/{agent_id}/course-curriculum/graph/import", response_model=GraphDraftResponse)
def import_existing_curriculum(agent_id: str, body: GraphImportRequest, user: CurrentUser):
    with memory_api_errors():
        _agent, identity, binding = _editor(agent_id, user)
        from learner_memory.curriculum import import_legacy_curriculum
        from utils.course_creation import load_curriculum_snapshot

        curriculum = load_curriculum_snapshot(agent_id)
        if not curriculum or curriculum.get("_status") or not curriculum.get("all_threshold_concepts"):
            raise HTTPException(status_code=409, detail="Complete the course curriculum before importing a graph draft")
        graph = import_legacy_curriculum(
            curriculum, tenant_id=identity.tenant_id, institute_id=identity.institute_id,
            course_id=agent_id, curriculum_id=binding.curriculum_id, version=body.curriculum_version,
        )
        return service().save_draft(graph, expected_revision=body.expected_revision)


@router.post("/agents/{agent_id}/course-curriculum/graph/publish", response_model=GraphDraftResponse)
@router.post("/agents/{agent_id}/course-curriculum/publish", response_model=GraphDraftResponse)
def publish_graph_draft(agent_id: str, body: GraphPublishRequest, user: CurrentUser):
    with memory_api_errors():
        agent, identity, binding = _editor(agent_id, user)
        if agent.get("_etag") != body.expected_course_revision:
            raise HTTPException(status_code=409, detail="Course configuration changed; reload before publishing")
        draft = service().read_draft(identity.tenant_id, binding.curriculum_id, body.curriculum_version)
        if not draft or draft["revision"] != body.expected_revision:
            raise HTTPException(status_code=409, detail="Curriculum draft changed; reload before publishing")
        graph = _scoped_graph(CurriculumGraph.model_validate(draft["graph"]), agent_id, identity, binding)
        existing = service().read_graph(identity.tenant_id, binding.curriculum_id, graph.version)
        moment = (
            existing.reviewed_at if existing is not None and existing.reviewed_by == user.id
            else datetime.now(timezone.utc)
        )
        graph = graph.model_copy(update={
            "reviewed_by": user.id, "reviewed_at": moment,
            "policies": graph.policies.model_copy(update={
                "teacher_reviewed": True, "reviewed_by": user.id, "reviewed_at": moment,
            }),
        })
        published = service().publish_graph(graph)
        # Publication is immutable. Activating it is a separate scoped-admin config change.
        return GraphDraftResponse(id=published.graph_key, revision=None, graph=published)


@router.get("/agents/{agent_id}/learners/{student_id}/memory", response_model=MemoryStateResponse)
def get_learner_memory(agent_id: str, student_id: str, user: CurrentUser):
    with memory_api_errors():
        access = resolve_learner_access(agent_id, student_id, user)
        snapshot = service().get_snapshot(access.scope)
        pending = service().pending_count(access.scope)
        stale = bool(snapshot.next_revalidation_at and snapshot.next_revalidation_at <= datetime.now(timezone.utc))
        return MemoryStateResponse(
            **snapshot.model_dump(), mode=access.mode,
            freshness="stale" if stale else "current", pending_count=pending,
            processing_receipt=service().next_receipt(access.scope) if pending else None,
        )


@router.get("/agents/{agent_id}/learners/{student_id}/memory/context", response_model=MemoryContextResponse)
def get_learner_context(
    agent_id: str, student_id: str, user: CurrentUser,
    tc_id: str | None = None, mode: Literal["ta", "individual"] = "ta",
):
    if mode == "individual" and user.role == "student":
        raise HTTPException(status_code=403, detail="Individual-depth context requires assigned teacher access")
    with memory_api_errors():
        access = resolve_learner_access(agent_id, student_id, user)
        result = service().context(access.scope, tc_id=tc_id, mode=mode)
        if user.role == "student":
            result = dict(result)
            result["nodes"] = [node for node in result["nodes"] if node.get("type") != "MISCONCEPTION"]
            node_ids = {node["id"] for node in result["nodes"]}
            result["edges"] = [
                edge for edge in result["edges"]
                if edge["source_id"] in node_ids and edge["target_id"] in node_ids
                and edge["relation"] != "DIAGNOSES"
            ]
            result["observations"] = []
            result["truncated"] = True
            result["bounds_applied"] = [*result["bounds_applied"], "private_diagnostic_redaction"]
        return result


@router.get("/agents/{agent_id}/learners/{student_id}/memory/evidence/{evidence_id}", response_model=EvidenceResponse)
def get_learner_evidence(agent_id: str, student_id: str, evidence_id: str, user: CurrentUser):
    with memory_api_errors():
        access = resolve_learner_access(agent_id, student_id, user)
        evidence = service().get_evidence(access.scope, evidence_id)
        if evidence is None:
            raise HTTPException(status_code=404, detail="Learner evidence not found")
        return EvidenceResponse(
            evidence_id=evidence.evidence_id, event_id=evidence.event_id,
            source=str(evidence.source), occurred_at=evidence.occurred_at,
            answer=evidence.answer, reasoning=evidence.reasoning, assistance=str(evidence.assistance),
            tc_ids=evidence.tc_ids,
            misconception_ids=evidence.misconception_ids if user.role != "student" else [],
            curriculum_version=access.scope.curriculum_version, learning_epoch=access.scope.learning_epoch,
        )


@router.get("/agents/{agent_id}/learners/{student_id}/memory/evidence/{evidence_id}/artifact", response_class=Response, response_model=None)
def get_learner_artifact(agent_id: str, student_id: str, evidence_id: str, user: CurrentUser):
    with memory_api_errors():
        access = resolve_learner_access(agent_id, student_id, user)
        content, content_type = service().evidence_artifact(access.scope, evidence_id)
        return Response(content, media_type=content_type, headers={
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Content-Disposition": 'attachment; filename="learner-evidence"',
        })


@router.get("/agents/{agent_id}/learners/{student_id}/memory/events/{event_id}", response_model=ProcessingReceipt)
def get_memory_receipt(
    agent_id: str, student_id: str, event_id: str, user: CurrentUser,
    learning_epoch: int | None = Query(default=None, ge=1),
):
    with memory_api_errors():
        access = resolve_learner_access(agent_id, student_id, user)
        scope = access.scope
        if learning_epoch is not None:
            if learning_epoch > scope.learning_epoch:
                raise HTTPException(status_code=403, detail="The learning epoch is outside the authorized learner history")
            scope = scope.model_copy(update={"learning_epoch": learning_epoch})
        receipt = service().get_receipt(scope, event_id)
        if receipt is None:
            raise HTTPException(status_code=404, detail="Learner processing receipt not found")
        return receipt


@router.post("/agents/{agent_id}/learners/{student_id}/memory/events", response_model=ProcessingReceipt, status_code=202)
def append_teacher_evidence(agent_id: str, student_id: str, body: TeacherEvidenceRequest, user: CurrentUser):
    with memory_api_errors():
        access = resolve_learner_access(agent_id, student_id, user, edit=True)
        identity = opaque_key("teacher_evidence", user.id, body.event_id)
        return service().accept_event(access.scope, LearningEventInput(
            event_id=identity, event_type=EventType.TEACHER_EVIDENCE,
            source=EvidenceSource.TEACHER_ASSESSMENT, source_id=body.source_id,
            occurred_at=datetime.now(timezone.utc), answer=body.answer, reasoning=body.reasoning,
            problem_ids=body.problem_ids, tc_ids=body.tc_ids,
        ), actor_id=user.id)


@router.post("/agents/{agent_id}/learners/{student_id}/memory/recompute", response_model=ProcessingReceipt, status_code=202)
@router.post("/agents/{agent_id}/learners/{student_id}/memory/recomputations", response_model=ProcessingReceipt, status_code=202)
def recompute_memory(agent_id: str, student_id: str, body: MemoryOperationRequest, user: CurrentUser):
    with memory_api_errors():
        access = resolve_learner_access(agent_id, student_id, user, edit=True)
        identity = opaque_key("operation", "recompute", access.scope.graph_key, body.event_id)
        service().retry_failed_input(access.scope, identity, user.id)
        previous = service().get_receipt(access.scope, identity)
        if previous is not None:
            return previous
        try:
            return service().accept_event(access.scope, LearningEventInput(
                event_id=identity, event_type=EventType.REVALIDATION,
                source=EvidenceSource.SYSTEM_REVALIDATION, source_id=identity,
                occurred_at=datetime.now(timezone.utc),
            ))
        except MemoryConflictError:
            previous = service().get_receipt(access.scope, identity)
            if previous is not None:
                return previous
            raise


@router.post("/agents/{agent_id}/learners/{student_id}/memory/reset", response_model=ProcessingReceipt, status_code=202)
def reset_memory(agent_id: str, student_id: str, body: MemoryOperationRequest, user: CurrentUser):
    with memory_api_errors():
        access = resolve_learner_access(agent_id, student_id, user)
        if user.role == "teacher":
            raise HTTPException(status_code=403, detail="Memory reset requires the learner or a scoped administrator")
        identity = opaque_key("operation", "reset", access.scope.graph_key, body.event_id)
        try:
            previous = service().get_receipt(access.scope, identity)
        except MemoryIntegrityError:
            if access.scope.learning_epoch <= 1:
                raise
            try:
                previous = service().get_receipt(
                    access.scope.model_copy(update={"learning_epoch": access.scope.learning_epoch - 1}), identity
                )
            except MemoryIntegrityError:
                raise HTTPException(status_code=409, detail="This reset belongs to an earlier learning epoch; load its original receipt") from None
        if previous is not None:
            return previous
        try:
            return service().reset(access.scope, identity)
        except MemoryConflictError:
            previous = service().get_receipt(access.scope, identity)
            if previous is not None:
                return previous
            raise


@router.get("/agents/{agent_id}/memory/cohort", response_model=CohortResponse)
@router.get("/teacher-dashboard/memory/cohorts/{agent_id}", response_model=CohortResponse)
def get_memory_cohort(
    agent_id: str, user: CurrentUser, tc_id: str | None = None, offset: int = Query(default=0, ge=0)
):
    with memory_api_errors():
        accesses = resolve_course_roster(agent_id, user)
        return service().cohort([access.scope for access in accesses], tc_id=tc_id, offset=offset)


@router.get("/agents/{agent_name}/progress/{user_id}", response_model=LegacyProgressResponse, response_model_exclude_none=True)
async def legacy_learning_progress(agent_name: str, user_id: str, user: CurrentUser):
    if user.role == "student" and user_id != user.id:
        raise HTTPException(status_code=403, detail="Students may access only their own progress")
    with memory_api_errors():
        agent = agent_access.load_agent(agent_name)
        agent_access.check_agent_access(agent, user)
        if memory_enabled() and course_memory_mode(agent) == "authoritative":
            from learner_memory.integration import MemoryToolContext, legacy_projection

            access = resolve_learner_access(agent_name, user_id, user, agent=agent)
            context = MemoryToolContext(access.scope, user.id, access.mode, "compatibility-read")
            projection = legacy_projection(user_id, agent_name, memory_context=context)
            return LegacyProgressResponse(
                agent_name=agent_name, user_id=user_id, status="ok",
                memory_source="graph_memory", progress=projection,
            )
        from backend import main

        return await main.get_learning_progress(agent_name, user_id)


@router.post("/agents/{agent_name}/reset-progress/{user_id}", response_model=LegacyProgressResponse, response_model_exclude_none=True)
async def legacy_reset_progress(
    agent_name: str, user_id: str, user: CurrentUser, body: MemoryOperationRequest | None = None
):
    if user.role == "student" and user_id != user.id:
        raise HTTPException(status_code=403, detail="Students may reset only their own progress")
    with memory_api_errors():
        agent = agent_access.load_agent(agent_name)
        agent_access.check_agent_access(agent, user)
        if memory_enabled() and course_memory_mode(agent) == "authoritative":
            if body is None:
                raise HTTPException(status_code=409, detail="Use memory/reset with a stable event_id; graph history is never deleted")
            reset_memory(agent_name, user_id, body, user)
            return LegacyProgressResponse(
                agent_name=agent_name, user_id=user_id, status="pending",
                message="A new learning epoch has been queued; historical evidence is retained.",
                memory_source="graph_memory",
            )
        from backend import main

        return await main.reset_learning_progress(agent_name, user_id)
