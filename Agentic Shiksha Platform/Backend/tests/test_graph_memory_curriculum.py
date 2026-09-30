from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from backend.schemas.learner_memory import (
    CurriculumEdge,
    CurriculumGraph,
    CurriculumNode,
    EdgeRelation,
    EvidenceSource,
    EventType,
    LearnerSnapshot,
    LearningEventInput,
    MemoryScope,
    NodeType,
    Observation,
    PolicySet,
    PublicationStatus,
)
from learner_memory.curriculum import GraphValidationError, import_legacy_curriculum, validate_graph
from learner_memory.settings import MemorySettings

NOW = datetime(2026, 2, 1, tzinfo=timezone.utc)


def scope(**updates):
    return MemoryScope(
        **{
            "tenant_id": "tenant-test", "institute_id": "institute-test", "course_id": "offering",
            "student_id": "learner-test", "curriculum_id": "curriculum", "curriculum_version": "v1",
            **updates,
        }
    )


def draft(*tc_ids, edges=()):
    return CurriculumGraph(
        tenant_id="tenant-test", curriculum_id="curriculum", version="v1",
        institute_ids=("institute-test",), course_name="Synthetic graph course",
        nodes=tuple(CurriculumNode(type=NodeType.TC, id=key, name=key) for key in tc_ids),
        edges=edges,
    )


def test_arbitrary_numbered_prerequisite_is_valid_and_version_pinned():
    graph = validate_graph(draft("TC7", "TC2", edges=(
        CurriculumEdge(source_id="TC7", target_id="TC2", relation=EdgeRelation.PREREQUISITE_OF),
    )))
    assert graph.edges[0].source_id == "TC7"
    assert graph.edges[0].curriculum_version == "v1"
    assert all(node.curriculum_id == "curriculum" for node in graph.nodes)


def test_cycle_error_contains_the_actual_path():
    graph = draft("TC1", "TC3", edges=(
        CurriculumEdge(source_id="TC1", target_id="TC3", relation=EdgeRelation.PREREQUISITE_OF),
        CurriculumEdge(source_id="TC3", target_id="TC1", relation=EdgeRelation.PREREQUISITE_OF),
    ))
    with pytest.raises(GraphValidationError, match="TC1 -> TC3 -> TC1"):
        validate_graph(graph)


@pytest.mark.parametrize("case", ["duplicate_node", "duplicate_edge", "dangling", "wrong_endpoint"])
def test_invalid_graph_shapes_fail_closed(case):
    graph = draft("TC1", "TC2")
    edge = CurriculumEdge(source_id="TC1", target_id="TC2", relation=EdgeRelation.PREREQUISITE_OF)
    if case == "duplicate_node":
        graph = graph.model_copy(update={"nodes": (*graph.nodes, graph.nodes[0])})
    elif case == "duplicate_edge":
        graph = graph.model_copy(update={"edges": (edge, edge)})
    elif case == "dangling":
        graph = graph.model_copy(update={"edges": (edge.model_copy(update={"target_id": "unknown"}),)})
    else:
        graph = graph.model_copy(update={"edges": (edge.model_copy(update={"relation": EdgeRelation.DIAGNOSES}),)})
    with pytest.raises(GraphValidationError):
        validate_graph(graph)


def test_graph_is_deeply_immutable_and_json_roundtrips():
    graph = validate_graph(draft("TC1"))
    with pytest.raises(ValidationError):
        graph.version = "v2"
    with pytest.raises(ValidationError):
        graph.nodes[0].name = "Changed"
    with pytest.raises(ValidationError):
        graph.policies.min_clearance_independent_probes = 1
    assert CurriculumGraph.model_validate(graph.model_dump(mode="json")) == graph
    assert len(graph.content_hash) == 64


