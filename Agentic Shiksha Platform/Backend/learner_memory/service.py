"""Application-facing operations over the graph and evidence ledger."""

from __future__ import annotations

import json
import logging
import threading
import base64
import hashlib
from datetime import datetime
from typing import Any

from azure_services.persistence.learner_memory import (
    MemoryCapacityError,
    MemoryConflictError,
    MemoryIntegrityError,
    MemoryRepository,
    WriteOperation,
    canonical_json,
    content_hash,
    get_repository,
)
from backend.schemas.learner_memory import (
    AnswerKeySource,
    Assistance,
    CurriculumGraph,
    EdgeRelation,
    Evidence,
    EvidenceProvenance,
    EvidenceQuality,
    EvidenceSource,
    EventType,
    LearningEvent,
    LearningEventInput,
    LearningProfile,
    LearnerSnapshot,
    MemoryScope,
    NodeType,
    ObservationSet,
    ProcessingReceipt,
    ProcessingStatus,
    PublicationStatus,
    opaque_key,
)
from learner_memory.events import (
    accept_learning_event,
    append_immutable,
    cursor_identity,
    event_identity,
    list_scope_records,
    parse_record,
    read_receipt,
    read_snapshot,
    record_document,
    utc_now,
    utc_text,
)
from learner_memory.observations import FoundryObservationExtractor, ObservationExtractor
from learner_memory.settings import MemorySettings, get_memory_settings


logger = logging.getLogger(__name__)


