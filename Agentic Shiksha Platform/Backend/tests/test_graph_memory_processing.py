from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import asyncio
import json
import base64

import pytest

from azure_services.persistence.learner_memory import MemoryConflictError, WriteOperation
from backend.schemas.learner_memory import (
    ConceptDemonstration,
    CurriculumGraph,
    EvidenceQuote,
    LearningEventInput,
    Observation,
    ObservationSet,
    RubricScore,
    TransferJudgment,
)
from graph_memory_fakes import FakeMemoryRepository
from learner_memory.events import event_identity, receipt_identity, utc_now, utc_text
from learner_memory.observations import EXTRACTOR_VERSION
from learner_memory.processor import MemoryProcessor
from learner_memory.service import MemoryService
from learner_memory.settings import MemorySettings
from test_graph_memory_policy import SCOPE, published_graph


class RulesExtractor:
    def __init__(self):
        self.calls = 0
        self.fail = False

    def extract(self, evidence, graph, now):
        self.calls += 1
        if self.fail:
            raise ValueError("Synthetic extraction failure")
        nodes = {node.id: node for node in graph.nodes}
        observations = []
        for source in evidence:
            problem = nodes.get(source.problem_id or "")
            if problem is None:
                continue
            correct = source.answer == problem.correct_key
            target_misconceptions = [
                edge.target_id for edge in graph.edges
                if edge.source_id == problem.id and edge.relation == "DIAGNOSES"
            ]
            dimensions = [RubricScore(dimension_id=dimension.id, score=1.0 if correct else 0.0) for dimension in problem.rubric_dimensions]
            observations.append(Observation(
                observation_id=f"observation-{source.evidence_id}", scope=source.scope, event_id=source.event_id,
                source_evidence=[source.evidence_id],
                supports=target_misconceptions if not correct else [],
                contradicts=target_misconceptions if correct else [],
                claim="Synthetic rubric interpretation", confidence=0.95,
                quotes=[EvidenceQuote(evidence_id=source.evidence_id, quote=source.reasoning or source.answer)],
                reasoning_result="SATISFIES_RUBRIC" if correct else "DOES_NOT_SATISFY_RUBRIC",
                rubric_dimensions=dimensions, extractor_version=EXTRACTOR_VERSION,
                extractor_kind="RULES", created_at=now,
                concept_demonstrations=[
                    ConceptDemonstration(
                        tc_id=tc, result="PASS" if correct else "FAIL", rubric_version=problem.rubric_version,
                        rubric_dimensions=dimensions,
                    ) for tc in source.tc_ids
                ] if problem.diagnostic_approved else [],
                transfer_judgments=[
                    TransferJudgment(
                        problem_id=problem.id, tc_id=tc, outcome="PASS" if correct else "FAIL",
                        rubric_version=problem.rubric_version, assessment_version=problem.assessment_version,
                        rubric_dimensions=dimensions,
                    ) for tc in source.tc_ids
                ] if problem.transfer_approved else [],
            ))
        return ObservationSet(
            scope=evidence[0].scope, event_id=evidence[0].event_id,
            extractor_version=EXTRACTOR_VERSION, observations=observations,
        )


def service_fixture():
    repository = FakeMemoryRepository()
    extractor = RulesExtractor()
    settings = MemorySettings(
        enabled=True, worker_enabled=True, observation_model="test-model",
        max_context_tokens=12000, max_query_ru=100,
    )
    service = MemoryService(repository, settings, extractor)
    payload = published_graph().model_dump(mode="json")
    for node in payload["nodes"]:
        if node["id"] == "M1-A":
            node["prompt"] = "Identify a path through a railway map and explain why revisiting a station matters."
        elif node["id"] == "M1-B":
            node["prompt"] = "Classify a route in a communication network using the repeated-router criterion."
        if node["id"] == "T1":
            node["options"] = [{"key": "A", "text": "Valid transfer"}, {"key": "B", "text": "Invalid transfer"}]
            node["correct_key"] = "A"
    graph = CurriculumGraph.model_validate(payload)
    service.publish_graph(graph)
    return service, repository, extractor, graph