def test_empty_required_set_cannot_be_published_even_after_review():
    policy = PolicySet(teacher_reviewed=True, reviewed_by="teacher-test", reviewed_at=NOW)
    graph = draft("TC1")
    graph = graph.model_copy(update={
        "policies": policy, "status": PublicationStatus.PUBLISHED, "published_ready": True,
        "reviewed_by": "teacher-test", "reviewed_at": NOW,
        "nodes": (graph.nodes[0].model_copy(update={
            "crossing_policy_version": policy.threshold_policy_version,
        }),),
    })
    with pytest.raises(GraphValidationError, match="nonempty reviewed required"):
        validate_graph(graph)


def test_published_graph_requires_teacher_policy_review():
    with pytest.raises(ValidationError, match="teacher-reviewed policies"):
        draft("TC1").model_validate({
            **draft("TC1").model_dump(mode="json"),
            "status": "PUBLISHED", "published_ready": True, "reviewed_by": "teacher-test",
            "reviewed_at": NOW,
        })


def test_cross_version_edges_are_rejected_not_rebound():
    with pytest.raises(ValidationError, match="Cross-version"):
        draft("TC1", "TC2", edges=(
            CurriculumEdge(
                source_id="TC1", target_id="TC2", relation=EdgeRelation.PREREQUISITE_OF,
                curriculum_version="different-version",
            ),
        ))


def test_legacy_import_is_stable_draft_and_preserves_only_exact_mappings():
    payload = {
        "course_name": "Synthetic graph course",
        "all_threshold_concepts": ["Walks and paths"],
        "syllabus": [{"module_id": "m2", "prerequisites": ["m1"]}],
        "Walks and paths": {
            "description": "Distinguish a walk from a path.",
            "misconceptions": [{"misconception": "Every walk is a path", "why_wrong": "Vertices may repeat."}],
            "concept_inventory_questions": [{
                "question": "Does repeating a vertex always form a path?",
                "options": ["No", "Yes"], "correct": 0,
                "targets_misconception": "Every walk is a path",
            }, {
                "question": "Is a walk always a path?",
                "options": ["No", "Yes"], "correct": 0,
                "targets_misconception": "Every walk is a Path",
            }],
        },
        "learned": True,
    }
    first = import_legacy_curriculum(payload, "tenant-test", "institute-test", "offering", "curriculum", "v1")
    second = import_legacy_curriculum(payload, "tenant-test", "institute-test", "offering", "curriculum", "v2")
    assert [node.id for node in first.nodes] == [node.id for node in second.nodes]
    assert first.status == PublicationStatus.DRAFT and not first.published_ready
    assert not first.policies.teacher_reviewed
    assert all(not node.diagnostic_approved and not node.transfer_approved for node in first.nodes)
    assert all(edge.required_for_crossing is None and not edge.reviewed for edge in first.edges)
    assert not any(edge.relation == EdgeRelation.PREREQUISITE_OF for edge in first.edges)
    assert sum(edge.relation == EdgeRelation.DIAGNOSES for edge in first.edges) == 1
    assert all(node.correct_key == "0" for node in first.nodes if node.type == NodeType.PROBLEM)
    with_alias = import_legacy_curriculum(
        payload, "tenant-test", "institute-test", "offering", "curriculum",
        reviewed_aliases={"Walks and paths": "TC7"},
    )
    assert next(node for node in with_alias.nodes if node.type == NodeType.TC).id == "TC7"
    assert not with_alias.published_ready


def test_importer_rejects_duplicate_labels_and_invalid_answer_indices():
    with pytest.raises(GraphValidationError, match="Duplicate legacy entity"):
        import_legacy_curriculum(
            {"all_threshold_concepts": ["Repeated", "Repeated"]},
            "tenant-test", "institute-test", "offering",
        )
    with pytest.raises(GraphValidationError, match="out of range"):
        import_legacy_curriculum({
            "all_threshold_concepts": ["TC"],
            "TC": {"concept_inventory_questions": [{"question": "Question", "options": ["A"], "correct": 2}]},
        }, "tenant-test", "institute-test", "offering")