class MemoryService:
    def __init__(
        self, repository: MemoryRepository, settings: MemorySettings | None = None,
        extractor: ObservationExtractor | None = None,
    ):
        self.repository = repository
        self.settings = settings or get_memory_settings()
        self.extractor = extractor or FoundryObservationExtractor(self.settings.observation_model)

    def read_scope_registry(self, tenant_id: str, institute_id: str) -> dict[str, Any] | None:
        key = opaque_key("scope", tenant_id, institute_id)
        record = self.repository.read("graph", key, key)
        if record is None:
            return None
        registry = record["payload"]
        if registry.get("tenant_id") != tenant_id or registry.get("institute_id") != institute_id:
            raise MemoryIntegrityError("Memory institute registry scope mismatch")
        return registry

    def register_scope(self, tenant_id: str, institute_id: str, administrator_ids: list[str]) -> dict[str, Any]:
        if not tenant_id.strip() or not institute_id.strip() or not administrator_ids or any(not identity.strip() for identity in administrator_ids):
            raise ValueError("A scope needs immutable identities and at least one administrator")
        key = opaque_key("scope", tenant_id, institute_id)
        payload = {
            "tenant_id": tenant_id, "institute_id": institute_id,
            "administrator_ids": sorted(set(administrator_ids)),
        }
        append_immutable(self.repository, {
            "id": key, "partitionKey": key, "record_type": "scope_registry", "payload": payload,
        }, store="graph")
        return payload

    def read_graph(self, tenant_id: str, curriculum_id: str, version: str) -> CurriculumGraph | None:
        key = opaque_key("cg", tenant_id, curriculum_id, version)
        record = self.repository.read("graph", key, key)
        if record is None:
            return None
        graph = CurriculumGraph.model_validate(record["payload"])
        if graph.graph_key != key or graph.status != PublicationStatus.PUBLISHED:
            raise MemoryIntegrityError("Published curriculum identity or status mismatch")
        return graph

    def get_graph(self, scope: MemoryScope) -> CurriculumGraph:
        graph = self.read_graph(scope.tenant_id, scope.curriculum_id, scope.curriculum_version)
        if graph is None:
            raise ValueError("Publish the bound curriculum before using learner memory")
        if scope.institute_id not in graph.institute_ids:
            raise MemoryIntegrityError("Curriculum is not shared with this institute")
        if graph.course_ids and scope.course_id not in graph.course_ids:
            raise MemoryIntegrityError("Curriculum is not bound to this course offering")
        return graph

    def read_draft(self, tenant_id: str, curriculum_id: str, version: str) -> dict[str, Any] | None:
        key = opaque_key("cg", tenant_id, curriculum_id, version)
        record = self.repository.read("graph", key, opaque_key("draft", key))
        if record is None:
            return None
        graph = CurriculumGraph.model_validate(record["payload"])
        if graph.graph_key != key:
            raise MemoryIntegrityError("Curriculum draft identity mismatch")
        return {"id": record["id"], "revision": record["_etag"], "graph": graph.model_dump(mode="json")}

    def save_draft(self, graph: CurriculumGraph, expected_revision: str | None = None) -> dict[str, Any]:
        from learner_memory.curriculum import validate_graph

        graph = CurriculumGraph.model_validate({
            **graph.model_dump(mode="json"), "status": "DRAFT", "published_ready": False,
        })
        validate_graph(graph)
        self._check_graph_limits(graph)
        if self.read_graph(graph.tenant_id, graph.curriculum_id, graph.version) is not None:
            raise MemoryConflictError("A published curriculum version cannot be edited; create a new version")
        identity = opaque_key("draft", graph.graph_key)
        previous = self.repository.read("graph", graph.graph_key, identity)
        if previous is not None and previous["_etag"] != expected_revision:
            raise MemoryConflictError("Curriculum draft changed; reload before saving")
        if previous is None and expected_revision is not None:
            raise MemoryConflictError("Curriculum draft no longer exists")
        document = {
            "id": identity, "partitionKey": graph.graph_key,
            "record_type": "curriculum_draft", "payload": graph.model_dump(mode="json"),
        }
        self.repository.batch("graph", graph.graph_key, [
            WriteOperation("replace" if previous else "create", document, expected_revision),
        ])
        result = self.read_draft(graph.tenant_id, graph.curriculum_id, graph.version)
        if result is None:
            raise MemoryIntegrityError("Saved curriculum draft could not be read")
        return result

    def _check_graph_limits(self, graph: CurriculumGraph) -> None:
        if len(graph.nodes) > self.settings.max_graph_nodes or len(graph.edges) > self.settings.max_graph_edges:
            raise MemoryCapacityError("Curriculum exceeds configured graph size limits")
        if len(canonical_json(graph.model_dump(mode="json"))) > self.settings.max_graph_bytes:
            raise MemoryCapacityError("Curriculum exceeds configured graph byte limit")

    def publish_graph(self, graph: CurriculumGraph) -> CurriculumGraph:
        from learner_memory.curriculum import validate_graph

        graph = CurriculumGraph.model_validate({
            **graph.model_dump(mode="json"), "status": "PUBLISHED", "published_ready": True,
        })
        validate_graph(graph)
        self._check_graph_limits(graph)
        append_immutable(self.repository, {
            "id": graph.graph_key, "partitionKey": graph.graph_key,
            "record_type": "curriculum_graph", "payload": graph.model_dump(mode="json"),
        }, store="graph")
        catalog_key = opaque_key("catalog", graph.tenant_id, graph.curriculum_id)
        append_immutable(self.repository, {
            "id": opaque_key("version", graph.version), "partitionKey": catalog_key,
            "record_type": "curriculum_version",
            "payload": {
                "tenant_id": graph.tenant_id, "curriculum_id": graph.curriculum_id,
                "version": graph.version, "institute_ids": list(graph.institute_ids),
                "graph_hash": graph.content_hash, "reviewed_by": graph.reviewed_by,
                "reviewed_at": graph.reviewed_at.isoformat() if graph.reviewed_at else None,
                "policy_version": graph.policies.version,
            },
        }, store="graph")
        return graph

    def list_versions(
        self, tenant_id: str, curriculum_id: str, institute_id: str,
        continuation: str | None = None,
    ) -> dict[str, Any]:
        key = opaque_key("catalog", tenant_id, curriculum_id)
        page = self.repository.page(
            "graph", key, "curriculum_version", limit=self.settings.query_page_size,
            continuation=continuation,
        )
        versions = []
        for record in page.items:
            version = record["payload"]
            if version["tenant_id"] != tenant_id or version["curriculum_id"] != curriculum_id:
                raise MemoryIntegrityError("Curriculum version catalog scope mismatch")
            if institute_id in version["institute_ids"]:
                versions.append(version)
        return {"versions": versions, "continuation": page.continuation}

    def get_snapshot(self, scope: MemoryScope) -> LearnerSnapshot:
        graph = self.get_graph(scope)
        stored = read_snapshot(self.repository, scope)
        if stored is not None:
            from learner_memory.retrieval import fresh_snapshot_view

            return fresh_snapshot_view(stored[0], graph)
        return LearnerSnapshot(
            scope=scope, policy_version=graph.policies.version,
            profile=LearningProfile(
                curriculum_id=scope.curriculum_id, curriculum_version=scope.curriculum_version,
                policy_version=graph.policies.version,
            ),
        )

    def current_scope(self, scope: MemoryScope) -> MemoryScope:
        identity = opaque_key("epoch", scope.curriculum_id, scope.curriculum_version)
        record = self.repository.read("learner", scope.partition_key, identity)
        if record is None:
            return scope
        stored = MemoryScope.model_validate(record["scope"])
        if stored.model_dump(exclude={"learning_epoch"}) != scope.model_dump(exclude={"learning_epoch"}):
            raise MemoryIntegrityError("Learner epoch pointer scope mismatch")
        epoch = record["payload"].get("learning_epoch")
        if type(epoch) is not int or epoch < 1:
            raise MemoryIntegrityError("Invalid learner epoch pointer")
        return scope.model_copy(update={"learning_epoch": epoch})

    def bind_conversation(self, scope: MemoryScope, conversation_id: str, event_id: str) -> None:
        if not conversation_id.strip():
            raise ValueError("Conversation identity is required")
        identity = opaque_key("conversation", conversation_id)
        existing = self.repository.read("learner", scope.partition_key, identity)
        if existing:
            if not self.owns_conversation(scope, conversation_id):
                raise MemoryIntegrityError("Conversation ownership changed")
            return
        append_immutable(self.repository, record_document(
            "conversation_binding", identity, scope,
            {"conversation_id": conversation_id, "origin_event_id": event_id},
        ))

    def owns_conversation(self, scope: MemoryScope, conversation_id: str) -> bool:
        record = self.repository.read("learner", scope.partition_key, opaque_key("conversation", conversation_id))
        if record is None:
            return False
        stored = MemoryScope.model_validate(record["scope"])
        keys = ("tenant_id", "institute_id", "course_id", "student_id")
        if any(getattr(stored, key) != getattr(scope, key) for key in keys):
            raise MemoryIntegrityError("Conversation binding scope mismatch")
        return record["payload"]["conversation_id"] == conversation_id

    def pending_count(self, scope: MemoryScope) -> int:
        cursor = self.repository.read("learner", scope.partition_key, cursor_identity(scope))
        if cursor is None:
            return 0
        if MemoryScope.model_validate(cursor["scope"]) != scope:
            raise MemoryIntegrityError("Learning cursor scope mismatch")
        snapshot = read_snapshot(self.repository, scope)
        processed = snapshot[0].last_processed_sequence if snapshot else 0
        return max(0, int(cursor["sequence"]) - processed)

    def next_receipt(self, scope: MemoryScope) -> ProcessingReceipt | None:
        snapshot = read_snapshot(self.repository, scope)
        sequence = (snapshot[0].last_processed_sequence if snapshot else 0) + 1
        page = self.repository.page(
            "learner", scope.partition_key, "processing_receipt",
            filters={
                "scope.curriculum_id": scope.curriculum_id, "scope.curriculum_version": scope.curriculum_version,
                "scope.learning_epoch": scope.learning_epoch, "sequence": sequence,
            },
            limit=1,
        )
        return parse_record(page.items[0], ProcessingReceipt, scope) if page.items else None

    def retry_failed_input(self, scope: MemoryScope, operation_id: str, actor_id: str) -> bool:
        from learner_memory.events import receipt_document

        if self.current_scope(scope) != scope:
            raise MemoryConflictError("Cannot retry input from a closed learning epoch")
        audit_id = opaque_key("retry", operation_id)
        if self.repository.read("learner", scope.partition_key, audit_id) is not None:
            return False
        receipt = self.next_receipt(scope)
        if receipt is None or receipt.status != ProcessingStatus.FAILED:
            return False
        pair = read_receipt(self.repository, scope, receipt.event_id)
        if pair is None:
            raise MemoryIntegrityError("Failed processing receipt disappeared")
        now = utc_now()
        retried = pair[0].model_copy(update={
            "status": ProcessingStatus.PENDING, "attempts": 0, "next_retry_at": now,
            "lease_owner": None, "lease_expires_at": None, "updated_at": now, "error_code": None,
        })
        self.repository.batch("learner", scope.partition_key, [
            WriteOperation("replace", receipt_document(retried), pair[1]["_etag"]),
            WriteOperation("create", record_document(
                "processing_retry", audit_id, scope,
                {"event_id": receipt.event_id, "operation_id": operation_id, "actor_id": actor_id,
                 "previous_error_code": receipt.error_code, "requested_at": utc_text(now)},
            )),
        ])
        return True

    def accept_event(
        self, scope: MemoryScope, event: LearningEventInput, *, actor_id: str | None = None,
        artifacts: list[str] | None = None,
    ) -> ProcessingReceipt:
        graph = self.get_graph(scope)
        if self.current_scope(scope) != scope:
            raise MemoryConflictError("Learning epoch changed; reload before submitting new input")
        nodes = {node.id: node for node in graph.nodes}
        if any(identity not in nodes or nodes[identity].type != NodeType.TC for identity in event.tc_ids):
            raise ValueError("Learning event references an unknown threshold concept")
        if any(identity not in nodes or nodes[identity].type != NodeType.PROBLEM for identity in event.problem_ids):
            raise ValueError("Learning event references an unknown problem")
        if event.supersedes_event_id:
            predecessor = self.repository.read("learner", scope.partition_key, event_identity(event.supersedes_event_id))
            if predecessor is None:
                raise ValueError("Superseded learner event does not exist")
            original = parse_record(predecessor, LearningEvent, scope)
            if (
                event.source != EvidenceSource.LEARNER_CHAT or original.source != EvidenceSource.LEARNER_CHAT
                or original.actor_id != scope.student_id or (actor_id or scope.student_id) != scope.student_id
                or (original.thread_id is not None and original.thread_id != event.thread_id)
            ):
                raise ValueError("Only the learner's original chat input can be superseded by a chat edit")
        artifact = None
        if artifacts:
            if len(artifacts) > 8:
                raise ValueError("At most eight inline learner images can be captured")
            if sum(len(value.encode("utf-8")) for value in artifacts) > self.settings.max_artifact_bytes:
                raise MemoryCapacityError("Learner attachments exceed the private evidence byte budget")
            for value in artifacts:
                prefix, separator, encoded = value.partition(";base64,")
                if not separator or prefix not in {"data:image/png", "data:image/jpeg", "data:image/webp", "data:image/gif"}:
                    raise ValueError("Persistent image evidence requires an inline raster image")
                if not base64.b64decode(encoded, validate=True):
                    raise ValueError("An image evidence payload must not be empty")
            bundle = canonical_json({
                "event": event.model_dump(mode="json", exclude={"occurred_at"}),
                "image_urls": artifacts,
            })
            if len(bundle) > self.settings.max_artifact_bytes:
                raise MemoryCapacityError("Learner attachments exceed the private evidence byte budget")
            existing = self.repository.read("learner", scope.partition_key, event_identity(event.event_id))
            if existing is not None:
                parse_record(existing, LearningEvent, scope)
                artifact = existing.get("artifact")
                if not isinstance(artifact, dict) or artifact.get("sha256") != hashlib.sha256(bundle).hexdigest():
                    raise MemoryConflictError("Event ID was already used with different attachments")
            else:
                artifact = self.repository.put_artifact(
                    scope.partition_key, event_identity(event.event_id), bundle, "application/json",
                )
        return accept_learning_event(
            self.repository, self.settings, scope, event, graph.policies.version, actor_id=actor_id,
            artifact_override=artifact,
        )

    def get_receipt(self, scope: MemoryScope, event_id: str) -> ProcessingReceipt | None:
        receipt = read_receipt(self.repository, scope, event_id)
        return receipt[0] if receipt else None

    def get_evidence(self, scope: MemoryScope, evidence_id: str) -> Evidence | None:
        document = self.repository.read("learner", scope.partition_key, evidence_id)
        if document is None:
            return None
        if document.get("record_type") != "evidence":
            raise ValueError("The reference does not identify learner evidence")
        return parse_record(document, Evidence, scope)

    def evidence_artifact(self, scope: MemoryScope, evidence_id: str) -> tuple[bytes, str]:
        document = self.repository.read("learner", scope.partition_key, evidence_id)
        if document is None:
            raise ValueError("Learner evidence not found")
        parse_record(document, Evidence, scope)
        reference = document.get("artifact")
        if not isinstance(reference, dict):
            raise ValueError("This evidence has no private artifact")
        if type(reference.get("size")) is not int or not 0 <= reference["size"] <= self.settings.max_artifact_bytes:
            raise MemoryIntegrityError("Evidence artifact exceeds the allowed read size")
        return self.repository.get_artifact(scope.partition_key, reference), str(reference["content_type"])

    def list_evidence(self, scope: MemoryScope, *, through_sequence: int | None = None) -> list[Evidence]:
        records = list_scope_records(
            self.repository, scope, "evidence", max_items=self.settings.max_evidence_per_reduction,
            page_size=self.settings.query_page_size, max_pages=self.settings.max_query_pages,
        )
        evidence = [parse_record(record, Evidence, scope) for record in records]
        return [item for item in evidence if through_sequence is None or item.event_sequence <= through_sequence]

    def list_observations(self, scope: MemoryScope, *, through_sequence: int | None = None) -> list:
        records = list_scope_records(
            self.repository, scope, "observation_set",
            max_items=self.settings.max_observations_per_reduction, page_size=self.settings.query_page_size,
            max_pages=self.settings.max_query_pages,
        )
        observations = []
        for record in records:
            if through_sequence is not None and int(record["sequence"]) > through_sequence:
                continue
            observations.extend(parse_record(record, ObservationSet, scope).observations)
            if len(observations) > self.settings.max_observations_per_reduction:
                raise MemoryCapacityError("Observation replay limit exceeded; no partial state was published")
        return observations

    def process_event(self, scope: MemoryScope, event_id: str) -> ProcessingReceipt:
        from learner_memory.processor import MemoryProcessor

        return MemoryProcessor(self).process(scope, event_id)

    async def worker(self, stop) -> None:
        from learner_memory.processor import MemoryProcessor

        await MemoryProcessor(self).run(stop)

    def context(self, scope: MemoryScope, tc_id: str | None = None, mode: str = "ta") -> dict[str, Any]:
        from learner_memory.retrieval import student_context

        return student_context(self, scope, tc_id=tc_id, mode=mode)

    def cohort(self, scopes: list[MemoryScope], tc_id: str | None = None, offset: int = 0) -> dict[str, Any]:
        from learner_memory.retrieval import cohort_summary

        return cohort_summary(self, scopes, tc_id=tc_id, offset=offset)

    def recompute(self, scope: MemoryScope) -> ProcessingReceipt:
        snapshot = self.get_snapshot(scope)
        now = utc_now()
        identity = opaque_key("recompute", scope.graph_key, str(snapshot.snapshot_version), utc_text(now))
        self.retry_failed_input(scope, identity, "migration")
        return self.accept_event(scope, LearningEventInput(
            event_id=identity, event_type=EventType.REVALIDATION,
            source=EvidenceSource.SYSTEM_REVALIDATION, source_id=identity, occurred_at=now,
        ))

    def import_legacy_evidence(self, scope: MemoryScope, records: list[dict[str, Any]]) -> list[ProcessingReceipt]:
        receipts = []
        for record in records:
            reference = str(record.get("id") or record.get("assetId") or content_hash(record))
            identity = opaque_key("legacy", scope.graph_key, reference)
            source_time = record.get("occurred_at") or record.get("submittedAt") or record.get("createdAt") or record.get("timestamp")
            occurred = datetime.fromisoformat(source_time.replace("Z", "+00:00")) if isinstance(source_time, str) else utc_now()
            if occurred.tzinfo is None:
                raise ValueError("Legacy evidence timestamps must specify a time zone")
            receipts.append(self.accept_event(scope, LearningEventInput(
                event_id=identity, event_type=EventType.ENGAGEMENT, source=EvidenceSource.LEGACY_IMPORT,
                source_id=opaque_key("legacy_source", reference), occurred_at=occurred,
                answer=json.dumps(record, ensure_ascii=False, sort_keys=True),
            ), actor_id="migration"))
        return receipts

    def reset(self, scope: MemoryScope, event_id: str) -> ProcessingReceipt:
        return self.accept_event(scope, LearningEventInput(
            event_id=event_id, event_type=EventType.RESET,
            source=EvidenceSource.SYSTEM_REVALIDATION, source_id=event_id, occurred_at=utc_now(),
        ))

    def _assessment(self, scope: MemoryScope, instance_id: str) -> dict[str, Any]:
        identity = opaque_key("assessment", instance_id)
        record = self.repository.read("learner", scope.partition_key, identity)
        if record is None:
            raise ValueError("The server assessment instance was not found")
        if MemoryScope.model_validate(record["scope"]) != scope:
            raise MemoryIntegrityError("Assessment belongs to another learner, curriculum, or epoch")
        return record

    def public_assessment(self, scope: MemoryScope, instance_id: str) -> dict[str, Any]:
        payload = self._assessment(scope, instance_id)["payload"]
        return {
            "type": "quiz", "quizId": instance_id, "assessmentInstanceId": instance_id,
            "curriculumVersion": scope.curriculum_version, "title": payload["title"],
            "assessmentType": "concept_inventory" if all(item["catalog_approved"] for item in payload["questions"]) else "practice_quiz",
            "serverGraded": True,
            "questions": [
                {
                    "problemId": item["problem_id"], "question": item["question"],
                    "options": [option["text"] for option in item["options"]],
                    "optionKeys": [option["key"] for option in item["options"]],
                    "multiple": len(item["correct_keys"]) > 1,
                } for item in payload["questions"]
            ],
        }

    def freeze_assessment(
        self, scope: MemoryScope, questions: list[dict], title: str,
        problem_ids: list[str], instance_id: str,
    ) -> dict[str, Any]:
        graph = self.get_graph(scope)
        nodes = {node.id: node for node in graph.nodes}
        if not instance_id.strip() or len(instance_id) > 256 or not 1 <= len(problem_ids or questions) <= 50:
            raise ValueError("A server assessment requires an identity and 1-50 items")
        frozen = []
        if problem_ids:
            if len(problem_ids) != len(set(problem_ids)):
                raise ValueError("Duplicate diagnostic problem")
            for problem_id in problem_ids:
                node = nodes.get(problem_id)
                if node is None or node.type != NodeType.PROBLEM or not node.active:
                    raise ValueError("The assessment references an unknown problem")
                if not node.options or node.correct_key is None:
                    raise ValueError("This problem needs an authored multiple-choice answer key")
                options = [{"key": option.key, "text": option.text} for option in node.options]
                frozen.append({
                    "problem_id": node.id, "question": node.prompt or node.name,
                    "options": options, "correct_keys": [node.correct_key], "explanation": node.description,
                    "catalog_approved": bool(node.diagnostic_approved or node.transfer_approved),
                })
        else:
            for index, question in enumerate(questions):
                options = question.get("options")
                correct = question.get("correct")
                keys = correct if isinstance(correct, list) else [correct]
                if not isinstance(options, list) or len(options) < 2 or not keys or any(type(key) is not int or not 0 <= key < len(options) for key in keys):
                    raise ValueError("Generated practice quiz has an invalid answer key")
                frozen.append({
                    "problem_id": opaque_key("practice", instance_id, str(index)),
                    "question": str(question.get("question") or ""),
                    "options": [{"key": str(position), "text": str(option)} for position, option in enumerate(options)],
                    "correct_keys": [str(key) for key in keys],
                    "explanation": str(question.get("explanation") or ""),
                    "catalog_approved": False,
                })
        payload = {
            "instance_id": instance_id, "title": title, "questions": frozen,
            "curriculum_version": scope.curriculum_version,
        }
        if len(canonical_json(payload)) > self.settings.max_event_bytes:
            raise MemoryCapacityError("Assessment instance exceeds its configured byte limit")
        append_immutable(self.repository, record_document(
            "assessment_instance", opaque_key("assessment", instance_id), scope, payload,
        ))
        return self.public_assessment(scope, instance_id)

    def assessment_status(self, scope: MemoryScope, instance_id: str) -> dict[str, Any]:
        self._assessment(scope, instance_id)
        identity = opaque_key("first_submission", instance_id)
        record = self.repository.read("learner", scope.partition_key, identity)
        if record is None:
            return {"exists": False, "assetId": None, "submittedAt": None}
        if MemoryScope.model_validate(record["scope"]) != scope:
            raise MemoryIntegrityError("Assessment submission scope mismatch")
        submission = record["payload"]
        receipt = self.get_receipt(scope, submission["event_id"])
        if receipt is None:
            raise MemoryIntegrityError("First assessment submission has no durable processing receipt")
        return {
            "exists": True, "assetId": identity, "submittedAt": submission["submitted_at"],
            "score": submission["score"], "totalQuestions": submission["total_questions"],
            "answers": submission["answers"], "receipt": receipt.model_dump(mode="json"),
        }

    @staticmethod
    def _answer_exposure_identity(question: dict[str, Any]) -> str:
        normalize = lambda value: " ".join(str(value).split()).casefold()
        return opaque_key("answer_exposure", content_hash({
            "question": normalize(question["question"]),
            "options": sorted(normalize(option["text"]) for option in question["options"]),
            "correct": sorted(
                normalize(option["text"]) for option in question["options"]
                if option["key"] in question["correct_keys"]
            ),
        }))

    def submit_assessment(
        self, scope: MemoryScope, instance_id: str, answers: list[dict], event_id: str,
    ) -> dict[str, Any]:
        instance = self._assessment(scope, instance_id)["payload"]
        if len(answers) != len(instance["questions"]):
            raise ValueError("Submit one response for each frozen assessment item")
        graded = []
        for question, answer in zip(instance["questions"], answers):
            if answer.get("problemId") not in (None, question["problem_id"]):
                raise ValueError("Assessment problem identity changed")
            selected = answer.get("selected")
            reason = str(answer.get("reason") or answer.get("reasoning") or "").strip()
            if not reason or not isinstance(selected, list) or not selected or any(type(index) is not int or not 0 <= index < len(question["options"]) for index in selected):
                raise ValueError("Each assessment answer requires valid selections and reasoning")
            selected = sorted(set(selected))
            keys = {question["options"][index]["key"] for index in selected}
            correct = [index for index, option in enumerate(question["options"]) if option["key"] in question["correct_keys"]]
            graded.append({
                "problemId": question["problem_id"], "question": question["question"],
                "options": [option["text"] for option in question["options"]],
                "selected": selected, "selectedKeys": sorted(keys), "correct": correct,
                "reason": reason, "isCorrect": keys == set(question["correct_keys"]),
                "explanation": question["explanation"],
            })
        payload_hash = content_hash({"instance_id": instance_id, "answers": graded})
        submission_id = opaque_key("first_submission", instance_id)
        graph = self.get_graph(scope)
        known_problems = {node.id for node in graph.nodes if node.type == NodeType.PROBLEM}
        for _attempt in range(self.settings.worker_max_attempts):
            previous = self.repository.read("learner", scope.partition_key, submission_id)
            created = previous is None
            exposure_records: dict[str, dict[str, Any]] = {}
            if previous is not None:
                if MemoryScope.model_validate(previous["scope"]) != scope:
                    raise MemoryIntegrityError("First assessment submission scope mismatch")
                if previous["payload"]["input_hash"] != payload_hash:
                    raise MemoryConflictError("The first assessment submission is already recorded")
                submission = previous["payload"]
            else:
                assistance = {}
                for question in instance["questions"]:
                    exposure_id = self._answer_exposure_identity(question)
                    exposure = self.repository.read("learner", scope.partition_key, exposure_id)
                    if exposure is not None:
                        owner = MemoryScope.model_validate(exposure["scope"])
                        if owner.partition_key != scope.partition_key:
                            raise MemoryIntegrityError("Answer exposure belongs to another learner")
                        assistance[question["problem_id"]] = Assistance.ANSWER_REVEALED.value
                    else:
                        assistance[question["problem_id"]] = Assistance.NO_RECORDED_HINT.value
                        exposure_records[exposure_id] = record_document(
                            "answer_exposure", exposure_id, scope,
                            {"first_instance_id": instance_id, "event_id": event_id, "recorded_at": utc_text(utc_now())},
                        )
                submission = {
                    "instance_id": instance_id, "event_id": event_id, "answers": graded,
                    "input_hash": payload_hash, "submitted_at": utc_text(utc_now()),
                    "score": sum(item["isCorrect"] for item in graded), "total_questions": len(graded),
                    "assistance_by_problem": assistance,
                }
            moment = datetime.fromisoformat(submission["submitted_at"].replace("Z", "+00:00"))
            request = LearningEventInput(
                event_id=submission["event_id"], event_type=EventType.QUIZ_SUBMISSION,
                source=EvidenceSource.DIAGNOSTIC_RESPONSE if all(item["catalog_approved"] for item in instance["questions"]) else EvidenceSource.QUIZ_RESPONSE,
                source_id=submission_id, occurred_at=moment,
                problem_ids=[item["problemId"] for item in submission["answers"] if item["problemId"] in known_problems],
                assessment_instance_id=instance_id, answer=json.dumps(submission["answers"], ensure_ascii=False),
            )
            try:
                receipt = accept_learning_event(
                    self.repository, self.settings, scope, request, graph.policies.version,
                    extra_creates=[
                        record_document("first_submission", submission_id, scope, submission),
                        *exposure_records.values(),
                    ] if created else [],
                )
            except MemoryConflictError:
                continue
            return {
                "created": created, "assetId": submission_id, "submittedAt": submission["submitted_at"],
                "score": submission["score"], "totalQuestions": submission["total_questions"],
                "answers": submission["answers"], "receipt": receipt.model_dump(mode="json"),
            }
        raise MemoryConflictError("Assessment is contended; retry the same submission")

    def build_evidence(self, event: LearningEvent, graph: CurriculumGraph) -> list[Evidence]:
        if event.source == EvidenceSource.SYSTEM_REVALIDATION:
            return []
        nodes = {node.id: node for node in graph.nodes}
        if event.assessment_instance_id is not None:
            instance = self._assessment(event.scope, event.assessment_instance_id)["payload"]
            submission = self.repository.read("learner", event.scope.partition_key, opaque_key("first_submission", event.assessment_instance_id))
            if submission is None or submission["payload"]["event_id"] != event.event_id:
                raise MemoryIntegrityError("Assessment event has no matching frozen first submission")
            parse_scope = MemoryScope.model_validate(submission["scope"])
            if parse_scope != event.scope:
                raise MemoryIntegrityError("Assessment evidence scope mismatch")
            if content_hash({
                "instance_id": event.assessment_instance_id, "answers": submission["payload"]["answers"],
            }) != submission["payload"]["input_hash"]:
                raise MemoryIntegrityError("Frozen assessment submission failed integrity validation")
            result = []
            for index, (item, question) in enumerate(zip(submission["payload"]["answers"], instance["questions"])):
                node = nodes.get(question["problem_id"])
                approved = bool(question["catalog_approved"] and node)
                tc_ids = [
                    edge.target_id for edge in graph.edges
                    if edge.source_id == question["problem_id"] and edge.relation == EdgeRelation.TESTS
                ]
                tc_ids.extend(
                    edge.source_id for edge in graph.edges
                    if edge.target_id == question["problem_id"] and edge.relation == EdgeRelation.HAS_TRANSFER_PROBE
                )
                misconceptions = [
                    edge.target_id for edge in graph.edges
                    if edge.source_id == question["problem_id"] and edge.relation == EdgeRelation.DIAGNOSES
                ]
                reliability = node.catalog_diagnostic_reliability if approved else None
                result.append(Evidence(
                    evidence_id=opaque_key("evidence", event.event_id, str(index)), event_id=event.event_id,
                    scope=event.scope, source=EvidenceSource.TRANSFER_RESPONSE if node and node.transfer_approved else event.source,
                    occurred_at=event.occurred_at, event_sequence=event.sequence, source_id=event.source_id,
                    answer=item["selectedKeys"][0] if len(item["selectedKeys"]) == 1 else json.dumps(item["selectedKeys"]),
                    reasoning=item["reason"], problem_id=node.id if node else None,
                    problem_version=node.problem_version if node else None,
                    assessment_instance_id=event.assessment_instance_id,
                    assessment_version=node.assessment_version if node else None,
                    rubric_id=node.rubric_id if node else None, rubric_version=node.rubric_version if node else None,
                    family_id=node.family_id if node else None,
                    context_id=event.assessment_instance_id, independence_key=node.family_id if node else None,
                    lineage_id=event.assessment_instance_id, tc_ids=sorted(set(tc_ids)), misconception_ids=misconceptions,
                    quality=EvidenceQuality(
                        score=reliability or 0.0, catalog_approved=approved,
                        diagnostic_reliability=reliability, provenance="published-catalog" if approved else "generated-practice",
                    ),
                    assistance=Assistance(submission["payload"].get("assistance_by_problem", {}).get(node.id if node else question["problem_id"], "UNKNOWN")),
                    answer_key_source=AnswerKeySource.SERVER_FROZEN_ASSESSMENT,
                    provenance=EvidenceProvenance(
                        server_verified=True, assessment_frozen=True,
                        actor_id=event.actor_id, content_hash=content_hash(item),
                    ),
                ))
            return result
        if event.source == EvidenceSource.TEACHER_ASSESSMENT and event.actor_id != event.scope.student_id and event.problem_ids:
            results = []
            for index, problem_id in enumerate(event.problem_ids):
                node = nodes[problem_id]
                approved = node.diagnostic_approved or node.transfer_approved
                tc_ids = {
                    edge.target_id for edge in graph.edges if edge.source_id == problem_id and edge.relation == EdgeRelation.TESTS
                }
                tc_ids.update(
                    edge.source_id for edge in graph.edges if edge.target_id == problem_id and edge.relation == EdgeRelation.HAS_TRANSFER_PROBE
                )
                results.append(Evidence(
                    evidence_id=opaque_key("evidence", event.event_id, str(index)), event_id=event.event_id,
                    scope=event.scope, source=event.source, occurred_at=event.occurred_at,
                    event_sequence=event.sequence, source_id=event.source_id,
                    answer=event.answer, reasoning=event.reasoning, tc_ids=sorted(tc_ids),
                    problem_id=node.id, problem_version=node.problem_version, family_id=node.family_id,
                    rubric_id=node.rubric_id, rubric_version=node.rubric_version, assessment_version=node.assessment_version,
                    context_id=event.source_id, independence_key=node.family_id, lineage_id=event.source_id,
                    quality=EvidenceQuality(
                        score=node.catalog_diagnostic_reliability or 0.0,
                        catalog_approved=approved, diagnostic_reliability=node.catalog_diagnostic_reliability,
                        provenance="teacher-reviewed-catalog-task",
                    ),
                    assistance=Assistance.NO_RECORDED_HINT, answer_key_source=AnswerKeySource.TEACHER_REVIEWED,
                    provenance=EvidenceProvenance(
                        server_verified=True, assessment_frozen=True, actor_id=event.actor_id,
                        content_hash=event.content_hash,
                    ),
                ))
            return results
        return [Evidence(
            evidence_id=opaque_key("evidence", event.event_id, "input"), event_id=event.event_id,
            scope=event.scope, source=event.source, occurred_at=event.occurred_at,
            event_sequence=event.sequence, source_id=event.source_id, thread_id=event.thread_id,
            answer=event.answer, reasoning=event.reasoning, tc_ids=event.tc_ids,
            lineage_id=event.supersedes_event_id or event.event_id,
            supersedes_event_id=event.supersedes_event_id,
            provenance=EvidenceProvenance(server_verified=True, actor_id=event.actor_id, content_hash=event.content_hash),
        )]


_service: MemoryService | None = None
_service_lock = threading.Lock()


def get_service() -> MemoryService:
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = MemoryService(get_repository())
    return _service
