"""Durable, idempotent learner input and append-only ledger records."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, TypeVar

from pydantic import BaseModel

from azure_services.persistence.learner_memory import (
    MemoryCapacityError,
    MemoryConflictError,
    MemoryIntegrityError,
    MemoryRepository,
    StoreName,
    WriteOperation,
    canonical_json,
    content_hash,
    verify_record_integrity,
)
from backend.schemas.learner_memory import (
    LearningEvent,
    LearningEventInput,
    LearnerSnapshot,
    MemoryScope,
    ProcessingReceipt,
    opaque_key,
)
from learner_memory.settings import MemorySettings


logger = logging.getLogger(__name__)
ModelT = TypeVar("ModelT", bound=BaseModel)
_INLINE_ARCHIVE_THRESHOLD_BYTES = 32_768


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_text(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def event_identity(event_id: str) -> str:
    return opaque_key("event", event_id)


def receipt_identity(event_id: str) -> str:
    return opaque_key("receipt", event_id)


def snapshot_identity(scope: MemoryScope) -> str:
    return opaque_key("snapshot", scope.curriculum_id, scope.curriculum_version, str(scope.learning_epoch))


def cursor_identity(scope: MemoryScope) -> str:
    return opaque_key("cursor", scope.curriculum_id, scope.curriculum_version, str(scope.learning_epoch))


def record_document(
    record_type: str, identity: str, scope: MemoryScope, payload: BaseModel | dict[str, Any],
    **indexes: Any,
) -> dict[str, Any]:
    body = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
    return {
        "id": identity,
        "partitionKey": scope.partition_key,
        "record_type": record_type,
        "scope": scope.model_dump(mode="json"),
        "payload": body,
        **indexes,
    }


def parse_record(document: dict[str, Any], model: type[ModelT], scope: MemoryScope) -> ModelT:
    verify_record_integrity(document)
    if document.get("partitionKey") != scope.partition_key:
        raise MemoryIntegrityError("Learner record belongs to another partition")
    stored_scope = MemoryScope.model_validate(document.get("scope"))
    if stored_scope != scope:
        raise MemoryIntegrityError("Learner record belongs to another scope, version, or epoch")
    value = model.model_validate(document.get("payload"))
    if getattr(value, "scope", scope) != scope:
        raise MemoryIntegrityError("Learner record payload scope differs from its envelope")
    return value


def receipt_document(receipt: ProcessingReceipt) -> dict[str, Any]:
    return record_document(
        "processing_receipt", receipt_identity(receipt.event_id), receipt.scope, receipt,
        status=receipt.status.value,
        next_attempt_at=utc_text(receipt.next_retry_at or receipt.accepted_at or utc_now()),
        lease_until=utc_text(receipt.lease_expires_at) if receipt.lease_expires_at else None,
        sequence=receipt.sequence,
    )


def read_receipt(
    repository: MemoryRepository, scope: MemoryScope, event_id: str,
) -> tuple[ProcessingReceipt, dict[str, Any]] | None:
    record = repository.read("learner", scope.partition_key, receipt_identity(event_id))
    if record is None:
        return None
    return parse_record(record, ProcessingReceipt, scope), record


def read_snapshot(
    repository: MemoryRepository, scope: MemoryScope,
) -> tuple[LearnerSnapshot, dict[str, Any]] | None:
    record = repository.read("learner", scope.partition_key, snapshot_identity(scope))
    if record is None:
        return None
    return parse_record(record, LearnerSnapshot, scope), record


def append_immutable(
    repository: MemoryRepository, record: dict[str, Any], *, store: StoreName = "learner",
) -> dict[str, Any]:
    if store not in {"learner", "graph"}:
        raise ValueError("Unknown memory store")
    partition, identity = record["partitionKey"], record["id"]
    digest = content_hash({key: value for key, value in record.items() if not key.startswith("_")})
    document = {**record, "integrity_hash": digest}
    previous = repository.read(store, partition, identity)
    if previous is not None:
        if previous.get("integrity_hash") != digest:
            raise MemoryConflictError("An immutable record with different content already exists")
        return previous
    try:
        repository.batch(store, partition, [WriteOperation("create", document)])
    except MemoryConflictError:
        previous = repository.read(store, partition, identity)
        if previous is None or previous.get("integrity_hash") != digest:
            raise
        return previous
    stored = repository.read(store, partition, identity)
    if stored is None:
        raise MemoryIntegrityError("Committed immutable memory record could not be read")
    return stored


def accept_learning_event(
    repository: MemoryRepository, settings: MemorySettings, scope: MemoryScope,
    request: LearningEventInput, policy_version: str, *, actor_id: str | None = None,
    now: datetime | None = None, extra_creates: list[dict[str, Any]] | None = None,
    artifact_override: dict[str, Any] | None = None,
) -> ProcessingReceipt:
    moment = now or utc_now()
    if request.occurred_at > moment:
        raise ValueError("Learner evidence cannot occur in the future")
    # Receipt time is server-owned; an HTTP retry must not change its semantic hash.
    request_data = request.model_dump(mode="json")
    digest = content_hash({
        "scope": scope.model_dump(mode="json"),
        "request": {key: value for key, value in request_data.items() if key != "occurred_at"},
        "actor_id": actor_id or scope.student_id,
        "attachment_hash": artifact_override["sha256"] if artifact_override else None,
    })
    raw_input = canonical_json(request_data)
    if len(raw_input) > settings.max_event_bytes:
        raise MemoryCapacityError("Learning event exceeds the configured byte limit")

    for _attempt in range(settings.worker_max_attempts):
        existing = repository.read("learner", scope.partition_key, event_identity(request.event_id))
        if existing is not None:
            event = parse_record(existing, LearningEvent, scope)
            if event.content_hash != digest:
                raise MemoryConflictError("Event ID was already used for different input")
            receipt = read_receipt(repository, scope, request.event_id)
            if receipt is None:
                raise MemoryIntegrityError("A learning event has no processing receipt")
            return receipt[0]

        cursor_id = cursor_identity(scope)
        cursor = repository.read("learner", scope.partition_key, cursor_id)
        if cursor is not None and MemoryScope.model_validate(cursor["scope"]) != scope:
            raise MemoryIntegrityError("Learning stream cursor scope mismatch")
        sequence = int(cursor["sequence"]) + 1 if cursor else 1
        event = LearningEvent(
            **request.model_dump(),
            scope=scope, sequence=sequence, received_at=moment, content_hash=digest,
            policy_version=policy_version, actor_id=actor_id or scope.student_id,
        )
        receipt = ProcessingReceipt(
            scope=scope, event_id=event.event_id, sequence=sequence,
            accepted_at=moment, updated_at=moment, next_retry_at=moment,
        )
        artifact = artifact_override or (repository.put_artifact(
            scope.partition_key, event_identity(event.event_id), raw_input, "application/json",
        ) if len(raw_input) > _INLINE_ARCHIVE_THRESHOLD_BYTES else None)
        next_cursor = record_document("stream_cursor", cursor_id, scope, {}, sequence=sequence)
        operations = [
            WriteOperation("create", record_document(
                "learning_event", event_identity(event.event_id), scope, event, sequence=sequence, artifact=artifact,
            )),
            WriteOperation("create", receipt_document(receipt)),
            WriteOperation("replace" if cursor else "create", next_cursor, cursor.get("_etag") if cursor else None),
            *[WriteOperation("create", item) for item in (extra_creates or [])],
        ]
        try:
            repository.batch("learner", scope.partition_key, operations)
            logger.info("Learner event accepted event=%s learner=%s sequence=%s", event_identity(event.event_id), scope.partition_key, sequence)
            return receipt
        except MemoryConflictError:
            if extra_creates and any(
                repository.read("learner", scope.partition_key, item["id"]) is not None
                for item in extra_creates
            ):
                raise
            continue
    raise MemoryConflictError("Learning input is contended; retry with the same event ID")


def list_scope_records(
    repository: MemoryRepository, scope: MemoryScope, record_type: str, *,
    max_items: int, page_size: int = 100, max_pages: int = 100,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    continuation = None
    seen_cursors: set[str] = set()
    for _page in range(max_pages):
        page = repository.page(
            "learner", scope.partition_key, record_type,
            filters={
                "scope.curriculum_id": scope.curriculum_id,
                "scope.curriculum_version": scope.curriculum_version,
                "scope.learning_epoch": scope.learning_epoch,
            },
            limit=min(page_size, max_items - len(records) + 1),
            continuation=continuation,
        )
        records.extend(page.items)
        if len(records) > max_items:
            raise MemoryCapacityError("Learner history exceeds the configured replay budget; no partial state was published")
        continuation = page.continuation
        if not continuation:
            return records
        if continuation in seen_cursors:
            raise MemoryIntegrityError("Memory query returned a repeated continuation token")
        seen_cursors.add(continuation)
    raise MemoryCapacityError("Learner query exceeded the configured page budget")