def submit(service, problem, identity, *, selected=0, reason="The definition excludes repeated vertices."):
    public = service.freeze_assessment(SCOPE, [], "Diagnostic", [problem], identity)
    assert all("correct" not in question and "explanation" not in question for question in public["questions"])
    result = service.submit_assessment(SCOPE, identity, [{
        "problemId": problem, "selected": [selected], "reason": reason,
        "correct": [selected],  # Client-supplied answer keys are deliberately ignored.
    }], f"event-{identity}")
    return result


def test_first_submission_event_cursor_and_receipt_commit_together():
    service, repository, _extractor, _graph = service_fixture()
    result = submit(service, "M1-A", "quiz-a")
    commit = repository.commits[-1]
    assert {operation.document["record_type"] for operation in commit} == {
        "learning_event", "processing_receipt", "stream_cursor", "first_submission", "answer_exposure",
    }
    assert result["receipt"]["status"] == "PENDING"
    assert service.pending_count(SCOPE) == 1


def test_pipeline_distinguishes_clearance_mastery_transfer_and_lp():
    service, repository, extractor, _graph = service_fixture()
    first = submit(service, "M1-A", "quiz-a")
    service.process_event(SCOPE, first["receipt"]["event_id"])
    snapshot = service.get_snapshot(SCOPE)
    assert snapshot.misconception_states["M1"].state != "CLEARED"
    assert snapshot.threshold_states["TC8"].state != "CROSSED"
    second = submit(service, "M1-B", "quiz-b")
    service.process_event(SCOPE, second["receipt"]["event_id"])
    snapshot = service.get_snapshot(SCOPE)
    assert snapshot.misconception_states["M1"].state == "CLEARED"
    assert snapshot.concept_states["TC8"].state == "MASTERED"
    assert snapshot.threshold_states["TC8"].state == "CANDIDATE"
    assert snapshot.profile.crossed_tcs == []
    transfer = submit(service, "T1", "transfer")
    service.process_event(SCOPE, transfer["receipt"]["event_id"])
    snapshot = service.get_snapshot(SCOPE)
    assert snapshot.threshold_states["TC8"].state == "CROSSED"
    assert snapshot.profile.crossed_tcs == ["TC8"]
    assert snapshot.last_processed_sequence == 3
    assert extractor.calls == 3
    history = [record for record in repository.records.values() if record["record_type"] == "state_transition"]
    assert len(history) == 3
    assert history[-1]["payload"]["observation_set_id"]


def test_duplicate_event_and_submissions_do_not_repeat_inference():
    service, repository, extractor, _graph = service_fixture()
    first = submit(service, "M1-A", "quiz-a")
    event_id = first["receipt"]["event_id"]
    service.process_event(SCOPE, event_id)
    second = submit(service, "M1-A", "quiz-a")
    service.process_event(SCOPE, event_id)
    assert second["created"] is False
    assert service.get_snapshot(SCOPE).snapshot_version == 1
    assert extractor.calls == 1
    assert len([record for record in repository.records.values() if record["record_type"] == "learning_event"]) == 1
    with pytest.raises(MemoryConflictError):
        submit(service, "M1-A", "quiz-a", selected=1)


def test_client_key_cannot_change_server_grade():
    service, _repository, _extractor, _graph = service_fixture()
    result = submit(service, "M1-A", "quiz-wrong", selected=1, reason="I chose the second option.")
    assert result["score"] == 0
    assert result["answers"][0]["correct"] == [0]
    assert result["answers"][0]["isCorrect"] is False


def test_failed_extraction_preserves_receipt_and_last_complete_snapshot():
    service, repository, extractor, _graph = service_fixture()
    result = submit(service, "M1-A", "quiz-a")
    extractor.fail = True
    with pytest.raises(ValueError, match="Synthetic"):
        service.process_event(SCOPE, result["receipt"]["event_id"])
    assert service.get_snapshot(SCOPE).snapshot_version == 0
    receipt = service.get_receipt(SCOPE, result["receipt"]["event_id"])
    assert receipt.status == "RETRY_PENDING"
    assert receipt.error_code == "ValueError"
    assert any(record["record_type"] == "evidence" for record in repository.records.values())
    assert not any(record["record_type"] == "state_transition" for record in repository.records.values())


