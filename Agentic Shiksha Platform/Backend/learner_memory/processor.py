"""Leased processing and atomic publication of learner snapshots."""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from datetime import timedelta
from typing import TYPE_CHECKING
from uuid import uuid4

from azure_services.persistence.learner_memory import (
    MemoryCapacityError,
    MemoryConflictError,
    MemoryIntegrityError,
    WriteOperation,
    canonical_json,
)
from backend.schemas.learner_memory import (
    EventType,
    EvidenceSource,
    LearningEvent,
    LearningEventInput,
    LearningProfile,
    LearnerSnapshot,
    MemoryScope,
    ObservationSet,
    ProcessingReceipt,
    ProcessingStage,
    ProcessingStatus,
    opaque_key,
)
from learner_memory.events import (
    append_immutable,
    event_identity,
    parse_record,
    read_receipt,
    read_snapshot,
    receipt_document,
    record_document,
    snapshot_identity,
    utc_now,
    utc_text,
)
from learner_memory.observations import EXTRACTOR_VERSION, FoundryObservationExtractor, validate_observation_set

if TYPE_CHECKING:
    from learner_memory.service import MemoryService


logger = logging.getLogger(__name__)


class MemoryProcessor:
    def __init__(self, service: MemoryService):
        self.service = service
        self.repository = service.repository
        self.settings = service.settings

    def _load_claim(self, scope: MemoryScope, event_id: str, owner: str):
        pair = read_receipt(self.repository, scope, event_id)
        if pair is None:
            raise MemoryIntegrityError("Processing receipt disappeared")
        receipt, record = pair
        if receipt.lease_owner != owner or receipt.lease_expires_at is None or receipt.lease_expires_at <= utc_now():
            raise MemoryConflictError("Learner processing lease changed or expired")
        return receipt, record

    def claim(self, scope: MemoryScope, event_id: str) -> ProcessingReceipt:
        pair = read_receipt(self.repository, scope, event_id)
        if pair is None:
            raise ValueError("Learning event has not been accepted")
        receipt, record = pair
        if receipt.status in {ProcessingStatus.COMPLETED, ProcessingStatus.REJECTED, ProcessingStatus.FAILED}:
            return receipt
        now = utc_now()
        if receipt.lease_expires_at and receipt.lease_expires_at > now:
            raise MemoryConflictError("Another worker is processing this learning event")
        if receipt.next_retry_at and receipt.next_retry_at > now and receipt.error_code != "PREVIOUS_EVENT_PENDING":
            return receipt
        if self.service.current_scope(scope) != scope:
            rejected = receipt.model_copy(update={
                "status": ProcessingStatus.REJECTED, "error_code": "LEARNING_EPOCH_CLOSED",
                "updated_at": now, "lease_owner": None, "lease_expires_at": None,
            })
            self.repository.batch("learner", scope.partition_key, [
                WriteOperation("replace", receipt_document(rejected), record["_etag"]),
            ])
            return rejected
        current = read_snapshot(self.repository, scope)
        expected = (current[0].last_processed_sequence if current else 0) + 1
        if receipt.sequence != expected:
            deferred = receipt.model_copy(update={
                "next_retry_at": now + timedelta(seconds=self.settings.worker_retry_base_seconds),
                "updated_at": now, "error_code": "PREVIOUS_EVENT_PENDING",
            })
            self.repository.batch("learner", scope.partition_key, [
                WriteOperation("replace", receipt_document(deferred), record["_etag"]),
            ])
            raise MemoryConflictError("Earlier learner input must be processed first")
        claimed = receipt.model_copy(update={
            "status": ProcessingStatus.PROCESSING,
            "processing_run_id": opaque_key("run", event_id, uuid4().hex),
            "lease_owner": uuid4().hex, "lease_expires_at": now + timedelta(seconds=self.settings.worker_lease_seconds),
            "attempts": receipt.attempts + 1, "updated_at": now, "error_code": None,
        })
        self.repository.batch("learner", scope.partition_key, [
            WriteOperation("replace", receipt_document(claimed), record["_etag"]),
        ])
        return claimed

    def renew(self, scope: MemoryScope, event_id: str, owner: str) -> None:
        receipt, record = self._load_claim(scope, event_id, owner)
        renewed = receipt.model_copy(update={
            "lease_expires_at": utc_now() + timedelta(seconds=self.settings.worker_lease_seconds),
            "updated_at": utc_now(),
        })
        self.repository.batch("learner", scope.partition_key, [
            WriteOperation("replace", receipt_document(renewed), record["_etag"]),
        ])

    def checkpoint(self, scope: MemoryScope, event_id: str, owner: str, stage: ProcessingStage) -> None:
        receipt, record = self._load_claim(scope, event_id, owner)
        updated = receipt.model_copy(update={"stage": stage, "updated_at": utc_now()})
        self.repository.batch("learner", scope.partition_key, [
            WriteOperation("replace", receipt_document(updated), record["_etag"]),
        ])

    def process(self, scope: MemoryScope, event_id: str) -> ProcessingReceipt:
        claimed = self.claim(scope, event_id)
        if claimed.status != ProcessingStatus.PROCESSING:
            return claimed
        return self.process_claimed(claimed)

    def process_claimed(self, claimed: ProcessingReceipt) -> ProcessingReceipt:
        from learner_memory.state import reduce_learner_state

        scope, event_id, owner = claimed.scope, claimed.event_id, claimed.lease_owner
        if not owner:
            raise MemoryIntegrityError("A processing lease owner is required")
        try:
            event_record = self.repository.read("learner", scope.partition_key, event_identity(event_id))
            if event_record is None:
                raise MemoryIntegrityError("Processing receipt has no durable event")
            event = parse_record(event_record, LearningEvent, scope)
            graph = self.service.get_graph(scope)
            previous_pair = read_snapshot(self.repository, scope)
            previous = previous_pair[0] if previous_pair else None
            if (previous.last_processed_sequence if previous else 0) + 1 != event.sequence:
                raise MemoryConflictError("Learner snapshot advanced during processing")
            self.checkpoint(scope, event_id, owner, ProcessingStage.EVIDENCE)
            evidence = self.service.build_evidence(event, graph)
            for item in evidence:
                artifact = event_record.get("artifact")
                if artifact:
                    item.provenance = item.provenance.model_copy(update={"artifact_ref": artifact["path"]})
                append_immutable(self.repository, record_document(
                    "evidence", item.evidence_id, scope, item, sequence=event.sequence, artifact=artifact,
                ))
            self.checkpoint(scope, event_id, owner, ProcessingStage.EXTRACTION)
            extraction_id = opaque_key("extraction", event_id, EXTRACTOR_VERSION)
            extraction_record = self.repository.read("learner", scope.partition_key, extraction_id)
            if extraction_record is None:
                extracted = self.service.extractor.extract(evidence, graph, event.received_at) if evidence else ObservationSet(
                    scope=scope, event_id=event_id, extractor_version=EXTRACTOR_VERSION,
                    observation_set_id=extraction_id, created_at=event.received_at,
                )
                validate_observation_set(extracted, evidence, graph)
                if extracted.scope != scope or extracted.event_id != event_id:
                    raise MemoryIntegrityError("Extractor returned a different learner event")
                if len(canonical_json(extracted.model_dump(mode="json"))) > self.settings.max_snapshot_bytes:
                    raise MemoryCapacityError("Observation set exceeds its byte budget")
                document = record_document(
                    "observation_set", extraction_id, scope, extracted, sequence=event.sequence,
                )
                try:
                    append_immutable(self.repository, document)
                except MemoryConflictError:
                    # A lease recovery may finish extraction first. Only the saved set wins.
                    saved = self.repository.read("learner", scope.partition_key, extraction_id)
                    if saved is None:
                        raise
                    parse_record(saved, ObservationSet, scope)
            else:
                parse_record(extraction_record, ObservationSet, scope)

            self.checkpoint(scope, event_id, owner, ProcessingStage.REDUCTION)
            now = max(event.received_at, previous.as_of) if previous else event.received_at
            all_evidence = []
            if event.event_type == EventType.RESET:
                snapshot = LearnerSnapshot(
                    scope=scope, snapshot_version=(previous.snapshot_version if previous else 0) + 1,
                    last_processed_sequence=event.sequence, as_of=now, policy_version=graph.policies.version,
                    profile=LearningProfile(
                        curriculum_id=scope.curriculum_id, curriculum_version=scope.curriculum_version,
                        policy_version=graph.policies.version,
                        snapshot_version=(previous.snapshot_version if previous else 0) + 1,
                        evidence_watermark=event.sequence, updated_at=now,
                    ),
                )
            else:
                all_evidence = self.service.list_evidence(scope, through_sequence=event.sequence)
                observations = self.service.list_observations(scope, through_sequence=event.sequence)
                if len(all_evidence) + len(observations) > self.settings.max_replay_records:
                    raise MemoryCapacityError("Learner reduction exceeds its total replay-record budget")
                affected = set(event.tc_ids)
                for item in evidence:
                    affected.update(item.tc_ids)
                new_observations = [item for item in observations if item.event_id == event_id]
                for item in new_observations:
                    affected.update(judgment.tc_id for judgment in item.concept_demonstrations)
                    affected.update(judgment.tc_id for judgment in item.transfer_judgments if judgment.tc_id)
                    targets = set(item.supports) | set(item.contradicts)
                    affected.update(
                        edge.target_id for edge in graph.edges
                        if edge.relation.value == "ASSOCIATED_WITH" and edge.source_id in targets
                    )
                snapshot = reduce_learner_state(
                    scope, graph, all_evidence, observations, previous, now,
                    affected_tc_ids=None if event.source == EvidenceSource.SYSTEM_REVALIDATION else sorted(affected),
                )
                snapshot.last_processed_sequence = event.sequence
                snapshot.snapshot_version = (previous.snapshot_version if previous else 0) + 1
                snapshot.profile.snapshot_version = snapshot.snapshot_version
                snapshot.profile.evidence_watermark = event.sequence
                snapshot.profile.updated_at = now
                if previous:
                    for identity, state in snapshot.threshold_states.items():
                        old = previous.threshold_states.get(identity)
                        if old and (old.state.value == "CROSSED" or "REGRESSION_AFTER_CROSSING" in old.reason_codes) and state.state.value != "CROSSED":
                            state.reason_codes = sorted(set([*state.reason_codes, "REGRESSION_AFTER_CROSSING"]))
            if len(canonical_json(snapshot.model_dump(mode="json"))) > self.settings.max_snapshot_bytes:
                raise MemoryCapacityError("Learner snapshot exceeds its configured byte budget")
            if sum(len(collection) for collection in (
                snapshot.misconception_states, snapshot.concept_states, snapshot.threshold_states,
            )) > self.settings.max_snapshot_states:
                raise MemoryCapacityError("Learner snapshot exceeds its configured state limit")
            self.checkpoint(scope, event_id, owner, ProcessingStage.PUBLICATION)
            receipt, receipt_record = self._load_claim(scope, event_id, owner)
            completed = receipt.model_copy(update={
                "status": ProcessingStatus.COMPLETED, "stage": ProcessingStage.COMPLETED,
                "lease_owner": None, "lease_expires_at": None, "next_retry_at": None,
                "result_snapshot_version": snapshot.snapshot_version, "updated_at": now,
                "error_code": None,
            })
            history = record_document(
                "state_transition", opaque_key("transition", event_id), scope,
                {
                    "event_id": event_id, "snapshot_version": snapshot.snapshot_version,
                    "previous_snapshot_version": previous.snapshot_version if previous else 0,
                    "policy_version": graph.policies.version, "as_of": utc_text(now),
                    "transitions": self._transitions(previous, snapshot),
                    "observation_set_id": extraction_id,
                },
                sequence=event.sequence,
            )
            operations = [
                WriteOperation(
                    "replace" if previous_pair else "create",
                    record_document(
                        "learner_snapshot", snapshot_identity(scope), scope, snapshot,
                        evidence_source_counts=dict(Counter(item.source.value for item in all_evidence)),
                    ),
                    previous_pair[1]["_etag"] if previous_pair else None,
                ),
                WriteOperation("create", history),
                WriteOperation("replace", receipt_document(completed), receipt_record["_etag"]),
            ]
            if event.event_type == EventType.RESET:
                operations.extend(self._epoch_operations(scope, event_id, graph.policies.version))
            self.repository.batch("learner", scope.partition_key, operations)
            logger.info(
                "Learner snapshot committed event=%s learner=%s snapshot=%d transitions=%d",
                event_identity(event_id), scope.partition_key, snapshot.snapshot_version, len(history["payload"]["transitions"]),
            )
            return completed
        except Exception as error:
            pair = read_receipt(self.repository, scope, event_id)
            if pair and pair[0].status == ProcessingStatus.COMPLETED:
                return pair[0]
            if pair and pair[0].lease_owner == owner:
                now = utc_now()
                retryable = pair[0].attempts < self.settings.worker_max_attempts
                failed = pair[0].model_copy(update={
                    "status": ProcessingStatus.RETRY_PENDING if retryable else ProcessingStatus.FAILED,
                    "lease_owner": None, "lease_expires_at": None,
                    "next_retry_at": now + timedelta(seconds=self.settings.worker_retry_base_seconds * 2 ** (pair[0].attempts - 1)) if retryable else None,
                    "updated_at": now, "error_code": type(error).__name__,
                })
                try:
                    self.repository.batch("learner", scope.partition_key, [
                        WriteOperation("replace", receipt_document(failed), pair[1]["_etag"]),
                        WriteOperation("create", record_document(
                            "processing_failure", opaque_key("failure", pair[0].processing_run_id or owner), scope,
                            {"event_id": event_id, "run_id": pair[0].processing_run_id,
                             "stage": pair[0].stage.value, "error_code": type(error).__name__,
                             "attempt": pair[0].attempts, "recorded_at": utc_text(now)},
                            sequence=pair[0].sequence,
                        )),
                    ])
                except MemoryConflictError:
                    logger.warning("Learner failure receipt changed concurrently event=%s", event_identity(event_id))
            logger.error("Learner processing failed event=%s error_type=%s", event_identity(event_id), type(error).__name__)
            raise

    def _epoch_operations(self, scope: MemoryScope, event_id: str, policy_version: str) -> list[WriteOperation]:
        identity = opaque_key("epoch", scope.curriculum_id, scope.curriculum_version)
        previous = self.repository.read("learner", scope.partition_key, identity)
        current_epoch = int(previous["payload"]["learning_epoch"]) if previous else 1
        if current_epoch != scope.learning_epoch:
            raise MemoryConflictError("Learner epoch already changed")
        next_scope = scope.model_copy(update={"learning_epoch": current_epoch + 1})
        epoch = record_document(
            "learning_epoch", identity, scope,
            {"learning_epoch": current_epoch + 1, "trigger_event_id": event_id},
        )
        snapshot = LearnerSnapshot(
            scope=next_scope, as_of=utc_now(), policy_version=policy_version,
            profile=LearningProfile(
                curriculum_id=scope.curriculum_id, curriculum_version=scope.curriculum_version,
                policy_version=policy_version,
            ),
        )
        return [
            WriteOperation("replace" if previous else "create", epoch, previous["_etag"] if previous else None),
            WriteOperation("create", record_document("learner_snapshot", snapshot_identity(next_scope), next_scope, snapshot)),
        ]

    @staticmethod
    def _transitions(previous: LearnerSnapshot | None, current: LearnerSnapshot) -> list[dict]:
        result = []
        for collection, relation in (
            ("misconception_states", "MISCONCEPTION_STATE"),
            ("concept_states", "CONCEPT_STATE"),
            ("threshold_states", "THRESHOLD_STATE"),
        ):
            old_items = getattr(previous, collection) if previous else {}
            new_items = getattr(current, collection)
            for identity in sorted(set(old_items) | set(new_items)):
                old, new = old_items.get(identity), new_items.get(identity)
                if old == new:
                    continue
                result.append({
                    "relation": relation, "target_id": identity,
                    "from_state": old.state.value if old else None,
                    "to_state": new.state.value if new else None,
                    "from_version": old.state_version if old else 0,
                    "to_version": new.state_version if new else 0,
                    "evidence_ids": new.evidence_ids if new else [],
                    "observation_ids": new.observation_ids if new else [],
                    "reason_codes": new.reason_codes if new else ["LEARNING_EPOCH_RESET"],
                })
        return result

    def schedule_expired(self) -> None:
        now = utc_now()
        for record in self.repository.expired_snapshots(utc_text(now), self.settings.worker_batch_size):
            scope = MemoryScope.model_validate(record["scope"])
            snapshot = parse_record(record, LearnerSnapshot, scope)
            if snapshot.next_revalidation_at is None or self.service.current_scope(scope) != scope:
                continue
            identity = opaque_key(
                "expiry", scope.graph_key, str(scope.learning_epoch),
                str(snapshot.snapshot_version), utc_text(snapshot.next_revalidation_at),
            )
            self.service.accept_event(scope, LearningEventInput(
                event_id=identity, event_type=EventType.REVALIDATION,
                source=EvidenceSource.SYSTEM_REVALIDATION, source_id=identity,
                occurred_at=snapshot.next_revalidation_at,
            ))

    async def _run_receipt(self, record: dict) -> None:
        scope = MemoryScope.model_validate(record["scope"])
        receipt = parse_record(record, ProcessingReceipt, scope)
        try:
            claimed = await asyncio.to_thread(self.claim, scope, receipt.event_id)
            if claimed.status != ProcessingStatus.PROCESSING:
                return
            work = asyncio.create_task(asyncio.to_thread(self.process_claimed, claimed))
            while not work.done():
                done, _pending = await asyncio.wait({work}, timeout=max(1, self.settings.worker_lease_seconds / 3))
                if not done:
                    try:
                        await asyncio.to_thread(self.renew, scope, claimed.event_id, claimed.lease_owner)
                    except MemoryConflictError:
                        await work
                        raise
            await work
        except MemoryConflictError:
            logger.info("Learner work deferred after concurrency conflict event=%s", event_identity(receipt.event_id))
        except Exception as error:
            logger.error("Learner worker event failed event=%s error_type=%s", event_identity(receipt.event_id), type(error).__name__)

    async def run(self, stop: asyncio.Event) -> None:
        if not self.settings.enabled or not self.settings.worker_enabled:
            await stop.wait()
            return
        try:
            while not stop.is_set():
                try:
                    await asyncio.to_thread(self.schedule_expired)
                    records = await asyncio.to_thread(
                        self.repository.due_receipts, utc_text(utc_now()), self.settings.worker_batch_size,
                    )
                    semaphore = asyncio.Semaphore(self.settings.worker_concurrency)

                    async def bounded(record):
                        async with semaphore:
                            await self._run_receipt(record)

                    await asyncio.gather(*(bounded(record) for record in records))
                except Exception as error:
                    logger.error("Learner worker unavailable error_type=%s", type(error).__name__)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=self.settings.worker_poll_seconds)
                except asyncio.TimeoutError:
                    continue
        finally:
            if isinstance(self.service.extractor, FoundryObservationExtractor):
                self.service.extractor.close()