@pytest.mark.parametrize("updates", [
    {"min_clearance_independent_probes": 1},
    {"min_clearance_contexts": 1},
    {"min_clearance_families": 1},
    {"recent_support_window_days": 91, "evidence_max_age_days": 90},
    {"min_clearance_confidence": 0.4},
    {"min_evidence_quality": 0},
    {"min_reasoning_rubric_score": 0},
    {"min_transfer_independent_passes": 2},
    {"qualifying_assistance": ["ANSWER_REVEALED"]},
    {"qualifying_answer_key_sources": ["NONE"]},
    {"teacher_reviewed": True},
    {"confidence_calibrated": True},
])
def test_invalid_or_overconfident_policy_configuration_is_rejected(updates):
    with pytest.raises(ValidationError):
        PolicySet(**updates)


def test_scope_keys_are_unambiguous_and_partition_is_stable_across_epochs():
    first = scope(tenant_id="a|b", institute_id="c")
    second = scope(tenant_id="a", institute_id="b|c")
    assert first.partition_key != second.partition_key
    assert scope().partition_key == scope(curriculum_version="v2", learning_epoch=2).partition_key
    assert scope().graph_key != scope(curriculum_version="v2").graph_key
    assert scope().partition_key != scope(student_id="another-learner").partition_key


def test_empty_snapshot_is_sparse_and_json_serializable():
    snapshot = LearnerSnapshot(scope=scope())
    assert not snapshot.misconception_states and not snapshot.concept_states and not snapshot.threshold_states
    assert snapshot.profile.weak_tcs == []
    assert LearnerSnapshot.model_validate(snapshot.model_dump(mode="json")) == snapshot


@pytest.mark.parametrize("authority", ["state", "quality", "observations", "scope", "learned", "confidence"])
def test_event_input_rejects_caller_authority(authority):
    with pytest.raises(ValidationError):
        LearningEventInput(
            event_id="event", event_type=EventType.LEARNER_MESSAGE, source=EvidenceSource.LEARNER_CHAT,
            source_id="message", occurred_at=NOW, **{authority: "CROSSED"},
        )


@pytest.mark.parametrize(("event_type", "source"), [
    ("RESET", "SYSTEM_REVALIDATION"),
    ("RECOMPUTE", "SYSTEM_REVALIDATION"),
    ("ARTIFACT_SUBMISSION", "SIMULATION_RESULT"),
    ("ARTIFACT_SUBMISSION", "ASSIGNMENT_RESPONSE"),
    ("LEARNER_MESSAGE", "REFLECTION"),
])
def test_approved_reset_and_artifact_event_contracts_roundtrip(event_type, source):
    event = LearningEventInput(
        event_id="event-test", event_type=event_type, source=source,
        source_id="server-source-test", occurred_at=NOW,
    )
    payload = event.model_dump(mode="json")
    assert payload["event_type"] == event_type and payload["source"] == source
    assert LearningEventInput.model_validate(payload) == event


@pytest.mark.parametrize("source", [
    EvidenceSource.SIMULATION_RESULT, EvidenceSource.ASSIGNMENT_RESPONSE, EvidenceSource.REFLECTION,
])
def test_new_sources_do_not_implicitly_gain_diagnostic_authority(source):
    assert source not in PolicySet().qualifying_sources


def test_observation_cannot_mutate_state_and_datetimes_must_be_aware():
    with pytest.raises(ValidationError):
        Observation(
            observation_id="observation", scope=scope(), source_evidence=["evidence"],
            extractor_version="test-v1", state="CLEARED",
        )
    with pytest.raises(ValidationError):
        LearningEventInput(
            event_id="event", event_type="LEARNER_MESSAGE", source="LEARNER_CHAT",
            source_id="message", occurred_at=datetime(2026, 1, 1),
        )
    with pytest.raises(ValidationError):
        Observation(
            observation_id="observation", scope=scope(), source_evidence=["evidence"],
            extractor_version="test-v1", supports=["M1"], contradicts=["M1"],
        )


