from datetime import datetime, timedelta, timezone

import pytest

from backend.schemas.learner_memory import (
    Assistance,
    ConceptDemonstration,
    ConceptStatus,
    CurriculumEdge,
    CurriculumGraph,
    CurriculumNode,
    DemonstrationResult,
    EdgeRelation,
    Evidence,
    EvidencePolarity,
    EvidenceProvenance,
    EvidenceQuality,
    EvidenceQuote,
    EvidenceSource,
    LearnerSnapshot,
    MemoryScope,
    MisconceptionState,
    MisconceptionStatus,
    NodeType,
    Observation,
    PolicySet,
    ProblemOption,
    PublicationStatus,
    ReasoningResult,
    RubricDimension,
    RubricScore,
    TaskType,
    ThresholdRelevance,
    ThresholdStatus,
    TransferJudgment,
    TransferStatus,
    Trend,
)
from learner_memory.curriculum import validate_graph
from learner_memory.profile import project_learning_profile
from learner_memory.state import reduce_learner_state
from learner_memory.threshold import evaluate_threshold

NOW = datetime(2026, 2, 1, tzinfo=timezone.utc)
SCOPE = MemoryScope(
    tenant_id="tenant-test", institute_id="institute-test", course_id="offering",
    student_id="learner-test", curriculum_id="curriculum", curriculum_version="v1",
)


def published_graph(misconceptions=("M1",), transfers=("T1",)):
    policy = PolicySet(teacher_reviewed=True, reviewed_by="teacher-test", reviewed_at=NOW - timedelta(days=60))
    rubric = (RubricDimension(id="reasoning", description="Explain the defining distinction."),)
    nodes = [
        CurriculumNode(type=NodeType.COURSE, id="course", name="Synthetic graph course"),
        CurriculumNode(
            type=NodeType.TC, id="TC8", name="Walks and paths", rubric_dimensions=rubric,
            crossing_policy_version=policy.threshold_policy_version,
        ),
    ]
    edges = [CurriculumEdge(source_id="course", target_id="TC8", relation=EdgeRelation.HAS_THRESHOLD)]
    for target in misconceptions:
        nodes.append(CurriculumNode(type=NodeType.MISCONCEPTION, id=target, name=f"Wrong belief {target}"))
        edges.append(CurriculumEdge(
            source_id=target, target_id="TC8", relation=EdgeRelation.ASSOCIATED_WITH,
            required_for_crossing=True, threshold_relevance=ThresholdRelevance.SIGNIFICANT, reviewed=True,
        ))
        for suffix in ("A", "B"):
            problem_id = f"{target}-{suffix}"
            nodes.append(CurriculumNode(
                type=NodeType.PROBLEM, id=problem_id, name=problem_id,
                problem_version="p1", family_id=f"family-{problem_id}", task_type=TaskType.MULTIPLE_CHOICE,
                prompt="Choose a path and explain the choice.", rubric_id="rubric", rubric_version="r1",
                assessment_version="a1", rubric_dimensions=rubric,
                options=(ProblemOption(key="A", text="A path"), ProblemOption(key="B", text="Not a path")),
                correct_key="A", diagnostic_approved=True, catalog_diagnostic_reliability=0.95,
            ))
            edges.extend((
                CurriculumEdge(source_id=problem_id, target_id="TC8", relation=EdgeRelation.TESTS),
                CurriculumEdge(
                    source_id=problem_id, target_id=target, relation=EdgeRelation.DIAGNOSES,
                    diagnostic_strength=0.95, evidence_if_correct=EvidencePolarity.CONTRADICTS,
                    evidence_if_incorrect=EvidencePolarity.SUPPORTS, reviewed=True,
                    problem_version="p1", rubric_version="r1", assessment_version="a1",
                ),
            ))
    for problem_id in transfers:
        nodes.append(CurriculumNode(
            type=NodeType.PROBLEM, id=problem_id, name=f"Transfer {problem_id}",
            problem_version="p1", family_id=f"family-{problem_id}", task_type=TaskType.TRANSFER,
            prompt="Apply the distinction in an unfamiliar setting.", rubric_id="rubric", rubric_version="r1",
            assessment_version="a1", rubric_dimensions=rubric,
            transfer_approved=True, catalog_diagnostic_reliability=0.95,
        ))
        edges.append(CurriculumEdge(
            source_id="TC8", target_id=problem_id, relation=EdgeRelation.HAS_TRANSFER_PROBE,
            required_for_crossing=True, reviewed=True, problem_version="p1",
            rubric_version="r1", assessment_version="a1",
        ))
    return validate_graph(CurriculumGraph(
        tenant_id=SCOPE.tenant_id, curriculum_id=SCOPE.curriculum_id, version=SCOPE.curriculum_version,
        institute_ids=(SCOPE.institute_id,), course_ids=(SCOPE.course_id,), course_name="Synthetic graph course",
        nodes=tuple(nodes), edges=tuple(edges), policies=policy,
        status=PublicationStatus.PUBLISHED, published_ready=True, reviewed_by="teacher-test", reviewed_at=NOW,
    ))


