"""Pure sparse reduction. Supply retained facts, not an incremental count delta."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import TypeVar

from backend.schemas.learner_memory import (
    ConceptState,
    ConceptStatus,
    CurriculumGraph,
    EdgeRelation,
    Evidence,
    EvidenceExclusion,
    EvidenceSource,
    LearnerSnapshot,
    MemoryScope,
    MisconceptionState,
    MisconceptionStatus,
    NodeType,
    Observation,
    StateEvidence,
    Trend,
)
from learner_memory.curriculum import validate_graph
from learner_memory.profile import project_learning_profile
from learner_memory.threshold import (
    EvidenceSignal,
    _evaluate_prepared_threshold,
    clearance_coverage,
    concept_signals,
    evaluation_time,
    misconception_signals,
    prepare_facts,
    related_misconception_ids,
    related_tc_ids,
    select_independent,
)

StateT = TypeVar("StateT", bound=StateEvidence)


def _revision(current: StateT, previous: StateT | None, as_of: datetime) -> StateT:
    if previous is None:
        return current
    first_seen = min(
        (value for value in (previous.first_seen_at, current.first_seen_at) if value is not None),
        default=None,
    )
    current = current.model_copy(update={"first_seen_at": first_seen})
    excluded = {"state_version", "updated_at"}
    if current.model_dump(exclude=excluded) == previous.model_dump(exclude=excluded):
        return previous.model_copy(deep=True)
    return current.model_copy(update={"state_version": previous.state_version + 1, "updated_at": as_of})


def _metadata(
    relevant: Sequence[Evidence],
    signals: Sequence[EvidenceSignal],
    graph: CurriculumGraph,
    as_of: datetime,
) -> dict:
    refs = graph.policies.max_state_evidence_refs
    recent = sorted(relevant, key=lambda item: (item.occurred_at, item.event_sequence, item.evidence_id), reverse=True)
    ordered_signals = sorted(
        signals, key=lambda signal: (signal.chronology, signal.observation.observation_id), reverse=True
    )
    qualifying = [signal for signal in ordered_signals if signal.reason is None]
    excluded = [
        EvidenceExclusion(
            evidence_id=signal.evidence.evidence_id, observation_id=signal.observation.observation_id,
            reason=signal.reason,
        )
        for signal in ordered_signals if signal.reason is not None
    ]
    observed_ids = {signal.evidence.evidence_id for signal in signals}
    excluded.extend(
        EvidenceExclusion(evidence_id=item.evidence_id, reason="NO_ACCEPTED_OBSERVATION")
        for item in recent if item.evidence_id not in observed_ids
    )
    return {
        "first_seen_at": min((item.occurred_at for item in relevant), default=None),
        "updated_at": as_of,
        "last_observed_at": max((item.occurred_at for item in relevant), default=None),
        "raw_evidence_count": len({item.evidence_id for item in relevant}),
        "qualifying_evidence_count": len({signal.evidence.evidence_id for signal in qualifying}),
        "independent_context_count": len({signal.context for signal in qualifying}),
        "evidence_ids": [item.evidence_id for item in recent][:refs],
        "observation_ids": list(dict.fromkeys(
            signal.observation.observation_id for signal in ordered_signals
        ))[:refs],
        "excluded_evidence": excluded[:refs],
        "curriculum_version": graph.version,
    }


def _infer_misconception(
    target: str,
    graph: CurriculumGraph,
    evidence: list[Evidence],
    observations: list[Observation],
    as_of: datetime,
) -> MisconceptionState | None:
    cited = {
        key for observation in observations if target in observation.supports + observation.contradicts
        for key in observation.source_evidence
    }
    relevant = [
        item for item in evidence
        if target in related_misconception_ids(graph, item) or item.evidence_id in cited
    ]
    if not relevant:
        return None
    policy = graph.policies
    signals = misconception_signals(target, graph, evidence, observations, as_of)
    coverage = clearance_coverage(signals, policy, as_of)
    historical_support = [
        signal for signal in signals if signal.kind == "SUPPORTS" and signal.historically_qualified
    ]
    historical_clearing = select_independent([
        signal for signal in signals if signal.kind == "CONTRADICTS" and signal.historically_qualified
    ], policy)
    latest_clearing = max((signal.chronology for signal in historical_clearing), default=None)
    regressing = bool(
        len(historical_clearing) >= policy.min_clearance_independent_probes
        and latest_clearing is not None
        and any(signal.chronology > latest_clearing for signal in coverage.support)
    )
    if coverage.satisfied:
        state = MisconceptionStatus.CLEARED
        trend = Trend.IMPROVING if historical_support else Trend.STABLE
        reasons = ["QUALIFYING_CLEARANCE"]
        confidence_signals = coverage.clearing
    elif coverage.clearing and historical_support:
        state, trend = MisconceptionStatus.RESOLVING, Trend.IMPROVING
        reasons = ["INDEPENDENT_CLEARING_COVERAGE_INCOMPLETE"]
        if coverage.recent_support:
            reasons.append("RECENT_STRONG_SUPPORT")
        confidence_signals = coverage.clearing
    elif len(coverage.support) >= policy.min_present_independent_support:
        state = MisconceptionStatus.PRESENT
        trend = Trend.DECLINING if historical_clearing else Trend.STABLE
        reasons = ["INDEPENDENT_STRONG_SUPPORT"]
        confidence_signals = coverage.support
    elif regressing:
        state, trend = MisconceptionStatus.RESOLVING, Trend.DECLINING
        reasons = ["REGRESSION_SUPPORT"]
        confidence_signals = coverage.support
    elif any(
        signal.kind == "SUPPORTS" and signal.expires_at > as_of for signal in signals
    ):
        state, trend = MisconceptionStatus.SUSPECTED, Trend.UNKNOWN
        reasons = ["SUPPORT_BELOW_PRESENT_REQUIREMENTS"]
        confidence_signals = coverage.support
    else:
        state, trend = MisconceptionStatus.INSUFFICIENT_EVIDENCE, Trend.UNKNOWN
        reasons = ["INDEPENDENT_CLEARING_COVERAGE_INCOMPLETE" if coverage.clearing else "NO_QUALIFYING_DIAGNOSIS"]
        confidence_signals = coverage.clearing
    boundaries = [signal.expires_at for signal in signals if signal.expires_at > as_of]
    if coverage.next_revalidation_at is not None:
        boundaries.append(coverage.next_revalidation_at)
    return MisconceptionState(
        misconception_id=target, state=state, trend=trend, reason_codes=reasons,
        confidence=min((signal.observation.confidence for signal in confidence_signals), default=0.0),
        policy_version=policy.misconception_policy_version,
        direct_probe_count=len({item.evidence_id for item in relevant if item.problem_id}),
        qualifying_clearing_count=len(coverage.clearing),
        clearing_context_count=len({signal.context for signal in coverage.clearing}),
        clearing_family_count=len({signal.evidence.family_id for signal in coverage.clearing}),
        coverage_eligible=coverage.satisfied,
        qualifying_clearing_evidence_ids=[
            signal.evidence.evidence_id for signal in coverage.clearing
        ][:policy.max_state_evidence_refs],
        qualifying_support_evidence_ids=[
            signal.evidence.evidence_id for signal in coverage.support
        ][:policy.max_state_evidence_refs],
        next_revalidation_at=min(boundaries, default=None),
        **_metadata(relevant, signals, graph, as_of),
    )


def _infer_concept(
    tc_id: str,
    graph: CurriculumGraph,
    evidence: list[Evidence],
    observations: list[Observation],
    as_of: datetime,
) -> ConceptState | None:
    cited = {
        key for observation in observations
        if any(item.tc_id == tc_id for item in observation.concept_demonstrations)
        for key in observation.source_evidence
    }
    relevant = [
        item for item in evidence if tc_id in related_tc_ids(graph, item) or item.evidence_id in cited
    ]
    if not relevant:
        return None
    policy = graph.policies
    tc = next(node for node in graph.nodes if node.id == tc_id)
    required_dimensions = {dimension.id for dimension in tc.rubric_dimensions if dimension.required}
    signals = concept_signals(tc_id, graph, evidence, observations, as_of)
    historical_failures = [
        signal for signal in signals if signal.kind == "FAIL" and signal.historically_qualified
    ]
    last_failure = max((signal.chronology for signal in historical_failures), default=None)
    passes = select_independent([
        signal for signal in signals if signal.kind == "PASS" and signal.reason is None
        and (last_failure is None or signal.chronology > last_failure)
    ], policy)
    failures = select_independent([
        signal for signal in signals if signal.kind == "FAIL" and signal.reason is None
    ], policy)
    dimensions = set().union(*(signal.dimensions for signal in passes)) & required_dimensions
    coverage = len(dimensions) / len(required_dimensions) if required_dimensions else 0.0
    if (
        len(passes) >= policy.min_mastery_independent_demonstrations and required_dimensions
        and coverage >= policy.min_mastery_rubric_coverage
    ):
        state, reasons = ConceptStatus.MASTERED, ["INDEPENDENT_RUBRIC_DEMONSTRATIONS"]
        trend = Trend.IMPROVING if historical_failures else Trend.STABLE
        confidence_signals = passes
    elif passes:
        state, reasons = ConceptStatus.PROGRESSING, ["DEMONSTRATION_COVERAGE_INCOMPLETE"]
        trend = Trend.IMPROVING if historical_failures else Trend.UNKNOWN
        confidence_signals = passes
    elif len(failures) >= policy.min_struggle_independent_failures:
        state, reasons = ConceptStatus.STRUGGLING, ["INDEPENDENT_RUBRIC_FAILURES"]
        trend = Trend.DECLINING
        confidence_signals = failures
    else:
        state, reasons = ConceptStatus.INSUFFICIENT_EVIDENCE, ["NO_SUFFICIENT_DEMONSTRATIONS"]
        trend, confidence_signals = Trend.UNKNOWN, failures
    if not required_dimensions:
        reasons.append("MASTERY_RUBRIC_UNCONFIGURED")
    return ConceptState(
        tc_id=tc_id, state=state, trend=trend, reason_codes=reasons,
        confidence=min((signal.observation.confidence for signal in confidence_signals), default=0.0),
        rubric_coverage=coverage, demonstrated_dimensions=sorted(dimensions),
        demonstration_count=len(passes), failure_count=len(failures),
        policy_version=policy.concept_policy_version,
        next_revalidation_at=min((
            signal.expires_at for signal in signals if signal.expires_at > as_of
        ), default=None),
        **_metadata(relevant, signals, graph, as_of),
    )


def reduce_learner_state(
    scope: MemoryScope,
    graph: CurriculumGraph,
    evidence: list[Evidence],
    observations: list[Observation],
    previous: LearnerSnapshot | None,
    as_of: datetime,
    affected_tc_ids: list[str] | None = None,
) -> LearnerSnapshot:
    """Recompute affected layers and their profile with one recorded evaluation clock.

    The caller must supply the retained accepted facts for affected targets. Prior
    labels never replace qualifying evidence. Persistence owns atomic publication
    and verifies that the event watermark is contiguous.
    """
    as_of = evaluation_time(as_of)
    graph = validate_graph(graph)
    if previous is not None and previous.scope != scope:
        raise ValueError("Previous snapshot has a different scope/version/learning epoch")
    if previous is not None and as_of < previous.as_of:
        raise ValueError("Evaluation time cannot precede the previous snapshot")
    evidence, observations = prepare_facts(scope, graph, evidence, observations, as_of)
    evidence = [item for item in evidence if item.source != EvidenceSource.SYSTEM_REVALIDATION]
    evidence_ids = {item.evidence_id for item in evidence}
    observations = [
        item for item in observations if all(key in evidence_ids for key in item.source_evidence)
    ]
    tcs = {node.id for node in graph.nodes if node.type == NodeType.TC and node.active}
    misconceptions = {
        node.id for node in graph.nodes if node.type == NodeType.MISCONCEPTION and node.active
    }
    if affected_tc_ids is not None and not set(affected_tc_ids) <= tcs:
        raise ValueError("Affected targets include an unknown or retired TC")
    policy_changed = previous is not None and previous.policy_version != graph.policies.version
    full = affected_tc_ids is None or policy_changed or previous is None
    old = previous if previous is not None else LearnerSnapshot(scope=scope)
    if full:
        affected = set(old.concept_states) | set(old.threshold_states)
        affected_misconceptions = set(old.misconception_states)
        for item in evidence:
            affected.update(related_tc_ids(graph, item))
            affected_misconceptions.update(related_misconception_ids(graph, item))
        for observation in observations:
            affected.update(item.tc_id for item in observation.concept_demonstrations)
            affected.update(item.tc_id for item in observation.transfer_judgments if item.tc_id)
            affected_misconceptions.update(observation.supports + observation.contradicts)
    else:
        affected = set(affected_tc_ids)
        affected_misconceptions = set()
    if not full:
        for key, state in old.threshold_states.items():
            if state.next_revalidation_at is not None and state.next_revalidation_at <= as_of:
                affected.add(key)
        for key, state in old.concept_states.items():
            if state.next_revalidation_at is not None and state.next_revalidation_at <= as_of:
                affected.add(key)
    for target, state in old.misconception_states.items():
        if state.next_revalidation_at is not None and state.next_revalidation_at <= as_of:
            affected_misconceptions.add(target)
    changed = True
    while changed:
        before = (len(affected), len(affected_misconceptions))
        for edge in graph.edges:
            if edge.relation == EdgeRelation.ASSOCIATED_WITH:
                if edge.target_id in affected:
                    affected_misconceptions.add(edge.source_id)
                if edge.source_id in affected_misconceptions:
                    affected.add(edge.target_id)
        changed = before != (len(affected), len(affected_misconceptions))
    m_states = {
        key: value.model_copy(deep=True) for key, value in old.misconception_states.items()
        if key in misconceptions and key not in affected_misconceptions
    }
    c_states = {
        key: value.model_copy(deep=True) for key, value in old.concept_states.items()
        if key in tcs and key not in affected
    }
    t_states = {
        key: value.model_copy(deep=True) for key, value in old.threshold_states.items()
        if key in tcs and key not in affected
    }
    for target in sorted(affected_misconceptions & misconceptions):
        result = _infer_misconception(target, graph, evidence, observations, as_of)
        if result is not None:
            m_states[target] = _revision(result, old.misconception_states.get(target), as_of)
    for tc_id in sorted(affected & tcs):
        concept = _infer_concept(tc_id, graph, evidence, observations, as_of)
        if concept is not None:
            c_states[tc_id] = _revision(concept, old.concept_states.get(tc_id), as_of)
        relevant_m = {
            edge.source_id for edge in graph.edges
            if edge.relation == EdgeRelation.ASSOCIATED_WITH and edge.target_id == tc_id
        }
        active = concept is not None or any(target in m_states for target in relevant_m)
        if not active:
            continue
        threshold = _evaluate_prepared_threshold(
            tc_id, graph, m_states, evidence, observations, as_of, has_activity=active
        )
        t_states[tc_id] = _revision(threshold, old.threshold_states.get(tc_id), as_of)
    next_revalidation = min((
        state.next_revalidation_at
        for collection in (m_states, c_states, t_states) for state in collection.values()
        if state.next_revalidation_at is not None and state.next_revalidation_at > as_of
    ), default=None)
    snapshot = LearnerSnapshot(
        scope=scope, snapshot_version=old.snapshot_version + 1,
        last_processed_sequence=max(
            [old.last_processed_sequence] + [item.event_sequence for item in evidence]
        ),
        as_of=as_of, next_revalidation_at=next_revalidation,
        misconception_states=dict(sorted(m_states.items())),
        concept_states=dict(sorted(c_states.items())),
        threshold_states=dict(sorted(t_states.items())),
        policy_version=graph.policies.version,
        profile=old.profile.model_copy(deep=True),
    )
    return snapshot.model_copy(update={
        "profile": project_learning_profile(snapshot, graph, evidence),
    })