def test_memory_settings_default_off_and_limit_invalid_configurations(monkeypatch):
    settings = MemorySettings(_env_prefix="UNUSED_GRAPH_TEST_")
    assert not settings.enabled and not settings.worker_enabled
    assert settings.graph_container_name == "curriculum_graph_v1"
    assert settings.max_snapshot_bytes < 2_000_000
    with pytest.raises(ValidationError):
        MemorySettings(_env_prefix="UNUSED_GRAPH_TEST_", max_graph_hops=999)
    with pytest.raises(ValidationError):
        MemorySettings(_env_prefix="UNUSED_GRAPH_TEST_", worker_enabled=True)
    with pytest.raises(ValidationError):
        MemorySettings(_env_prefix="UNUSED_GRAPH_TEST_", query_page_size=100, max_query_items=10)
    monkeypatch.setenv("UNUSED_GRAPH_TEST_ENABLED", "true")
    assert MemorySettings(_env_prefix="UNUSED_GRAPH_TEST_").enabled


def test_settings_expose_the_shared_service_contract_and_canonical_environment_names(monkeypatch):
    expected = {
        "enabled", "graph_container", "learner_container", "evidence_container",
        "max_graph_nodes", "max_graph_edges", "max_snapshot_bytes", "max_event_bytes",
        "max_replay_records", "max_nodes", "max_edges", "max_hops", "max_prerequisite_depth",
        "max_evidence_items", "max_context_chars", "worker_batch_size", "worker_poll_seconds",
        "lease_seconds", "max_attempts", "observation_model",
    }
    assert expected <= MemorySettings.model_fields.keys()
    monkeypatch.setenv("UNUSED_GRAPH_TEST_GRAPH_CONTAINER", "test-graph")
    monkeypatch.setenv("UNUSED_GRAPH_TEST_MAX_NODES", "12")
    monkeypatch.setenv("UNUSED_GRAPH_TEST_OBSERVATION_MODEL", "configured-test-deployment")
    settings = MemorySettings(_env_prefix="UNUSED_GRAPH_TEST_")
    assert settings.graph_container == settings.graph_container_name == "test-graph"
    assert settings.max_nodes == settings.max_retrieval_nodes == 12
    assert settings.observation_model == "configured-test-deployment"
    assert expected <= settings.model_dump().keys()
    assert not settings.enabled


def test_settings_keep_old_constructor_and_read_aliases_without_conflicting_defaults():
    settings = MemorySettings(
        _env_prefix="UNUSED_GRAPH_TEST_", graph_container_name="legacy-graph",
        worker_lease_seconds=90, worker_max_attempts=3, max_graph_hops=2,
        max_retrieval_nodes=9, max_retrieval_edges=18, max_retrieval_evidence=7,
    )
    assert settings.graph_container == "legacy-graph"
    assert settings.learner_container_name == settings.learner_container
    assert settings.evidence_container_name == settings.evidence_container
    assert settings.lease_seconds == settings.worker_lease_seconds == 90
    assert settings.max_attempts == settings.worker_max_attempts == 3
    assert settings.max_hops == settings.max_graph_hops == 2
    assert settings.max_nodes == 9 and settings.max_edges == 18 and settings.max_evidence_items == 7
    assert settings.observation_model is None
    with pytest.raises(ValidationError, match="Conflicting settings names"):
        MemorySettings(
            _env_prefix="UNUSED_GRAPH_TEST_", graph_container="new-graph", graph_container_name="old-graph"
        )


@pytest.mark.parametrize("updates", [
    {"max_event_bytes": 0},
    {"max_replay_records": 0},
    {"max_nodes": 0},
    {"max_edges": 0},
    {"max_hops": 99},
    {"max_prerequisite_depth": 99},
    {"max_evidence_items": 0},
    {"lease_seconds": 1},
    {"max_attempts": 0},
    {"observation_model": ""},
])
def test_shared_settings_limits_fail_closed(updates):
    with pytest.raises(ValidationError):
        MemorySettings(_env_prefix="UNUSED_GRAPH_TEST_", **updates)
