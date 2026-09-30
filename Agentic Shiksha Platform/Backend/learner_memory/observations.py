"""Schema-constrained interpretations; this module cannot write learner states."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Annotated, Protocol

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas.learner_memory import (
    ConceptDemonstration,
    CurriculumGraph,
    DemonstrationResult,
    EdgeRelation,
    Evidence,
    EvidenceQuote,
    EvidenceSource,
    NodeType,
    Observation,
    ObservationSet,
    ReasoningResult,
    RubricScore,
    TransferJudgment,
    TransferStatus,
    opaque_key,
)
from azure_services.persistence.learner_memory import content_hash


EXTRACTOR_VERSION = "learner-observation-v1"
PROMPT_VERSION = "learner_observation_v1"
_PROMPT = Path(__file__).resolve().parents[1] / "prompt_store" / "evaluation" / f"{PROMPT_VERSION}.md"


class ProposedDimension(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dimension_id: str
    score: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class ProposedJudgment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence_id: str
    claim: Annotated[str, Field(max_length=4000)]
    quote: Annotated[str, Field(min_length=1, max_length=6000)]
    supports: list[str]
    contradicts: list[str]
    reasoning_result: ReasoningResult
    confidence: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    rubric_dimensions: list[ProposedDimension]
    concept_result: DemonstrationResult
    transfer_result: TransferStatus


class ProposedObservationSet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    judgments: Annotated[list[ProposedJudgment], Field(max_length=100)]


class ObservationExtractor(Protocol):
    def extract(self, evidence: list[Evidence], graph: CurriculumGraph, now: datetime) -> ObservationSet: ...


def evidence_text(evidence: Evidence) -> str:
    answer = evidence.answer if isinstance(evidence.answer, str) else json.dumps(evidence.answer or {}, ensure_ascii=False)
    return f"{answer}\n{evidence.reasoning or ''}"


def validate_observation_set(result: ObservationSet, evidence: list[Evidence], graph: CurriculumGraph) -> None:
    by_id = {item.evidence_id: item for item in evidence}
    nodes = {node.id: node for node in graph.nodes}
    misconceptions = {node.id for node in graph.nodes if node.type == NodeType.MISCONCEPTION}
    for observation in result.observations:
        if observation.scope != result.scope or not set(observation.source_evidence) <= by_id.keys():
            raise ValueError("Observation references unavailable learner evidence")
        if not (set(observation.supports) | set(observation.contradicts)) <= misconceptions:
            raise ValueError("Observation references an unknown misconception")
        if (observation.supports or observation.contradicts or observation.concept_demonstrations or observation.transfer_judgments) and not observation.quotes:
            raise ValueError("Diagnostic observations require supporting learner quotes")
        for quote in observation.quotes:
            source = by_id.get(quote.evidence_id)
            source_fields = [] if source is None else (
                [source.answer] if isinstance(source.answer, str) else list((source.answer or {}).values())
            ) + [source.reasoning or ""]
            if source is None or not any(quote.quote in text for text in source_fields):
                raise ValueError("Observation quote is not grounded in the source evidence")
        allowed_dimensions = {
            dimension.id
            for identity in observation.source_evidence
            for dimension in (nodes[by_id[identity].problem_id].rubric_dimensions if by_id[identity].problem_id in nodes else ())
        }
        for score in observation.rubric_dimensions:
            if score.dimension_id not in allowed_dimensions:
                raise ValueError("Observation uses an unapproved rubric dimension")


def proposals_to_observations(
    proposals: ProposedObservationSet, evidence: list[Evidence], graph: CurriculumGraph,
    now: datetime, *, model_version: str,
) -> ObservationSet:
    if not evidence:
        raise ValueError("An extraction requires an evidence scope")
    scope, event_id = evidence[0].scope, evidence[0].event_id
    by_id = {item.evidence_id: item for item in evidence}
    nodes = {node.id: node for node in graph.nodes}
    observations = []
    for proposal in proposals.judgments:
        source = by_id.get(proposal.evidence_id)
        if source is None:
            raise ValueError("Extractor proposed evidence outside the event")
        problem = nodes.get(source.problem_id or "")
        if proposal.concept_result == DemonstrationResult.PASS and (problem is None or not problem.diagnostic_approved):
            raise ValueError("An unapproved conversational task cannot certify a concept demonstration")
        if proposal.transfer_result == TransferStatus.PASS and (problem is None or not problem.transfer_approved):
            raise ValueError("A transfer pass requires an approved transfer problem")
        if problem and problem.correct_key is not None and source.answer != problem.correct_key and (
            proposal.concept_result == DemonstrationResult.PASS or proposal.transfer_result == TransferStatus.PASS
        ):
            raise ValueError("A failed server-scored task cannot be reported as a passed demonstration")
        dimensions = [
            RubricScore(dimension_id=score.dimension_id, score=score.score, quote=proposal.quote)
            for score in proposal.rubric_dimensions
        ]
        demonstrations = []
        transfers = []
        if problem is not None and problem.diagnostic_approved:
            demonstrations = [
                ConceptDemonstration(
                    tc_id=tc_id, result=proposal.concept_result,
                    rubric_dimensions=dimensions, rubric_version=problem.rubric_version,
                ) for tc_id in source.tc_ids
            ]
        if problem is not None and problem.transfer_approved:
            transfers = [
                TransferJudgment(
                    problem_id=problem.id, tc_id=edge.source_id,
                    condition_id=edge.transfer_condition_id,
                    outcome=proposal.transfer_result,
                    assessment_version=problem.assessment_version,
                    rubric_version=problem.rubric_version, rubric_dimensions=dimensions,
                ) for edge in graph.edges
                if edge.relation == EdgeRelation.HAS_TRANSFER_PROBE and edge.target_id == problem.id
            ]
        identity = opaque_key("observation", event_id, EXTRACTOR_VERSION, content_hash(proposal.model_dump(mode="json")))
        observations.append(Observation(
            observation_id=identity, scope=scope, event_id=event_id,
            source_evidence=[source.evidence_id], supports=proposal.supports, contradicts=proposal.contradicts,
            claim=proposal.claim, reasoning_result=proposal.reasoning_result,
            rubric_dimensions=dimensions, quotes=[EvidenceQuote(evidence_id=source.evidence_id, quote=proposal.quote)],
            concept_demonstrations=demonstrations, transfer_judgments=transfers,
            confidence=proposal.confidence, extractor_version=EXTRACTOR_VERSION,
            model_version=model_version, prompt_version=PROMPT_VERSION, created_at=now,
        ))
    result = ObservationSet(
        scope=scope, event_id=event_id, extractor_version=EXTRACTOR_VERSION,
        observations=observations, created_at=now,
        observation_set_id=opaque_key("extraction", event_id, EXTRACTOR_VERSION),
    )
    validate_observation_set(result, evidence, graph)
    return result


class FoundryObservationExtractor:
    def __init__(self, model: str, client_factory: Callable | None = None):
        self.model = model
        self._factory = client_factory
        self._client = None
        self._lock = threading.Lock()

    def _get_client(self):
        if self._client is None:
            with self._lock:
                if self._client is None:
                    if self._factory is not None:
                        self._client = self._factory()
                    else:
                        from utils.course_creation import get_creation_client

                        self._client = get_creation_client().get_openai_client().with_options(max_retries=0, timeout=90)
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def extract(self, evidence: list[Evidence], graph: CurriculumGraph, now: datetime) -> ObservationSet:
        if not evidence:
            raise ValueError("Evidence is required for extraction")
        neutral_sources = {
            EvidenceSource.TEACHING_EXPOSURE, EvidenceSource.PROGRESS_PROPOSAL,
            EvidenceSource.EXPLICIT_SELECTION, EvidenceSource.SYSTEM_REVALIDATION,
            EvidenceSource.LEGACY_IMPORT,
        }
        if all(item.source in neutral_sources for item in evidence):
            return ObservationSet(
                scope=evidence[0].scope, event_id=evidence[0].event_id,
                extractor_version=EXTRACTOR_VERSION, created_at=now,
            )
        if not self.model:
            raise ValueError("Configure GRAPH_MEMORY_OBSERVATION_MODEL before processing learner evidence")
        problems = {item.problem_id for item in evidence if item.problem_id}
        catalog = {
            "curriculum_id": graph.curriculum_id, "version": graph.version,
            "misconceptions": [
                {"id": node.id, "name": node.name, "description": node.description}
                for node in graph.nodes if node.type == NodeType.MISCONCEPTION
            ],
            "problems": [node.model_dump(mode="json") for node in graph.nodes if node.id in problems],
        }
        response = self._get_client().responses.parse(
            model=self.model,
            input=[
                {"role": "developer", "content": _PROMPT.read_text(encoding="utf-8")},
                {"role": "user", "content": json.dumps({
                    "TRUSTED_CATALOG": catalog,
                    "UNTRUSTED_LEARNER_EVIDENCE": [
                        {
                            "evidence_id": item.evidence_id, "source": item.source.value,
                            "answer": item.answer, "reasoning": item.reasoning,
                            "problem_id": item.problem_id, "rubric_version": item.rubric_version,
                            "assistance": item.assistance.value, "catalog_approved": item.quality.catalog_approved,
                        } for item in evidence
                    ],
                }, ensure_ascii=False)},
            ],
            text_format=ProposedObservationSet, tools=[], tool_choice="none", store=False,
            max_output_tokens=12000,
        )
        if response.status != "completed" or response.output_parsed is None:
            raise ValueError("Observation extraction did not produce a complete validated result")
        return proposals_to_observations(
            response.output_parsed, evidence, graph, now, model_version=str(response.model or self.model),
        )