def probe(key, problem="M1-A", *, correct=True, days_ago=5, concept=False, transfer=False, sequence=1):
    reasoning = (
        "The definition excludes repeated vertices." if correct else "Repeated vertices always form a path."
    )
    evidence = Evidence(
        evidence_id=f"E-{key}", event_id=f"EV-{key}", scope=SCOPE, event_sequence=sequence,
        source=EvidenceSource.TRANSFER_RESPONSE if transfer else EvidenceSource.DIAGNOSTIC_RESPONSE,
        source_id=f"message-{key}", occurred_at=NOW - timedelta(days=days_ago),
        answer="A" if correct else "B", reasoning=reasoning, problem_id=problem, problem_version="p1",
        assessment_instance_id=f"assessment-{key}", assessment_version="a1", rubric_id="rubric",
        rubric_version="r1", family_id=f"family-{problem}", context_id=f"context-{key}",
        lineage_id=f"lineage-{key}", tc_ids=["TC8"],
        quality=EvidenceQuality(
            score=0.95, catalog_approved=True, diagnostic_reliability=0.95, provenance="catalog-review-v1",
        ),
        assistance=Assistance.NO_RECORDED_HINT, answer_key_source="SERVER_FROZEN_ASSESSMENT",
        provenance=EvidenceProvenance(server_verified=True, assessment_frozen=True),
    )
    target = problem.rsplit("-", 1)[0]
    observation = Observation(
        observation_id=f"O-{key}", scope=SCOPE, source_evidence=[evidence.evidence_id],
        supports=[target] if not correct and not transfer else [],
        contradicts=[target] if correct and not transfer else [],
        concept_demonstrations=[
            ConceptDemonstration(
                tc_id="TC8", result=DemonstrationResult.PASS if correct else DemonstrationResult.FAIL,
                rubric_version="r1",
            )
        ] if concept else [],
        transfer_judgments=[
            TransferJudgment(
                tc_id="TC8", problem_id=problem,
                outcome=TransferStatus.PASS if correct else TransferStatus.FAIL,
                assessment_version="a1", rubric_version="r1",
            )
        ] if transfer else [],
        reasoning_result=ReasoningResult.SATISFIES_RUBRIC if correct else ReasoningResult.DOES_NOT_SATISFY_RUBRIC,
        rubric_dimensions=[RubricScore(dimension_id="reasoning", score=1.0 if correct else 0.0)],
        quotes=[EvidenceQuote(evidence_id=evidence.evidence_id, quote=reasoning)],
        confidence=0.95, extractor_version="rules-test-v1", extractor_kind="RULES",
    )
    return evidence, observation


def reduce(pairs, *, graph=None, previous=None, as_of=NOW, affected=None):
    return reduce_learner_state(
        SCOPE, graph or published_graph(), [pair[0] for pair in pairs], [pair[1] for pair in pairs],
        previous, as_of, affected,
    )


def cleared_pairs(target="M1", *, concept=False):
    return [
        probe(f"{target}-clear-A", f"{target}-A", days_ago=10, concept=concept, sequence=1),
        probe(f"{target}-clear-B", f"{target}-B", days_ago=8, concept=concept, sequence=2),
    ]


