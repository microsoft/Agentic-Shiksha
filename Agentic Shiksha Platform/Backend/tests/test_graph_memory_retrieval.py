import json
from datetime import timedelta

import pytest

from azure_services.persistence.learner_memory import MemoryCapacityError, canonical_json
from backend.schemas.learner_memory import CurriculumGraph
from learner_memory.events import read_snapshot
from learner_memory.processor import MemoryProcessor
from learner_memory.settings import MemorySettings
from test_graph_memory_processing import SCOPE, service_fixture, submit


def replace_settings(service, **changes):
    service.settings = MemorySettings(**{**service.settings.model_dump(), **changes})


def test_context_is_bounded_and_does_not_contain_diagnostic_answer_keys():
    service, _repository, _extractor, _graph = service_fixture()
    result = submit(service, "M1-A", "quiz-a")
    service.process_event(SCOPE, result["receipt"]["event_id"])
    replace_settings(service, max_nodes=2, max_edges=1, max_evidence_items=1)
    context = service.context(SCOPE, "TC8")
    assert len(context["nodes"]) <= 2
    assert len(context["edges"]) <= 1
    assert len(context["evidence"]) <= 1
    assert '"correct_key"' not in json.dumps(context)
    assert '"correct_keys"' not in json.dumps(context)
    assert len(canonical_json(context)) <= min(service.settings.max_context_chars, service.settings.max_context_tokens)
    node_ids = {node["id"] for node in context["nodes"]}
    assert all(edge["source_id"] in node_ids and edge["target_id"] in node_ids for edge in context["edges"])
    assert context["snapshot_version"] == 1


def test_missing_prerequisite_is_a_diagnostic_gap_not_struggle():
    service, repository, _extractor, original = service_fixture()
    graph = original.model_dump(mode="json")
    root = next(node for node in graph["nodes"] if node["id"] == "TC8")
    graph["nodes"].append({**root, "id": "TC7", "name": "Upstream concept"})
    graph["edges"].extend([
        {"source_id": "TC7", "target_id": "TC8", "relation": "PREREQUISITE_OF"},
        {
            "source_id": "M1", "target_id": "TC7", "relation": "ASSOCIATED_WITH",
            "required_for_crossing": True, "threshold_relevance": "BLOCKING", "reviewed": True,
        },
        {
            "source_id": "TC7", "target_id": "T1", "relation": "HAS_TRANSFER_PROBE",
            "required_for_crossing": True, "reviewed": True, "problem_version": "p1",
            "rubric_version": "r1", "assessment_version": "a1",
        },
    ])
    # A new version is immutable and independent of the previous graph.
    graph["version"] = "v2"
    for node in graph["nodes"]:
        node["curriculum_version"] = "v2"
    for edge in graph["edges"]:
        edge["curriculum_version"] = "v2"
    service.publish_graph(CurriculumGraph.model_validate(graph))
    scope = SCOPE.model_copy(update={"curriculum_version": "v2"})
    context = service.context(scope, "TC8", mode="individual")
    assert {"tc_id": "TC7", "action": "DIAGNOSTIC_PROBE", "reason": "INSUFFICIENT_EVIDENCE"} in context["prerequisite_gaps"]
    assert context["likely_bottlenecks"] == []
    assert "STRUGGLING" not in json.dumps(context)
    assert not any(record["record_type"] == "learner_snapshot" for record in repository.records.values())


def test_cross_tenant_cohort_is_rejected_before_any_storage_read():
    service, repository, _extractor, _graph = service_fixture()
    repository.reads.clear()
    foreign = SCOPE.model_copy(update={"tenant_id": "another-tenant", "student_id": "other"})
    with pytest.raises(ValueError, match="cannot mix"):
        service.cohort([SCOPE, foreign])
    assert repository.reads == []