def test_publication_retry_reuses_saved_observations():
    service, repository, extractor, _graph = service_fixture()
    result = submit(service, "M1-A", "quiz-a")
    event_id = result["receipt"]["event_id"]
    original = repository.batch
    failed = False

    def fail_publication(store, partition, operations):
        nonlocal failed
        if not failed and any(operation.document["record_type"] == "learner_snapshot" for operation in operations):
            failed = True
            raise RuntimeError("Synthetic commit outage")
        return original(store, partition, operations)

    repository.batch = fail_publication
    with pytest.raises(RuntimeError):
        service.process_event(SCOPE, event_id)
    assert service.get_snapshot(SCOPE).snapshot_version == 0
    pair = repository.read("learner", SCOPE.partition_key, receipt_identity(event_id))
    pair["payload"]["next_retry_at"] = utc_text(utc_now() - timedelta(seconds=1))
    pair["next_attempt_at"] = pair["payload"]["next_retry_at"]
    original("learner", SCOPE.partition_key, [WriteOperation("replace", pair, pair["_etag"])])
    service.process_event(SCOPE, event_id)
    assert extractor.calls == 1
    assert service.get_snapshot(SCOPE).snapshot_version == 1


def test_two_concurrent_inputs_have_distinct_ordered_sequences():
    service, repository, _extractor, _graph = service_fixture()

    def accept(index):
        return service.accept_event(SCOPE, LearningEventInput(
            event_id=f"message-{index}", event_type="LEARNER_MESSAGE", source="LEARNER_CHAT",
            source_id=f"input-{index}", occurred_at=utc_now(), answer=f"Explanation {index}",
        ))

    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(accept, [1, 2]))
    assert sorted(receipt.sequence for receipt in receipts) == [1, 2]
    later = max(receipts, key=lambda receipt: receipt.sequence)
    with pytest.raises(MemoryConflictError, match="Earlier"):
        service.process_event(SCOPE, later.event_id)
    for receipt in sorted(receipts, key=lambda receipt: receipt.sequence):
        service.process_event(SCOPE, receipt.event_id)
    assert service.get_snapshot(SCOPE).last_processed_sequence == 2
    assert len([record for record in repository.records.values() if record["record_type"] == "state_transition"]) == 2


def test_reset_opens_new_epoch_and_retains_original_evidence():
    service, repository, _extractor, _graph = service_fixture()
    result = submit(service, "M1-A", "quiz-a")
    service.process_event(SCOPE, result["receipt"]["event_id"])
    reset = service.reset(SCOPE, "reset-1")
    service.process_event(SCOPE, reset.event_id)
    current = service.current_scope(SCOPE)
    assert current.learning_epoch == 2
    assert service.get_snapshot(current).misconception_states == {}
    assert any(record["record_type"] == "evidence" and record["scope"]["learning_epoch"] == 1 for record in repository.records.values())
    with pytest.raises(MemoryConflictError, match="epoch"):
        service.accept_event(SCOPE, LearningEventInput(
            event_id="stale", event_type="LEARNER_MESSAGE", source="LEARNER_CHAT",
            source_id="stale", occurred_at=utc_now(), answer="Old tab",
        ))


def test_same_event_id_with_different_input_is_rejected():
    service, repository, _extractor, _graph = service_fixture()
    request = LearningEventInput(
        event_id="message-1", event_type="LEARNER_MESSAGE", source="LEARNER_CHAT",
        source_id="message-1", occurred_at=utc_now(), answer="Original explanation",
    )
    service.accept_event(SCOPE, request)
    with pytest.raises(MemoryConflictError, match="different input"):
        service.accept_event(SCOPE, request.model_copy(update={"answer": "Changed explanation"}))
    assert repository.read("learner", SCOPE.partition_key, event_identity("message-1"))["payload"]["answer"] == "Original explanation"


def test_conversation_links_are_owned_and_survive_epoch_changes():
    service, _repository, _extractor, _graph = service_fixture()
    service.bind_conversation(SCOPE, "conversation-a", "message-1")
    assert service.owns_conversation(SCOPE, "conversation-a")
    assert not service.owns_conversation(SCOPE.model_copy(update={"student_id": "student-b"}), "conversation-a")
    assert service.owns_conversation(SCOPE.model_copy(update={"learning_epoch": 2}), "conversation-a")