def test_no_evidence_is_sparse_not_failure():
    graph = published_graph()
    result = reduce([], graph=graph)
    assert result.misconception_states == result.concept_states == result.threshold_states == {}
    assert result.profile.weak_tcs == [] and result.profile.learning_trend == Trend.UNKNOWN
    threshold = evaluate_threshold("TC8", graph, {}, [], [], NOW)
    assert threshold.state == ThresholdStatus.NOT_CROSSED and "NO_EVIDENCE" in threshold.reason_codes
    assert MisconceptionState(misconception_id="M1").state == MisconceptionStatus.NOT_ASSESSED


def test_one_weak_support_is_suspected_not_present():
    evidence, observation = probe("weak", correct=False)
    evidence = evidence.model_copy(update={"quality": EvidenceQuality(score=0.2)})
    observation = observation.model_copy(update={"confidence": 0.4})
    result = reduce([(evidence, observation)])
    assert result.misconception_states["M1"].state == MisconceptionStatus.SUSPECTED
    assert not result.misconception_states["M1"].coverage_eligible


def test_independent_strong_supports_are_present_and_only_demonstrated_failures_struggle():
    pairs = [
        probe("wrong-A", "M1-A", correct=False, concept=True),
        probe("wrong-B", "M1-B", correct=False, concept=True),
    ]
    result = reduce(pairs)
    assert result.misconception_states["M1"].state == MisconceptionStatus.PRESENT
    assert result.concept_states["TC8"].state == ConceptStatus.STRUGGLING
    assert result.profile.weak_tcs == ["TC8"]
    without_demonstrations = [
        (item, observation.model_copy(update={"concept_demonstrations": []})) for item, observation in pairs
    ]
    assert reduce(without_demonstrations).profile.weak_tcs == []


def test_present_to_resolving_to_cleared_requires_multiple_independent_reasoned_probes():
    wrong = [
        probe("wrong-A", "M1-A", correct=False, days_ago=30),
        probe("wrong-B", "M1-B", correct=False, days_ago=29),
    ]
    present = reduce(wrong)
    first = wrong + [probe("first-correct", "M1-A", days_ago=10)]
    resolving = reduce(first, previous=present)
    assert resolving.misconception_states["M1"].state == MisconceptionStatus.RESOLVING
    assert resolving.misconception_states["M1"].qualifying_clearing_count == 1
    cleared = reduce(first + [probe("second-correct", "M1-B", days_ago=9)], previous=resolving)
    assert cleared.misconception_states["M1"].state == MisconceptionStatus.CLEARED
    assert cleared.misconception_states["M1"].trend == Trend.IMPROVING
    assert cleared.misconception_states["M1"].state_version > resolving.misconception_states["M1"].state_version


def test_recent_strong_support_prevents_clearance_even_after_two_correct_answers():
    pairs = [
        probe("wrong", "M1-A", correct=False, days_ago=3),
        probe("correct-A", "M1-A", days_ago=2),
        probe("correct-B", "M1-B", days_ago=1),
    ]
    state = reduce(pairs).misconception_states["M1"]
    assert state.state == MisconceptionStatus.RESOLVING
    assert "RECENT_STRONG_SUPPORT" in state.reason_codes and not state.coverage_eligible


def test_new_support_revokes_old_clearance_and_cannot_reclear_by_waiting():
    pairs = cleared_pairs() + [probe("transfer", "T1", transfer=True)]
    crossed = reduce(pairs)
    pairs.append(probe("regression", "M1-A", correct=False, days_ago=1))
    regressed = reduce(pairs, previous=crossed)
    assert regressed.misconception_states["M1"].state == MisconceptionStatus.RESOLVING
    assert regressed.misconception_states["M1"].trend == Trend.DECLINING
    assert regressed.threshold_states["TC8"].state != ThresholdStatus.CROSSED
    assert not regressed.profile.crossed_tcs
    later = reduce(pairs, as_of=NOW + timedelta(days=16))
    assert later.misconception_states["M1"].state != MisconceptionStatus.CLEARED


