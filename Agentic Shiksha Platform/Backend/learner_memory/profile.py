"""The Learning Profile is a projection, never an independent source of learner truth."""

from __future__ import annotations

from backend.schemas.learner_memory import (
    ConceptStatus,
    CurriculumGraph,
    EdgeRelation,
    Evidence,
    EvidenceSource,
    LearnerSnapshot,
    LearningProfile,
    MisconceptionStatus,
    NodeType,
    ProbeRecommendation,
    ProfileMisconception,
    ThresholdStatus,
    TransferStatus,
    Trend,
)
from learner_memory.curriculum import prerequisite_ids
from learner_memory.threshold import related_tc_ids, validate_scope


def project_learning_profile(
    snapshot: LearnerSnapshot,
    graph: CurriculumGraph,
    evidence: list[Evidence] | None = None,
) -> LearningProfile:
    validate_scope(snapshot.scope, graph)
    nodes = {node.id: node for node in graph.nodes}
    facts = []
    for item in evidence or []:
        if item.scope != snapshot.scope:
            raise ValueError("Profile evidence has a different scope")
        if item.occurred_at <= snapshot.as_of and item.source != EvidenceSource.SYSTEM_REVALIDATION:
            facts.append(item)
    active = snapshot.profile.active_tc
    if active not in nodes or (active is not None and nodes[active].type != NodeType.TC):
        active = None
    for item in sorted(facts, key=lambda value: (value.occurred_at, value.event_sequence, value.evidence_id)):
        relevant = [
            target for target in item.tc_ids
            if target in nodes and nodes[target].type == NodeType.TC and nodes[target].active
        ] or sorted(
            target for target in related_tc_ids(graph, item)
            if target in nodes and nodes[target].active
        )
        if relevant:
            active = relevant[0]

    def fresh(state) -> bool:
        return state.next_revalidation_at is None or state.next_revalidation_at > snapshot.as_of

    strong = sorted(
        target for target, state in snapshot.concept_states.items()
        if state.state == ConceptStatus.MASTERED and fresh(state)
    )
    weak = sorted(
        target for target, state in snapshot.concept_states.items()
        if state.state == ConceptStatus.STRUGGLING and fresh(state)
    )
    crossed = sorted(
        target for target, state in snapshot.threshold_states.items()
        if state.state == ThresholdStatus.CROSSED and fresh(state)
    )
    candidates = sorted(
        target for target, state in snapshot.threshold_states.items()
        if state.state == ThresholdStatus.CANDIDATE
        or (state.state == ThresholdStatus.CROSSED and not fresh(state))
    )
    unresolved = [
        target for target in prerequisite_ids(graph, active) if target not in crossed
    ] if active else []
    active_misconceptions = {
        target: ProfileMisconception(state=state.state, trend=state.trend)
        for target, state in sorted(snapshot.misconception_states.items())
        if state.state in (
            MisconceptionStatus.SUSPECTED, MisconceptionStatus.PRESENT, MisconceptionStatus.RESOLVING,
        ) and fresh(state)
    }
    trends = {
        state.trend for collection in (snapshot.misconception_states, snapshot.concept_states)
        for state in collection.values() if fresh(state)
    }
    trend = (
        Trend.DECLINING if Trend.DECLINING in trends
        else Trend.IMPROVING if Trend.IMPROVING in trends
        else Trend.STABLE if Trend.STABLE in trends else Trend.UNKNOWN
    )
    recommendation = None
    used_families = {item.family_id for item in facts if item.family_id}
    targets = list(dict.fromkeys(unresolved + ([active] if active else []) + candidates))
    for tc_id in targets:
        missing = tc_id not in snapshot.concept_states and tc_id not in snapshot.threshold_states
        associations = sorted((
            edge for edge in graph.edges if edge.relation == EdgeRelation.ASSOCIATED_WITH
            and edge.target_id == tc_id and edge.required_for_crossing is True
        ), key=lambda edge: (-edge.pedagogical_priority, edge.source_id))
        for edge in associations:
            state = snapshot.misconception_states.get(edge.source_id)
            if state is not None and state.state == MisconceptionStatus.CLEARED and state.coverage_eligible and fresh(state):
                continue
            problems = sorted({
                relation.source_id for relation in graph.edges
                if relation.relation == EdgeRelation.DIAGNOSES and relation.target_id == edge.source_id
                and relation.reviewed and nodes[relation.source_id].diagnostic_approved
                and nodes[relation.source_id].active
                and nodes[relation.source_id].family_id not in used_families
            })
            recommendation = ProbeRecommendation(
                tc_id=tc_id, misconception_id=edge.source_id,
                problem_id=problems[0] if problems else None,
                reason_code="DIAGNOSTIC_GAP" if missing else "INDEPENDENT_DIAGNOSTIC_REQUIRED",
            )
            break
        if recommendation is not None:
            break
        threshold = snapshot.threshold_states.get(tc_id)
        if threshold is not None:
            for condition in threshold.transfers.values():
                if condition.state != TransferStatus.PASS or not fresh(condition):
                    recommendation = ProbeRecommendation(
                        tc_id=tc_id, problem_id=condition.problem_id, reason_code="TRANSFER_REQUIRED"
                    )
                    break
        if recommendation is not None:
            break
        if missing:
            recommendation = ProbeRecommendation(tc_id=tc_id, reason_code="DIAGNOSTIC_GAP")
            break
    return LearningProfile(
        active_tc=active, strong_tcs=strong, weak_tcs=weak, candidate_tcs=candidates, crossed_tcs=crossed,
        active_misconceptions=active_misconceptions, unresolved_prerequisites=unresolved,
        learning_trend=trend, next_recommended_probe=recommendation,
        curriculum_id=graph.curriculum_id, curriculum_version=graph.version, policy_version=graph.policies.version,
        snapshot_version=snapshot.snapshot_version, evidence_watermark=snapshot.last_processed_sequence,
        updated_at=snapshot.as_of, next_revalidation_at=snapshot.next_revalidation_at,
        needs_revalidation=(
            snapshot.next_revalidation_at is not None and snapshot.next_revalidation_at <= snapshot.as_of
        ),
    )