def test_durable_worker_processes_accepted_input_and_stops_cleanly():
    service, _repository, _extractor, _graph = service_fixture()
    result = submit(service, "M1-A", "worker-quiz")

    async def exercise():
        stop = asyncio.Event()
        worker = asyncio.create_task(service.worker(stop))
        try:
            for _attempt in range(100):
                receipt = service.get_receipt(SCOPE, result["receipt"]["event_id"])
                if receipt.status == "COMPLETED":
                    return
                await asyncio.sleep(0.02)
            pytest.fail("The durable worker did not process accepted input")
        finally:
            stop.set()
            await asyncio.wait_for(worker, timeout=5)

    asyncio.run(exercise())
    assert service.get_snapshot(SCOPE).snapshot_version == 1


def test_large_raw_input_has_private_integrity_checked_artifact():
    service, repository, _extractor, _graph = service_fixture()
    answer = "A longer learner explanation. " * 2000
    event = LearningEventInput(
        event_id="large-input", event_type="LEARNER_MESSAGE", source="LEARNER_CHAT",
        source_id="large-input", occurred_at=utc_now(), answer=answer,
    )
    service.accept_event(SCOPE, event)
    service.process_event(SCOPE, event.event_id)
    evidence = service.list_evidence(SCOPE)
    assert len(repository.artifacts) == 1
    assert evidence[0].provenance.artifact_ref is not None
    data, media_type = service.evidence_artifact(SCOPE, evidence[0].evidence_id)
    assert media_type == "application/json"
    assert json.loads(data)["answer"] == answer


def test_published_version_cannot_be_overwritten():
    service, _repository, _extractor, graph = service_fixture()
    assert service.publish_graph(graph).content_hash == graph.content_hash
    changed = graph.model_copy(update={"course_name": "Changed published course"})
    with pytest.raises(MemoryConflictError):
        service.publish_graph(changed)
    with pytest.raises(MemoryConflictError):
        service.save_draft(graph)
    versions = service.list_versions(SCOPE.tenant_id, SCOPE.curriculum_id, SCOPE.institute_id)
    assert [item["version"] for item in versions["versions"]] == ["v1"]


def test_new_quiz_id_cannot_launder_a_previously_revealed_answer():
    service, _repository, _extractor, _graph = service_fixture()
    first = submit(service, "M1-A", "first-seen")
    service.process_event(SCOPE, first["receipt"]["event_id"])
    repeated = submit(service, "M1-A", "different-instance")
    service.process_event(SCOPE, repeated["receipt"]["event_id"])
    evidence = service.list_evidence(SCOPE)
    repeat_evidence = next(item for item in evidence if item.event_id == repeated["receipt"]["event_id"])
    assert repeat_evidence.assistance == "ANSWER_REVEALED"
    assert service.get_snapshot(SCOPE).misconception_states["M1"].state != "CLEARED"


def test_inline_images_are_archived_and_bound_to_the_event_identity():
    service, repository, _extractor, _graph = service_fixture()
    image = "data:image/png;base64," + base64.b64encode(b"synthetic image bytes").decode()
    event = LearningEventInput(
        event_id="image-input", event_type="LEARNER_MESSAGE", source="LEARNER_CHAT",
        source_id="image-input", occurred_at=utc_now(), answer="My diagram",
    )
    service.accept_event(SCOPE, event, artifacts=[image])
    service.process_event(SCOPE, event.event_id)
    evidence = service.list_evidence(SCOPE)[0]
    data, _media_type = service.evidence_artifact(SCOPE, evidence.evidence_id)
    assert json.loads(data)["image_urls"] == [image]
    assert service.accept_event(SCOPE, event, artifacts=[image]).status == "COMPLETED"
    changed = "data:image/png;base64," + base64.b64encode(b"different bytes").decode()
    with pytest.raises(MemoryConflictError):
        service.accept_event(SCOPE, event, artifacts=[changed])
    assert len(repository.artifacts) == 1


def test_chat_edit_cannot_supersede_a_frozen_diagnostic_answer():
    service, _repository, _extractor, _graph = service_fixture()
    quiz = submit(service, "M1-A", "wrong-answer", selected=1)
    event = LearningEventInput(
        event_id="edit-attempt", event_type="LEARNER_MESSAGE", source="LEARNER_CHAT",
        source_id="edit-attempt", occurred_at=utc_now(), answer="Actually I was correct",
        supersedes_event_id=quiz["receipt"]["event_id"],
    )
    with pytest.raises(ValueError, match="original chat"):
        service.accept_event(SCOPE, event)