def test_mastered_without_transfer_is_candidate_not_crossed():
    result = reduce(cleared_pairs(concept=True))
    assert result.concept_states["TC8"].state == ConceptStatus.MASTERED
    assert result.threshold_states["TC8"].state == ThresholdStatus.CANDIDATE
    assert result.threshold_states["TC8"].transfer_state == TransferStatus.NOT_ATTEMPTED
    assert result.profile.strong_tcs == ["TC8"] and result.profile.crossed_tcs == []
    assert result.profile.next_recommended_probe.problem_id == "T1"


@pytest.mark.parametrize("blocker", [MisconceptionStatus.PRESENT, MisconceptionStatus.RESOLVING])
def test_every_required_misconception_must_clear(blocker):
    graph = published_graph(misconceptions=("M1", "M2"))
    pairs = cleared_pairs("M1") + [
        probe("M2-wrong-A", "M2-A", correct=False, days_ago=30),
        probe("M2-wrong-B", "M2-B", correct=False, days_ago=29),
        probe("transfer", "T1", transfer=True),
    ]
    if blocker == MisconceptionStatus.RESOLVING:
        pairs.append(probe("M2-once", "M2-A", days_ago=2))
    result = reduce(pairs, graph=graph)
    assert result.misconception_states["M2"].state == blocker
    assert result.threshold_states["TC8"].state == ThresholdStatus.CANDIDATE
    assert result.threshold_states["TC8"].required_total == 2
    assert result.threshold_states["TC8"].required_coverage == 0.5


@pytest.mark.parametrize("fault", ["stale", "rubric_version", "assessment_version", "problem_version"])
def test_apparent_cleared_labels_do_not_replace_fresh_correct_version_coverage(fault):
    graph = published_graph()
    pairs = cleared_pairs() + [probe("transfer", "T1", transfer=True)]
    valid = reduce(pairs, graph=graph)
    bad_evidence = [item for item, _ in pairs]
    if fault == "stale":
        bad_evidence[0] = bad_evidence[0].model_copy(update={"occurred_at": NOW - timedelta(days=91)})
    else:
        bad_evidence[0] = bad_evidence[0].model_copy(update={fault: "old-version"})
    threshold = evaluate_threshold(
        "TC8", graph, valid.misconception_states, bad_evidence, [obs for _, obs in pairs], NOW
    )
    assert threshold.required_cleared == 1
    assert threshold.required_coverage == 0.0
    assert threshold.state == ThresholdStatus.CANDIDATE


def test_crossing_needs_all_transfer_requirements_but_not_concept_mastery():
    graph = published_graph(transfers=("T1", "T2"))
    pairs = cleared_pairs() + [probe("transfer-1", "T1", transfer=True)]
    candidate = reduce(pairs, graph=graph)
    assert candidate.threshold_states["TC8"].state == ThresholdStatus.CANDIDATE
    assert candidate.threshold_states["TC8"].transfers["T2"].state == TransferStatus.NOT_ATTEMPTED
    crossed = reduce(pairs + [probe("transfer-2", "T2", transfer=True)], graph=graph)
    assert crossed.threshold_states["TC8"].state == ThresholdStatus.CROSSED
    assert crossed.concept_states["TC8"].state != ConceptStatus.MASTERED
    assert crossed.profile.crossed_tcs == ["TC8"] and crossed.profile.strong_tcs == []
    assert crossed.profile.snapshot_version == crossed.snapshot_version
    assert crossed.profile.evidence_watermark == crossed.last_processed_sequence


def test_same_problem_does_not_automatically_satisfy_two_transfer_conditions():
    graph = published_graph()
    transfer = next(edge for edge in graph.edges if edge.relation == EdgeRelation.HAS_TRANSFER_PROBE)
    graph = validate_graph(graph.model_copy(update={"edges": (
        *(edge for edge in graph.edges if edge != transfer),
        transfer.model_copy(update={"id": "condition-a", "transfer_condition_id": "A"}),
        transfer.model_copy(update={"id": "condition-b", "transfer_condition_id": "B"}),
    )}))
    evidence, observation = probe("transfer-a", "T1", transfer=True)
    observation = observation.model_copy(update={"transfer_judgments": [
        observation.transfer_judgments[0].model_copy(update={"condition_id": "A"})
    ]})
    candidate = reduce(cleared_pairs() + [(evidence, observation)], graph=graph)
    assert candidate.threshold_states["TC8"].transfers["A"].state == TransferStatus.PASS
    assert candidate.threshold_states["TC8"].transfers["B"].state != TransferStatus.PASS
    assert candidate.threshold_states["TC8"].state == ThresholdStatus.CANDIDATE


