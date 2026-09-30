"""Evidence qualification and deterministic, non-vacuous threshold evaluation."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone

from backend.schemas.learner_memory import (
    AnswerKeySource,
    ConceptDemonstration,
    CurriculumEdge,
    CurriculumGraph,
    CurriculumNode,
    DemonstrationResult,
    EdgeRelation,
    Evidence,
    EvidencePolarity,
    MemoryScope,
    MisconceptionState,
    MisconceptionStatus,
    NodeType,
    Observation,
    PolicySet,
    ReasoningResult,
    RubricScore,
    ThresholdState,
    ThresholdStatus,
    TransferState,
    TransferStatus,
)
from learner_memory.curriculum import validate_graph


def evaluation_time(as_of: datetime) -> datetime:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("Evaluation requires an explicit timezone-aware as_of")
    return as_of.astimezone(timezone.utc)


def validate_scope(scope: MemoryScope, graph: CurriculumGraph) -> None:
    if (
        scope.tenant_id != graph.tenant_id or scope.curriculum_id != graph.curriculum_id
        or scope.curriculum_version != graph.version or scope.institute_id not in graph.institute_ids
        or (graph.course_ids and scope.course_id not in graph.course_ids)
    ):
        raise ValueError("Learner scope does not match the pinned curriculum/version/grants")


def prepare_facts(
    scope: MemoryScope,
    graph: CurriculumGraph,
    evidence: Sequence[Evidence],
    observations: Sequence[Observation],
    as_of: datetime,
) -> tuple[list[Evidence], list[Observation]]:
    """Reject cross-scope/ambiguous facts; apply edits and observation-time ordering."""
    validate_scope(scope, graph)
    nodes = {node.id: node for node in graph.nodes}
    by_id: dict[str, Evidence] = {}
    for item in evidence:
        if item.scope != scope:
            raise ValueError("Evidence belongs to a different learner scope/version/epoch")
        if item.evidence_id in by_id and by_id[item.evidence_id] != item:
            raise ValueError(f"Conflicting evidence ID: {item.evidence_id}")
        by_id[item.evidence_id] = item
        for target in item.tc_ids:
            if target not in nodes or nodes[target].type != NodeType.TC:
                raise ValueError(f"Unknown TC evidence target: {target}")
        for target in item.misconception_ids:
            if target not in nodes or nodes[target].type != NodeType.MISCONCEPTION:
                raise ValueError(f"Unknown misconception evidence target: {target}")
        if item.problem_id is not None and (
            item.problem_id not in nodes or nodes[item.problem_id].type != NodeType.PROBLEM
        ):
            raise ValueError(f"Unknown problem evidence target: {item.problem_id}")
    observed = {key: value for key, value in by_id.items() if value.occurred_at <= as_of}
    superseded = {item.supersedes_event_id for item in observed.values() if item.supersedes_event_id}
    available = {key: value for key, value in observed.items() if value.event_id not in superseded}
    accepted: dict[str, Observation] = {}
    for observation in observations:
        if observation.scope != scope:
            raise ValueError("Observation belongs to a different learner scope/version/epoch")
        if observation.observation_id in accepted and accepted[observation.observation_id] != observation:
            raise ValueError(f"Conflicting observation ID: {observation.observation_id}")
        if any(key not in by_id for key in observation.source_evidence):
            raise ValueError(f"Observation {observation.observation_id} has dangling evidence")
        for target in observation.supports + observation.contradicts:
            if target not in nodes or nodes[target].type != NodeType.MISCONCEPTION:
                raise ValueError(f"Unknown misconception observation target: {target}")
        for demonstration in observation.concept_demonstrations:
            if demonstration.tc_id not in nodes or nodes[demonstration.tc_id].type != NodeType.TC:
                raise ValueError(f"Unknown concept demonstration target: {demonstration.tc_id}")
        for judgment in observation.transfer_judgments:
            if judgment.problem_id not in nodes or nodes[judgment.problem_id].type != NodeType.PROBLEM:
                raise ValueError(f"Unknown transfer judgment target: {judgment.problem_id}")
            if judgment.tc_id is not None and (
                judgment.tc_id not in nodes or nodes[judgment.tc_id].type != NodeType.TC
            ):
                raise ValueError(f"Unknown transfer TC target: {judgment.tc_id}")
        if all(key in available for key in observation.source_evidence):
            accepted[observation.observation_id] = observation
    return (
        sorted(available.values(), key=lambda item: (item.occurred_at, item.event_sequence, item.evidence_id)),
        sorted(accepted.values(), key=lambda item: item.observation_id),
    )


def related_tc_ids(graph: CurriculumGraph, evidence: Evidence) -> set[str]:
    targets = set(evidence.tc_ids)
    misconceptions = set(evidence.misconception_ids)
    for edge in graph.edges:
        if evidence.problem_id == edge.source_id and edge.relation == EdgeRelation.TESTS:
            targets.add(edge.target_id)
        if evidence.problem_id == edge.target_id and edge.relation in (
            EdgeRelation.HAS_PROBLEM, EdgeRelation.HAS_TRANSFER_PROBE,
        ):
            targets.add(edge.source_id)
        if evidence.problem_id == edge.source_id and edge.relation == EdgeRelation.DIAGNOSES:
            misconceptions.add(edge.target_id)
    for edge in graph.edges:
        if edge.relation == EdgeRelation.ASSOCIATED_WITH and edge.source_id in misconceptions:
            targets.add(edge.target_id)
    return targets


def related_misconception_ids(graph: CurriculumGraph, evidence: Evidence) -> set[str]:
    return set(evidence.misconception_ids) | {
        edge.target_id for edge in graph.edges
        if edge.relation == EdgeRelation.DIAGNOSES and edge.source_id == evidence.problem_id
    }


@dataclass(frozen=True)
class EvidenceSignal:
    evidence: Evidence
    observation: Observation
    kind: str
    reason: str | None
    expires_at: datetime
    dimensions: frozenset[str] = frozenset()

    @property
    def chronology(self) -> tuple[datetime, int, str]:
        return self.evidence.occurred_at, self.evidence.event_sequence, self.evidence.evidence_id

    @property
    def historically_qualified(self) -> bool:
        return self.reason in (None, "EVIDENCE_STALE")

    @property
    def context(self) -> str | None:
        return (
            self.evidence.context_id or self.evidence.independence_key
            or self.evidence.assessment_instance_id
        )

    @property
    def lineage(self) -> str:
        return (
            self.evidence.lineage_id or self.evidence.source_id
            or self.evidence.event_id
        )


def select_independent(
    signals: Sequence[EvidenceSignal], policy: PolicySet
) -> list[EvidenceSignal]:
    """A conservative deterministic subset, never counts retries or one summary twice."""
    selected = []
    lineages: set[str] = set()
    attempts: set[tuple[str | None, str | None]] = set()
    observations: set[str] = set()
    families: set[str | None] = set()
    contexts: set[str | None] = set()
    for signal in sorted(
        signals, key=lambda item: (item.chronology, item.observation.observation_id), reverse=True
    ):
        attempt = (signal.evidence.assessment_instance_id, signal.evidence.problem_id)
        if signal.lineage in lineages or signal.observation.observation_id in observations:
            continue
        if signal.evidence.assessment_instance_id and attempt in attempts:
            continue
        if policy.require_distinct_families and signal.evidence.family_id in families:
            continue
        if policy.require_distinct_contexts and signal.context in contexts:
            continue
        selected.append(signal)
        lineages.add(signal.lineage)
        observations.add(signal.observation.observation_id)
        attempts.add(attempt)
        families.add(signal.evidence.family_id)
        contexts.add(signal.context)
    return selected


def _reject_conflicting_claims(signals: Sequence[EvidenceSignal]) -> list[EvidenceSignal]:
    claims: dict[str, set[str]] = {}
    for signal in signals:
        claims.setdefault(signal.evidence.evidence_id, set()).add(signal.kind)
    return [
        replace(signal, reason="CONFLICTING_OBSERVATIONS")
        if len(claims[signal.evidence.evidence_id]) > 1 else signal
        for signal in signals
    ]


def _texts(evidence: Evidence) -> list[str]:
    answer = evidence.answer
    return [text for text in (
        [answer] if isinstance(answer, str) else list(answer.values()) if isinstance(answer, dict) else []
    ) + [evidence.reasoning or ""] if text]


def _grounding_reason(evidence: Evidence, observation: Observation) -> str | None:
    texts = _texts(evidence)
    quotes = [quote for quote in observation.quotes if quote.evidence_id == evidence.evidence_id]
    if not quotes:
        return "MISSING_SOURCE_QUOTE"
    for quote in quotes:
        if not any(
            quote.quote in text and (
                quote.start is None or text[quote.start:quote.end] == quote.quote
            ) for text in texts
        ):
            return "UNGROUNDED_SOURCE_QUOTE"
    return None


def _scores(
    observation: Observation, target_id: str, extra: Sequence[RubricScore] = ()
) -> dict[str, float]:
    scores: dict[str, float] = {}
    for dimension in (*observation.rubric_dimensions, *extra):
        if dimension.target_id in (None, target_id):
            scores[dimension.dimension_id] = min(
                scores.get(dimension.dimension_id, dimension.score), dimension.score
            )
    return scores


def _rubric_passes(
    problem: CurriculumNode, scores: Mapping[str, float], minimum: float
) -> bool:
    required = {dimension.id for dimension in problem.rubric_dimensions if dimension.required}
    return bool(required) and all(key in scores and scores[key] >= minimum for key in required)


def _base_reason(
    evidence: Evidence,
    observation: Observation,
    graph: CurriculumGraph,
    problem: CurriculumNode | None,
    min_confidence: float,
    *,
    transfer: bool = False,
) -> str | None:
    policy = graph.policies
    if problem is None or problem.type != NodeType.PROBLEM or not problem.active:
        return "NO_ACTIVE_CATALOG_PROBLEM"
    if evidence.source not in policy.qualifying_sources:
        return "NON_DIAGNOSTIC_SOURCE"
    if not evidence.provenance.server_verified:
        return "UNVERIFIED_PROVENANCE"
    if not evidence.quality.catalog_approved or not evidence.quality.provenance:
        return "UNREVIEWED_EVIDENCE_QUALITY"
    if evidence.quality.score < policy.min_evidence_quality:
        return "LOW_EVIDENCE_QUALITY"
    if (not problem.transfer_approved if transfer else not problem.diagnostic_approved):
        return "UNAPPROVED_CATALOG_PROBLEM"
    if (
        problem.catalog_diagnostic_reliability is None
        or problem.catalog_diagnostic_reliability < policy.min_catalog_diagnostic_strength
        or evidence.quality.diagnostic_reliability is None
        or evidence.quality.diagnostic_reliability < policy.min_catalog_diagnostic_strength
    ):
        return "LOW_CATALOG_DIAGNOSTIC_RELIABILITY"
    if evidence.answer_key_source not in policy.qualifying_answer_key_sources:
        return "UNTRUSTED_ANSWER_KEY"
    if (
        evidence.answer_key_source == AnswerKeySource.SERVER_FROZEN_ASSESSMENT
        and (not evidence.assessment_instance_id or not evidence.provenance.assessment_frozen)
    ):
        return "ASSESSMENT_NOT_FROZEN"
    if evidence.assistance not in policy.qualifying_assistance:
        return "ASSISTED_OR_ANSWER_REVEALED"
    for field in ("problem_version", "rubric_id", "rubric_version", "assessment_version", "family_id"):
        if getattr(evidence, field) is None or getattr(evidence, field) != getattr(problem, field):
            return f"{field.upper()}_MISMATCH"
    if not (evidence.context_id or evidence.independence_key or evidence.assessment_instance_id):
        return "MISSING_INDEPENDENCE_CONTEXT"
    if observation.confidence < min_confidence:
        return "LOW_OBSERVATION_CONFIDENCE"
    if observation.extractor_kind == "MODEL" and (
        not observation.model_version or not observation.prompt_version
    ):
        return "MISSING_EXTRACTOR_PROVENANCE"
    return _grounding_reason(evidence, observation)


def _binding_reason(edge: CurriculumEdge | None, problem: CurriculumNode) -> str | None:
    if edge is None or not edge.reviewed:
        return "UNREVIEWED_TARGET_MAPPING"
    if any(
        getattr(edge, key) != getattr(problem, key)
        for key in ("problem_version", "rubric_version", "assessment_version")
    ):
        return "TARGET_MAPPING_VERSION_MISMATCH"
    return None


def misconception_signals(
    misconception_id: str,
    graph: CurriculumGraph,
    evidence: Sequence[Evidence],
    observations: Sequence[Observation],
    as_of: datetime,
) -> list[EvidenceSignal]:
    nodes = {node.id: node for node in graph.nodes}
    evidence_by_id = {item.evidence_id: item for item in evidence}
    mappings = {
        edge.source_id: edge for edge in graph.edges
        if edge.relation == EdgeRelation.DIAGNOSES and edge.target_id == misconception_id
    }
    signals = []
    policy = graph.policies
    for observation in observations:
        kind = (
            "SUPPORTS" if misconception_id in observation.supports
            else "CONTRADICTS" if misconception_id in observation.contradicts else None
        )
        if kind is None:
            continue
        for evidence_id in observation.source_evidence:
            item = evidence_by_id[evidence_id]
            problem = nodes.get(item.problem_id)
            mapping = mappings.get(item.problem_id)
            minimum = (
                policy.min_clearance_confidence if kind == "CONTRADICTS"
                else policy.min_strong_observation_confidence
            )
            reason = _base_reason(item, observation, graph, problem, minimum)
            if reason is None:
                reason = _binding_reason(mapping, problem)
            if reason is None and (
                mapping.diagnostic_strength is None
                or mapping.diagnostic_strength < policy.min_catalog_diagnostic_strength
            ):
                reason = "LOW_MAPPING_DIAGNOSTIC_STRENGTH"
            if reason is None and problem.correct_key and isinstance(item.answer, str):
                expected = (
                    mapping.evidence_if_correct if item.answer == problem.correct_key
                    else mapping.evidence_if_incorrect
                )
                if expected.value != kind:
                    reason = "OUTCOME_MAPPING_MISMATCH"
            if reason is None and kind == "CONTRADICTS":
                if not item.reasoning_available or not item.reasoning:
                    reason = "CLEARANCE_REQUIRES_REASONING"
                elif observation.reasoning_result != ReasoningResult.SATISFIES_RUBRIC:
                    reason = "REASONING_DOES_NOT_SATISFY_RUBRIC"
                elif not _rubric_passes(
                    problem, _scores(observation, misconception_id), policy.min_reasoning_rubric_score
                ):
                    reason = "REASONING_RUBRIC_INCOMPLETE"
                elif mapping.evidence_if_correct != EvidencePolarity.CONTRADICTS:
                    reason = "NO_REVIEWED_CLEARING_SEMANTICS"
            elif reason is None and (mapping.reasoning_required or problem.requires_reasoning):
                if not item.reasoning_available or not item.reasoning:
                    reason = "DIAGNOSIS_REQUIRES_REASONING"
                elif observation.reasoning_result in (ReasoningResult.UNAVAILABLE, ReasoningResult.AMBIGUOUS):
                    reason = "AMBIGUOUS_REASONING"
            expiry = item.occurred_at + timedelta(days=policy.evidence_max_age_days)
            if reason is None and expiry <= as_of:
                reason = "EVIDENCE_STALE"
            signals.append(EvidenceSignal(item, observation, kind, reason, expiry))
    return _reject_conflicting_claims(signals)


@dataclass(frozen=True)
class ClearanceCoverage:
    clearing: tuple[EvidenceSignal, ...]
    support: tuple[EvidenceSignal, ...]
    satisfied: bool
    recent_support: bool
    next_revalidation_at: datetime | None


def clearance_coverage(
    signals: Sequence[EvidenceSignal], policy: PolicySet, as_of: datetime
) -> ClearanceCoverage:
    historical_support = [
        signal for signal in signals if signal.kind == "SUPPORTS" and signal.historically_qualified
    ]
    last_support = max((signal.chronology for signal in historical_support), default=None)
    clearing = select_independent([
        signal for signal in signals if signal.kind == "CONTRADICTS" and signal.reason is None
        and (last_support is None or signal.chronology > last_support)
    ], policy)
    support = select_independent([
        signal for signal in signals if signal.kind == "SUPPORTS" and signal.reason is None
    ], policy)
    recent_support = any(
        signal.evidence.occurred_at + timedelta(days=policy.recent_support_window_days) > as_of
        for signal in historical_support
    )
    satisfied = (
        len(clearing) >= policy.min_clearance_independent_probes
        and len({signal.context for signal in clearing}) >= policy.min_clearance_contexts
        and len({signal.evidence.family_id for signal in clearing}) >= policy.min_clearance_families
        and not recent_support
    )
    boundaries = [signal.expires_at for signal in signals if signal.reason is None]
    boundaries.extend(
        signal.evidence.occurred_at + timedelta(days=policy.recent_support_window_days)
        for signal in historical_support
    )
    return ClearanceCoverage(
        tuple(clearing), tuple(support), satisfied, recent_support,
        min((boundary for boundary in boundaries if boundary > as_of), default=None),
    )


def concept_signals(
    tc_id: str,
    graph: CurriculumGraph,
    evidence: Sequence[Evidence],
    observations: Sequence[Observation],
    as_of: datetime,
) -> list[EvidenceSignal]:
    nodes = {node.id: node for node in graph.nodes}
    by_id = {item.evidence_id: item for item in evidence}
    problems = {
        edge.source_id for edge in graph.edges
        if edge.relation == EdgeRelation.TESTS and edge.target_id == tc_id
    }
    policy = graph.policies
    signals = []
    for observation in observations:
        judgment: ConceptDemonstration | None = next(
            (item for item in observation.concept_demonstrations if item.tc_id == tc_id), None
        )
        if judgment is None:
            continue
        for evidence_id in observation.source_evidence:
            item = by_id[evidence_id]
            problem = nodes.get(item.problem_id)
            reason = _base_reason(item, observation, graph, problem, policy.min_concept_confidence)
            if reason is None and item.problem_id not in problems:
                reason = "NO_CONCEPT_ASSESSMENT_MAPPING"
            if reason is None and judgment.rubric_version != problem.rubric_version:
                reason = "CONCEPT_RUBRIC_VERSION_MISMATCH"
            if reason is None and judgment.result == DemonstrationResult.AMBIGUOUS:
                reason = "AMBIGUOUS_DEMONSTRATION"
            if reason is None and problem.requires_reasoning and (
                not item.reasoning or observation.reasoning_result in (
                    ReasoningResult.UNAVAILABLE, ReasoningResult.AMBIGUOUS,
                )
            ):
                reason = "MISSING_DEMONSTRATED_REASONING"
            scores = _scores(observation, tc_id, judgment.rubric_dimensions)
            dimensions = frozenset(
                key for key, score in scores.items() if score >= policy.min_concept_rubric_score
            )
            if reason is None and judgment.result == DemonstrationResult.PASS:
                if observation.reasoning_result != ReasoningResult.SATISFIES_RUBRIC or not dimensions:
                    reason = "CONCEPT_RUBRIC_INCOMPLETE"
                elif problem.correct_key and item.answer != problem.correct_key:
                    reason = "CONCEPT_ANSWER_MISMATCH"
            expiry = item.occurred_at + timedelta(days=policy.concept_max_age_days)
            if reason is None and expiry <= as_of:
                reason = "EVIDENCE_STALE"
            signals.append(EvidenceSignal(item, observation, judgment.result.value, reason, expiry, dimensions))
    return _reject_conflicting_claims(signals)


def _transfer_state(
    tc_id: str,
    edge: CurriculumEdge,
    graph: CurriculumGraph,
    evidence: Sequence[Evidence],
    observations: Sequence[Observation],
    as_of: datetime,
    clearing_families: set[str | None],
) -> TransferState:
    problem = next(node for node in graph.nodes if node.id == edge.target_id)
    by_id = {item.evidence_id: item for item in evidence}
    policy = graph.policies
    signals: list[EvidenceSignal] = []
    attempted = any(item.problem_id == problem.id for item in evidence)
    for observation in observations:
        for judgment in observation.transfer_judgments:
            if judgment.problem_id != problem.id or judgment.tc_id not in (None, tc_id):
                continue
            if judgment.condition_id != edge.transfer_condition_id:
                continue
            for evidence_id in observation.source_evidence:
                item = by_id[evidence_id]
                if item.problem_id != problem.id:
                    continue
                reason = _base_reason(
                    item, observation, graph, problem, policy.min_transfer_confidence, transfer=True
                )
                if reason is None:
                    reason = _binding_reason(edge, problem)
                if reason is None and (
                    judgment.assessment_version != problem.assessment_version
                    or judgment.rubric_version != problem.rubric_version
                ):
                    reason = "TRANSFER_JUDGMENT_VERSION_MISMATCH"
                if reason is None and judgment.outcome not in (TransferStatus.PASS, TransferStatus.FAIL):
                    reason = "AMBIGUOUS_TRANSFER"
                if reason is None and policy.require_novel_transfer_family and item.family_id in clearing_families:
                    reason = "TRANSFER_FAMILY_NOT_NOVEL"
                if reason is None and judgment.outcome == TransferStatus.PASS:
                    if (
                        not item.reasoning or observation.reasoning_result != ReasoningResult.SATISFIES_RUBRIC
                        or not _rubric_passes(
                            problem, _scores(observation, tc_id, judgment.rubric_dimensions),
                            policy.min_transfer_rubric_score,
                        )
                    ):
                        reason = "TRANSFER_REASONING_RUBRIC_INCOMPLETE"
                    elif problem.correct_key and item.answer != problem.correct_key:
                        reason = "TRANSFER_ANSWER_MISMATCH"
                expiry = item.occurred_at + timedelta(days=policy.transfer_max_age_days)
                if reason is None and expiry <= as_of:
                    reason = "EVIDENCE_STALE"
                signals.append(EvidenceSignal(item, observation, judgment.outcome.value, reason, expiry))
    signals = _reject_conflicting_claims(signals)
    valid = [signal for signal in signals if signal.reason is None]
    failures = [signal for signal in valid if signal.kind == TransferStatus.FAIL]
    last_failure = max((signal.chronology for signal in failures), default=None)
    passes = select_independent([
        signal for signal in valid if signal.kind == TransferStatus.PASS
        and (last_failure is None or signal.chronology > last_failure)
    ], policy)
    latest = max(valid, key=lambda signal: signal.chronology, default=None)
    if len(passes) >= policy.min_transfer_independent_passes:
        state, reasons = TransferStatus.PASS, []
    elif latest is not None and latest.kind == TransferStatus.FAIL:
        state, reasons = TransferStatus.FAIL, ["TRANSFER_FAILED"]
    elif attempted or signals:
        state, reasons = TransferStatus.INSUFFICIENT_EVIDENCE, ["TRANSFER_INSUFFICIENT_EVIDENCE"]
    else:
        state, reasons = TransferStatus.NOT_ATTEMPTED, ["TRANSFER_MISSING"]
    reasons.extend(sorted({signal.reason for signal in signals if signal.reason}))
    return TransferState(
        problem_id=problem.id, condition_id=edge.transfer_condition_id, state=state,
        assessment_version=problem.assessment_version, rubric_version=problem.rubric_version,
        evidence_ids=sorted({signal.evidence.evidence_id for signal in valid})[:policy.max_state_evidence_refs],
        observation_ids=sorted({signal.observation.observation_id for signal in valid})[:policy.max_state_evidence_refs],
        next_revalidation_at=min((signal.expires_at for signal in valid), default=None),
        reason_codes=reasons,
    )


def evaluate_threshold(
    tc_id: str,
    graph: CurriculumGraph,
    misconception_states: Mapping[str, MisconceptionState],
    evidence: list[Evidence],
    observations: list[Observation],
    as_of: datetime,
    *,
    scope: MemoryScope | None = None,
    has_activity: bool | None = None,
) -> ThresholdState:
    """Recheck every required target against facts, not just stored CLEARED labels.

    Concept mastery and prerequisite crossing deliberately are not additional gates.
    """
    as_of = evaluation_time(as_of)
    graph = validate_graph(graph)
    scope = scope or (evidence[0].scope if evidence else observations[0].scope if observations else None)
    if scope is not None:
        evidence, observations = prepare_facts(scope, graph, evidence, observations, as_of)
    return _evaluate_prepared_threshold(
        tc_id, graph, misconception_states, evidence, observations, as_of, has_activity=has_activity
    )


def _evaluate_prepared_threshold(
    tc_id: str,
    graph: CurriculumGraph,
    misconception_states: Mapping[str, MisconceptionState],
    evidence: list[Evidence],
    observations: list[Observation],
    as_of: datetime,
    *,
    has_activity: bool | None = None,
) -> ThresholdState:
    """Internal batch path; the reducer already validated graph, scope, and facts."""
    tc = next((node for node in graph.nodes if node.id == tc_id and node.type == NodeType.TC), None)
    if tc is None or not tc.active:
        raise ValueError(f"Threshold target is not an active TC: {tc_id}")
    policy = graph.policies
    required = sorted({
        edge.source_id for edge in graph.edges
        if edge.relation == EdgeRelation.ASSOCIATED_WITH and edge.target_id == tc_id
        and edge.required_for_crossing is True
    })
    relevant = [item for item in evidence if tc_id in related_tc_ids(graph, item)]
    if has_activity is None:
        has_activity = bool(relevant) or any(
            target in misconception_states
            and misconception_states[target].state != MisconceptionStatus.NOT_ASSESSED for target in required
        )
    reasons: list[str] = []
    if not has_activity:
        reasons.append("NO_EVIDENCE")
    if not graph.published_ready:
        reasons.append("GRAPH_NOT_PUBLISHED")
    if not policy.teacher_reviewed:
        reasons.append("POLICY_NOT_REVIEWED")
    if not required:
        reasons.append("NO_REQUIRED_MISCONCEPTIONS")
    cleared = covered = 0
    all_clearing: list[EvidenceSignal] = []
    boundaries: list[datetime] = []
    for target in required:
        state = misconception_states.get(target)
        signals = misconception_signals(target, graph, evidence, observations, as_of)
        coverage = clearance_coverage(signals, policy, as_of)
        if coverage.next_revalidation_at is not None:
            boundaries.append(coverage.next_revalidation_at)
        if state is not None and state.state == MisconceptionStatus.CLEARED:
            cleared += 1
            if (
                coverage.satisfied and state.policy_version == policy.misconception_policy_version
                and state.curriculum_version == graph.version
            ):
                covered += 1
                all_clearing.extend(coverage.clearing)
        elif state is not None and state.state == MisconceptionStatus.PRESENT:
            reasons.append("REQUIRED_MISCONCEPTION_PRESENT")
    if cleared != len(required):
        reasons.append("REQUIRED_MISCONCEPTION_NOT_CLEARED")
    required_coverage = covered / len(required) if required else 0.0
    sufficient = bool(required) and required_coverage == policy.required_misconception_coverage
    if not sufficient:
        reasons.append("REQUIRED_COVERAGE_INCOMPLETE")
    transfer_edges = sorted((
        edge for edge in graph.edges if edge.relation == EdgeRelation.HAS_TRANSFER_PROBE
        and edge.source_id == tc_id and edge.required_for_crossing is True
    ), key=lambda edge: (edge.transfer_condition_id or edge.target_id, edge.id))
    transfers: dict[str, TransferState] = {}
    for edge in transfer_edges:
        key = edge.transfer_condition_id or edge.target_id
        transfers[key] = _transfer_state(
            tc_id, edge, graph, evidence, observations, as_of,
            {signal.evidence.family_id for signal in all_clearing},
        )
        if transfers[key].next_revalidation_at is not None:
            boundaries.append(transfers[key].next_revalidation_at)
    if transfers and all(item.state == TransferStatus.PASS for item in transfers.values()):
        transfer = TransferStatus.PASS
    elif any(item.state == TransferStatus.FAIL for item in transfers.values()):
        transfer = TransferStatus.FAIL
        reasons.append("TRANSFER_FAILED")
    elif any(item.state != TransferStatus.NOT_ATTEMPTED for item in transfers.values()):
        transfer = TransferStatus.INSUFFICIENT_EVIDENCE
        reasons.append("TRANSFER_INSUFFICIENT_EVIDENCE")
    elif not transfers and not policy.require_transfer_for_crossing:
        transfer = TransferStatus.PASS
    else:
        transfer = TransferStatus.NOT_ATTEMPTED
        reasons.append("TRANSFER_MISSING")
    if not reasons and sufficient and transfer == TransferStatus.PASS:
        status = ThresholdStatus.CROSSED
    elif has_activity:
        status = ThresholdStatus.CANDIDATE
    else:
        status = ThresholdStatus.NOT_CROSSED
    refs = policy.max_state_evidence_refs
    return ThresholdState(
        tc_id=tc_id, state=status, required_total=len(required), required_cleared=cleared,
        required_covered=covered, required_coverage=required_coverage, evidence_sufficient=sufficient,
        transfer_state=transfer, transfers=transfers, reason_codes=list(dict.fromkeys(reasons)),
        policy_version=policy.threshold_policy_version, curriculum_version=graph.version, updated_at=as_of,
        first_seen_at=min((item.occurred_at for item in relevant), default=None),
        last_observed_at=max((item.occurred_at for item in relevant), default=None),
        raw_evidence_count=len(relevant), qualifying_evidence_count=len({
            signal.evidence.evidence_id for signal in all_clearing
        }), independent_context_count=len({signal.context for signal in all_clearing}),
        evidence_ids=[item.evidence_id for item in reversed(relevant)][:refs],
        observation_ids=sorted({
            signal.observation.observation_id for signal in all_clearing
        })[:refs],
        next_revalidation_at=min((time for time in boundaries if time > as_of), default=None),
    )