def test_cohort_counts_unassessed_roster_and_never_loads_evidence():
    service, repository, _extractor, _graph = service_fixture()
    scopes = [SCOPE.model_copy(update={"student_id": f"learner-{index}"}) for index in range(3)]
    repository.reads.clear()
    result = service.cohort(scopes)
    assert result["complete"] is True
    assert result["total_students"] == result["student_count"] == 3
    assert result["threshold_counts"]["TC8"]["NOT_CROSSED"] == 3
    assert result["misconception_counts"]["M1"]["NOT_ASSESSED"] == 3
    assert result["unassessed_students"] == 3
    assert result["evidence_loaded"] is False
    assert not any(identity.startswith(("evidence_", "extraction_")) for _store, _partition, identity in repository.reads)


def test_cohort_ru_limit_produces_truthful_partial_coverage_and_offset():
    service, _repository, _extractor, _graph = service_fixture()
    replace_settings(service, max_query_ru=2)
    scopes = [SCOPE.model_copy(update={"student_id": f"learner-{index}"}) for index in range(3)]
    result = service.cohort(scopes)
    assert result["complete"] is False
    assert result["partial"] is True
    assert result["total_students"] == 3
    assert result["student_count"] == 1
    assert result["coverage"] == 1 / 3
    assert result["next_offset"] == 1
    second = service.cohort(scopes, offset=result["next_offset"])
    assert second["students"][0]["student_ref"] == "S2"
    assert second["next_offset"] == 2


def test_too_small_context_fails_explicitly():
    service, _repository, _extractor, _graph = service_fixture()
    replace_settings(service, max_context_tokens=128)
    with pytest.raises(MemoryCapacityError):
        service.context(SCOPE, "TC8")


def test_zero_hop_context_never_expands_to_misconception_or_probe_nodes():
    service, _repository, _extractor, _graph = service_fixture()
    replace_settings(service, max_hops=0)
    context = service.context(SCOPE, "TC8")
    assert [node["id"] for node in context["nodes"]] == ["TC8"]
    assert context["edges"] == []
    assert "max_hops" in context["bounds_applied"]


def test_default_context_retains_at_least_one_grounded_explanation():
    service, _repository, _extractor, _graph = service_fixture()
    result = submit(service, "M1-A", "qa")
    service.process_event(SCOPE, result["receipt"]["event_id"])
    replace_settings(service, max_context_tokens=3000)
    context = service.context(SCOPE, "TC8", mode="individual")
    assert context["evidence"]
    assert "definition excludes repeated vertices" in context["evidence"][0]["untrusted_learner_content"]
    assert context["observations"]


def test_freshness_guard_and_scheduled_revalidation_revoke_expired_crossing(monkeypatch):
    service, repository, _extractor, _graph = service_fixture()
    for problem, quiz in (("M1-A", "qa"), ("M1-B", "qb"), ("T1", "qt")):
        result = submit(service, problem, quiz)
        service.process_event(SCOPE, result["receipt"]["event_id"])
    snapshot = service.get_snapshot(SCOPE)
    assert snapshot.threshold_states["TC8"].state == "CROSSED"
    later = snapshot.next_revalidation_at + timedelta(seconds=1)
    for module in ("events", "service", "processor", "retrieval"):
        monkeypatch.setattr(f"learner_memory.{module}.utc_now", lambda: later)
    guarded = service.get_snapshot(SCOPE)
    assert guarded.threshold_states["TC8"].state == "CANDIDATE"
    assert guarded.profile.crossed_tcs == []
    assert guarded.profile.needs_revalidation
    assert read_snapshot(repository, SCOPE)[0].threshold_states["TC8"].state == "CROSSED"
    processor = MemoryProcessor(service)
    processor.schedule_expired()
    receipts = [record["payload"] for record in repository.records.values() if record["record_type"] == "processing_receipt" and record["payload"]["status"] == "PENDING"]
    assert len(receipts) == 1
    service.process_event(SCOPE, receipts[0]["event_id"])
    assert service.get_snapshot(SCOPE).threshold_states["TC8"].state == "CANDIDATE"
    assert any(
        item["from_state"] == "CROSSED" and item["to_state"] == "CANDIDATE"
        for record in repository.records.values() if record["record_type"] == "state_transition"
        for item in record["payload"]["transitions"]
    )