def test_empty_requirements_do_not_vacuously_cross():
    graph = CurriculumGraph(
        tenant_id=SCOPE.tenant_id, curriculum_id=SCOPE.curriculum_id, version=SCOPE.curriculum_version,
        institute_ids=(SCOPE.institute_id,), course_name="Draft",
        nodes=(CurriculumNode(type="TC", id="TC8", name="TC8"),),
    )
    result = evaluate_threshold("TC8", graph, {}, [], [], NOW, has_activity=True)
    assert result.state == ThresholdStatus.CANDIDATE and result.required_coverage == 0
    assert "NO_REQUIRED_MISCONCEPTIONS" in result.reason_codes


def test_optional_blocking_category_does_not_become_a_crossing_requirement():
    graph = published_graph(misconceptions=("M1", "M2"))
    graph = validate_graph(graph.model_copy(update={"edges": tuple(
        edge.model_copy(update={
            "required_for_crossing": False, "threshold_relevance": ThresholdRelevance.BLOCKING,
        }) if edge.relation == EdgeRelation.ASSOCIATED_WITH and edge.source_id == "M2" else edge
        for edge in graph.edges
    )}))
    pairs = cleared_pairs() + [
        probe("transfer", "T1", transfer=True),
        probe("M2-wrong-a", "M2-A", correct=False),
        probe("M2-wrong-b", "M2-B", correct=False),
    ]
    result = reduce(pairs, graph=graph)
    assert result.misconception_states["M2"].state == MisconceptionStatus.PRESENT
    assert result.threshold_states["TC8"].state == ThresholdStatus.CROSSED
    assert result.threshold_states["TC8"].required_total == 1


@pytest.mark.parametrize("fault", [
    "same_family", "same_context", "same_lineage", "same_assessment", "one_summary",
    "answer_revealed", "hint", "no_reasoning", "no_quote", "invented_quote", "low_catalog", "low_quality",
])
def test_repeated_assisted_or_unreliable_answers_cannot_clear(fault):
    first = probe("first", "M1-A")
    second = probe("second", "M1-B")
    evidence, observation = second
    if fault == "same_family":
        second = probe("second", "M1-A")
    elif fault == "same_context":
        second = evidence.model_copy(update={"context_id": first[0].context_id}), observation
    elif fault == "same_lineage":
        second = evidence.model_copy(update={"lineage_id": first[0].lineage_id}), observation
    elif fault == "same_assessment":
        second = probe("second", "M1-A")
        second = second[0].model_copy(update={"assessment_instance_id": first[0].assessment_instance_id}), second[1]
    elif fault == "one_summary":
        combined = first[1].model_copy(update={
            "source_evidence": [first[0].evidence_id, evidence.evidence_id],
            "quotes": first[1].quotes + observation.quotes,
        })
        result = reduce_learner_state(SCOPE, published_graph(), [first[0], evidence], [combined], None, NOW)
        assert result.misconception_states["M1"].state != MisconceptionStatus.CLEARED
        return
    elif fault in ("answer_revealed", "hint"):
        second = evidence.model_copy(update={
            "assistance": Assistance.ANSWER_REVEALED if fault == "answer_revealed" else Assistance.HINT_USED
        }), observation
    elif fault == "no_reasoning":
        second = evidence.model_copy(update={"reasoning": None, "reasoning_available": False}), observation
    elif fault == "no_quote":
        second = evidence, observation.model_copy(update={"quotes": []})
    elif fault == "invented_quote":
        second = evidence, observation.model_copy(update={"quotes": [
            EvidenceQuote(evidence_id=evidence.evidence_id, quote="A statement the learner never made.")
        ]})
    elif fault == "low_catalog":
        second = evidence.model_copy(update={
            "quality": evidence.quality.model_copy(update={"diagnostic_reliability": 0.1})
        }), observation.model_copy(update={"confidence": 1.0})
    elif fault == "low_quality":
        second = evidence.model_copy(update={
            "quality": evidence.quality.model_copy(update={"score": 0.1})
        }), observation.model_copy(update={"confidence": 1.0})
    result = reduce([first, second])
    assert result.misconception_states["M1"].state != MisconceptionStatus.CLEARED
    assert result.misconception_states["M1"].confidence_calibrated is False


def test_duplicate_facts_do_not_inflate_probes_and_conflicting_ids_are_rejected():
    pair = probe("one", "M1-A")
    result = reduce([pair, pair])
    assert result.misconception_states["M1"].raw_evidence_count == 1
    assert result.misconception_states["M1"].qualifying_clearing_count == 1
    with pytest.raises(ValueError, match="Conflicting evidence ID"):
        reduce([pair, (pair[0].model_copy(update={"reasoning": "Different input"}), pair[1])])


def test_old_late_arriving_evidence_uses_observed_time_not_ingestion_order():
    pairs = cleared_pairs() + [probe("transfer", "T1", transfer=True)]
    baseline = reduce(pairs)
    old_support = probe("late-old-support", "M1-A", correct=False, days_ago=30, sequence=99)
    result = reduce(pairs + [old_support], previous=baseline)
    assert result.misconception_states["M1"].state == MisconceptionStatus.CLEARED
    assert result.threshold_states["TC8"].state == ThresholdStatus.CROSSED
    assert result.profile.active_tc == "TC8"


def test_fixed_time_replay_is_deterministic_including_profile_and_refs():
    pairs = cleared_pairs(concept=True) + [probe("transfer", "T1", transfer=True)]
    forward = reduce(pairs)
    backward = reduce(list(reversed(pairs)))
    assert forward.model_dump(mode="json") == backward.model_dump(mode="json")
    first_update = reduce(pairs, previous=forward)
    replay = reduce(list(reversed(pairs)), previous=forward)
    assert first_update.model_dump(mode="json") == replay.model_dump(mode="json")
    assert first_update.misconception_states["M1"].state_version == forward.misconception_states["M1"].state_version
    assert LearnerSnapshot.model_validate(forward.model_dump(mode="json")) == forward


def test_revalidation_at_expiry_revokes_crossing_without_new_interaction():
    pairs = cleared_pairs(concept=True) + [probe("transfer", "T1", transfer=True, days_ago=2)]
    crossed = reduce(pairs)
    assert crossed.threshold_states["TC8"].state == ThresholdStatus.CROSSED
    assert crossed.next_revalidation_at == NOW + timedelta(days=28)
    expired = reduce(pairs, previous=crossed, as_of=crossed.next_revalidation_at)
    assert expired.threshold_states["TC8"].state == ThresholdStatus.CANDIDATE
    assert expired.profile.crossed_tcs == []
    historical = crossed.model_copy(update={"as_of": crossed.next_revalidation_at})
    projection = project_learning_profile(historical, published_graph())
    assert projection.crossed_tcs == [] and projection.needs_revalidation


def test_future_evidence_is_not_used_before_its_observed_time():
    pairs = cleared_pairs()
    pairs[1] = probe("future", "M1-B", days_ago=-1)
    result = reduce(pairs)
    assert result.misconception_states["M1"].qualifying_clearing_count == 1


def test_superseded_correct_fact_is_not_counted_twice_or_left_as_clearance():
    pairs = cleared_pairs()
    wrong, observation = probe("edited-wrong", "M1-A", correct=False, days_ago=1)
    wrong = wrong.model_copy(update={"supersedes_event_id": pairs[0][0].event_id})
    result = reduce(pairs + [(wrong, observation)])
    assert result.misconception_states["M1"].state != MisconceptionStatus.CLEARED
    assert pairs[0][0].evidence_id not in result.misconception_states["M1"].evidence_ids


def test_new_scope_versions_epochs_and_old_policy_labels_cannot_inherit_crossing():
    pairs = cleared_pairs() + [probe("transfer", "T1", transfer=True)]
    previous = reduce(pairs)
    with pytest.raises(ValueError, match="scope/version/learning epoch"):
        reduce_learner_state(
            SCOPE.model_copy(update={"learning_epoch": 2}), published_graph(), [], [], previous, NOW
        )
    graph = published_graph()
    graph = graph.model_copy(update={"policies": graph.policies.model_copy(update={
        "version": "new-policy", "misconception_policy_version": "new-misconception-policy"
    })})
    result = evaluate_threshold(
        "TC8", graph, previous.misconception_states, [e for e, _ in pairs], [o for _, o in pairs], NOW
    )
    assert result.state != ThresholdStatus.CROSSED
    with pytest.raises(ValueError, match="scope/version/epoch"):
        item = pairs[0][0].model_copy(update={"scope": SCOPE.model_copy(update={"student_id": "other"})})
        reduce([(item, pairs[0][1])])


def test_missing_prerequisite_is_a_diagnostic_gap_not_struggling_and_not_a_crossing_gate():
    graph = published_graph()
    prerequisite = CurriculumNode(
        type=NodeType.TC, id="TC7", name="Earlier conceptual dependency",
        crossing_policy_version=graph.policies.threshold_policy_version,
    )
    # The prerequisite remains unreviewed in this draft; no numeric-order assumption is made.
    graph = validate_graph(graph.model_copy(update={
        "nodes": (*graph.nodes, prerequisite), "status": PublicationStatus.DRAFT, "published_ready": False,
        "edges": (*graph.edges, CurriculumEdge(
            source_id="TC7", target_id="TC8", relation=EdgeRelation.PREREQUISITE_OF,
        )),
    }))
    result = reduce([probe("activity", "M1-A")], graph=graph)
    assert "TC7" not in result.concept_states
    assert result.profile.weak_tcs == []
    assert result.profile.unresolved_prerequisites == ["TC7"]
    assert result.profile.next_recommended_probe.tc_id == "TC7"
    assert result.profile.next_recommended_probe.reason_code == "DIAGNOSTIC_GAP"


def test_failed_transfer_revokes_a_previous_pass():
    pairs = cleared_pairs() + [
        probe("transfer-pass", "T1", transfer=True, days_ago=4),
        probe("transfer-fail", "T1", correct=False, transfer=True, days_ago=1),
    ]
    result = reduce(pairs)
    assert result.threshold_states["TC8"].transfer_state == TransferStatus.FAIL
    assert result.threshold_states["TC8"].state == ThresholdStatus.CANDIDATE


def test_conflicting_extractions_of_the_same_response_cannot_prove_clearance():
    pairs = cleared_pairs()
    conflicting = pairs[0][1].model_copy(update={
        "observation_id": "O-conflicting", "supports": ["M1"], "contradicts": [],
        "reasoning_result": ReasoningResult.DOES_NOT_SATISFY_RUBRIC,
    })
    result = reduce_learner_state(
        SCOPE, published_graph(), [item for item, _ in pairs],
        [observation for _, observation in pairs] + [conflicting], None, NOW,
    )
    assert result.misconception_states["M1"].state != MisconceptionStatus.CLEARED
    assert any(
        exclusion.reason == "CONFLICTING_OBSERVATIONS"
        for exclusion in result.misconception_states["M1"].excluded_evidence
    )


def test_prerequisite_crossing_is_not_a_hidden_additional_threshold_gate():
    graph = published_graph()
    tc = next(node for node in graph.nodes if node.id == "TC8")
    graph = validate_graph(graph.model_copy(update={
        "nodes": (*graph.nodes, tc.model_copy(update={"id": "TC7", "name": "Prerequisite"})),
        "edges": (*graph.edges, *(
            edge.model_copy(update={"id": f"TC7-{edge.id}", "target_id": "TC7"})
            for edge in graph.edges
            if edge.relation == EdgeRelation.ASSOCIATED_WITH
        ), *(
            edge.model_copy(update={"id": f"TC7-{edge.id}", "source_id": "TC7"})
            for edge in graph.edges
            if edge.relation == EdgeRelation.HAS_TRANSFER_PROBE
        ), CurriculumEdge(source_id="TC7", target_id="TC8", relation=EdgeRelation.PREREQUISITE_OF)),
    }))
    pairs = cleared_pairs() + [probe("only-TC8-transfer", "T1", transfer=True)]
    result = reduce(pairs, graph=graph)
    assert result.threshold_states["TC7"].state != ThresholdStatus.CROSSED
    assert result.threshold_states["TC8"].state == ThresholdStatus.CROSSED
    assert result.profile.unresolved_prerequisites == ["TC7"]


def test_partial_reduction_keeps_shared_targets_consistent_without_mutating_previous():
    graph = published_graph()
    tc = next(node for node in graph.nodes if node.id == "TC8")
    # A separate reviewed TC uses the same diagnostic targets but its own transfer judgment.
    graph = validate_graph(graph.model_copy(update={
        "nodes": (*graph.nodes, tc.model_copy(update={"id": "TC2", "name": "Shared dependent"})),
        "edges": (*graph.edges, *(
            edge.model_copy(update={"id": f"TC2-{edge.id}", "target_id": "TC2"})
            for edge in graph.edges if edge.relation == EdgeRelation.ASSOCIATED_WITH
        ), *(
            edge.model_copy(update={"id": f"TC2-{edge.id}", "source_id": "TC2"})
            for edge in graph.edges if edge.relation == EdgeRelation.HAS_TRANSFER_PROBE
        )),
    }))
    pairs = cleared_pairs() + [probe("transfer", "T1", transfer=True)]
    original = reduce(pairs, graph=graph)
    new_pairs = pairs + [probe("regression", "M1-A", correct=False, days_ago=1)]
    updated = reduce(new_pairs, graph=graph, previous=original, affected=["TC8"])
    assert updated.misconception_states["M1"].state != MisconceptionStatus.CLEARED
    assert updated.threshold_states["TC2"].required_cleared == 0
    assert updated.threshold_states["TC8"].required_cleared == 0
    assert original.misconception_states["M1"].state == MisconceptionStatus.CLEARED


def test_unassessed_engagement_never_becomes_mastery_or_struggle():
    event = Evidence(
        evidence_id="exposure", event_id="EV-exposure", scope=SCOPE, source=EvidenceSource.TEACHING_EXPOSURE,
        occurred_at=NOW, tc_ids=["TC8"], reasoning="The assistant explained paths.",
    )
    result = reduce_learner_state(SCOPE, published_graph(), [event], [], None, NOW)
    assert result.concept_states["TC8"].state == ConceptStatus.INSUFFICIENT_EVIDENCE
    assert result.profile.strong_tcs == result.profile.weak_tcs == []
    assert result.misconception_states == {}


def test_unrelated_state_entries_are_carried_forward_unchanged():
    graph = published_graph()
    other = published_graph(misconceptions=("M2",), transfers=("T2",))
    other_nodes = tuple(
        node.model_copy(update={"id": "TC2", "name": "Unrelated TC"}) if node.id == "TC8" else node
        for node in other.nodes if node.id != "course"
    )
    other_edges = tuple(
        CurriculumEdge.model_validate({
            **edge.model_dump(mode="python"), "id": None,
            "source_id": "TC2" if edge.source_id == "TC8" else edge.source_id,
            "target_id": "TC2" if edge.target_id == "TC8" else edge.target_id,
        }) for edge in other.edges
    )
    graph = validate_graph(graph.model_copy(update={
        "nodes": (*graph.nodes, *other_nodes), "edges": (*graph.edges, *other_edges),
    }))
    other_evidence, other_observation = probe("unrelated", "M2-A", correct=False)
    other_evidence = other_evidence.model_copy(update={"tc_ids": ["TC2"]})
    pairs = cleared_pairs() + [
        probe("transfer", "T1", transfer=True), (other_evidence, other_observation),
    ]
    original = reduce(pairs, graph=graph)
    updated = reduce(
        pairs + [probe("regression", "M1-A", correct=False, days_ago=1)],
        graph=graph, previous=original, affected=["TC8"],
    )
    assert updated.concept_states["TC2"] == original.concept_states["TC2"]
    assert updated.threshold_states["TC2"] == original.threshold_states["TC2"]
    assert updated.misconception_states["M2"] == original.misconception_states["M2"]
