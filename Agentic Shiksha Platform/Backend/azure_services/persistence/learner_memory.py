"""Scoped document operations for the learner ledger and shared curriculum."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from time import monotonic
from typing import Any, Literal, Protocol

from azure.core.exceptions import ResourceExistsError
from azure.cosmos.exceptions import CosmosHttpResponseError, CosmosResourceNotFoundError
from azure.storage.blob import ContentSettings


logger = logging.getLogger(__name__)
StoreName = Literal["graph", "learner"]
_FIELD = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$")
_SYSTEM_FIELDS = frozenset({"_etag", "_rid", "_self", "_ts", "_attachments"})


class MemoryConflictError(RuntimeError):
    """The caller must reload before attempting a conditional write again."""


class MemoryIntegrityError(RuntimeError):
    """Persisted identity, content, or scope did not match its contract."""


class MemoryCapacityError(RuntimeError):
    """A configured or database limit would be exceeded."""


class MemoryDisabledError(RuntimeError):
    """Graph Memory is not enabled on this backend."""


@dataclass
class ReadBudget:
    max_reads: int
    max_ru: float
    deadline: float
    reads: int = 0
    ru: float = 0.0

    def check(self) -> None:
        if self.reads > self.max_reads or self.ru > self.max_ru or monotonic() > self.deadline:
            raise MemoryCapacityError("Memory retrieval exceeded its read, request-unit, or time budget")


_read_budget: ContextVar[ReadBudget | None] = ContextVar("learner_memory_read_budget", default=None)


@contextmanager
def memory_read_budget(*, max_reads: int, max_ru: float, timeout_seconds: float):
    existing = _read_budget.get()
    if existing is not None:
        yield existing
        return
    budget = ReadBudget(max_reads, max_ru, monotonic() + timeout_seconds)
    token = _read_budget.set(budget)
    try:
        yield budget
    finally:
        _read_budget.reset(token)


def before_memory_read() -> bool:
    budget = _read_budget.get()
    if budget is None:
        return False
    budget.reads += 1
    budget.check()
    return True


def account_memory_charge(headers: Mapping[str, Any]) -> None:
    budget = _read_budget.get()
    if budget is None:
        return
    value = headers.get("x-ms-request-charge")
    if value is None:
        raise MemoryCapacityError("Request-unit metadata is unavailable; memory retrieval stopped")
    charge = float(value)
    if not math.isfinite(charge) or charge < 0:
        raise MemoryIntegrityError("Invalid memory request-unit metadata")
    budget.ru += charge
    budget.check()


@dataclass(frozen=True)
class WriteOperation:
    kind: Literal["create", "replace"]
    document: dict[str, Any]
    etag: str | None = None


@dataclass(frozen=True)
class RecordPage:
    items: list[dict[str, Any]]
    continuation: str | None = None


class MemoryRepository(Protocol):
    def read(self, store: StoreName, partition: str, identity: str) -> dict[str, Any] | None: ...

    def batch(self, store: StoreName, partition: str, operations: Sequence[WriteOperation]) -> list[dict[str, Any]]: ...

    def page(
        self, store: StoreName, partition: str, record_type: str, *,
        filters: Mapping[str, Any] | None = None, limit: int = 100,
        continuation: str | None = None,
    ) -> RecordPage: ...

    def due_receipts(self, now: str, limit: int) -> list[dict[str, Any]]: ...

    def expired_snapshots(self, now: str, limit: int) -> list[dict[str, Any]]: ...

    def put_artifact(self, partition: str, identity: str, content: bytes, content_type: str) -> dict[str, Any]: ...

    def get_artifact(self, partition: str, reference: Mapping[str, Any]) -> bytes: ...


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def document_body(document: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in document.items() if key not in _SYSTEM_FIELDS}


def verify_record_integrity(document: Mapping[str, Any]) -> None:
    expected = document.get("integrity_hash")
    if expected is not None:
        payload = {key: value for key, value in document_body(document).items() if key != "integrity_hash"}
        if content_hash(payload) != expected:
            raise MemoryIntegrityError("Immutable memory record failed its integrity check")


def _is_conflict(error: CosmosHttpResponseError) -> bool:
    if error.status_code in {409, 412}:
        return True
    responses = getattr(error, "operation_responses", None) or []
    return any(item.get("statusCode") in {409, 412} for item in responses)


class CosmosMemoryRepository:
    def __init__(self, graph_container: Any, learner_container: Any, blob_container: Any):
        self._containers = {"graph": graph_container, "learner": learner_container}
        self._blobs = blob_container

    def validate(self) -> None:
        for name, container in self._containers.items():
            properties = container.read()
            if properties.get("partitionKey", {}).get("paths") != ["/partitionKey"]:
                raise MemoryIntegrityError(f"The {name} memory container must use /partitionKey")
            if properties.get("defaultTtl") not in {None, -1}:
                raise MemoryIntegrityError("Automatic expiration must not delete learner history")
        properties = self._blobs.get_container_properties()
        if properties.get("public_access"):
            raise MemoryIntegrityError("Learner evidence storage must be private")

    def read(self, store: StoreName, partition: str, identity: str) -> dict[str, Any] | None:
        if not partition or not identity:
            raise ValueError("Memory reads require a partition and identity")
        budgeted = before_memory_read()
        accounted = False

        def response_hook(headers, _result):
            nonlocal accounted
            accounted = True
            account_memory_charge(headers)

        try:
            document = dict(self._containers[store].read_item(
                item=identity, partition_key=partition, response_hook=response_hook,
            ))
        except CosmosResourceNotFoundError as error:
            if budgeted and not accounted:
                account_memory_charge(error.headers)
            return None
        if budgeted and not accounted:
            raise MemoryCapacityError("Memory read did not provide request-unit metadata")
        if document.get("partitionKey") != partition or document.get("id") != identity:
            raise MemoryIntegrityError("Memory document identity or scope mismatch")
        verify_record_integrity(document)
        return document

    def batch(self, store: StoreName, partition: str, operations: Sequence[WriteOperation]) -> list[dict[str, Any]]:
        if not partition or not operations or len(operations) > 100:
            raise MemoryCapacityError("A memory transaction requires 1-100 scoped operations")
        prepared = []
        for operation in operations:
            document = document_body(operation.document)
            if document.get("partitionKey") != partition or not document.get("id"):
                raise MemoryIntegrityError("Cross-partition or unidentified memory write")
            if operation.kind == "create":
                prepared.append(("create", (document,), {}))
            else:
                if not operation.etag:
                    raise MemoryIntegrityError("Memory replacement requires an ETag")
                prepared.append(("replace", (document["id"], document), {"if_match_etag": operation.etag}))
        if len(canonical_json(prepared)) >= 1_900_000:
            raise MemoryCapacityError("Memory transaction exceeds the safe Cosmos payload budget")
        try:
            results = self._containers[store].execute_item_batch(
                batch_operations=prepared, partition_key=partition,
            )
        except CosmosHttpResponseError as error:
            if _is_conflict(error):
                raise MemoryConflictError("Memory changed; reload before retrying") from None
            raise
        documents = []
        for result in results:
            if result.get("statusCode", 500) >= 400:
                raise MemoryIntegrityError("Cosmos returned an unsuccessful memory transaction")
            body = dict(result.get("resourceBody") or {})
            if result.get("eTag") and not body.get("_etag"):
                body["_etag"] = result["eTag"]
            documents.append(body)
        return documents

    def page(
        self, store: StoreName, partition: str, record_type: str, *,
        filters: Mapping[str, Any] | None = None, limit: int = 100,
        continuation: str | None = None,
    ) -> RecordPage:
        if not partition or not record_type or not 1 <= limit <= 500:
            raise ValueError("Memory queries require a scope and a page size from 1 to 500")
        predicates = ["c.partitionKey = @partition", "c.record_type = @type"]
        parameters = [
            {"name": "@partition", "value": partition},
            {"name": "@type", "value": record_type},
        ]
        for index, (field, value) in enumerate((filters or {}).items()):
            if not _FIELD.fullmatch(field):
                raise ValueError("Invalid memory query field")
            parameter = f"@filter{index}"
            predicates.append(f"c.{field} = {parameter}")
            parameters.append({"name": parameter, "value": value})
        result = self._containers[store].query_items(
            query="SELECT * FROM c WHERE " + " AND ".join(predicates),
            parameters=parameters, partition_key=partition, max_item_count=limit,
            response_hook=lambda headers, _result: account_memory_charge(headers),
        )
        before_memory_read()
        pages = result.by_page(continuation_token=continuation)
        try:
            records = [dict(item) for item in next(pages)]
        except StopIteration:
            return RecordPage([])
        for record in records:
            if record.get("partitionKey") != partition or record.get("record_type") != record_type:
                raise MemoryIntegrityError("Memory query returned an out-of-scope document")
            verify_record_integrity(record)
        if len(records) > limit:
            raise MemoryCapacityError("Memory query exceeded its requested page size")
        return RecordPage(records, pages.continuation_token)

    def due_receipts(self, now: str, limit: int) -> list[dict[str, Any]]:
        if not 1 <= limit <= 100:
            raise ValueError("Invalid memory worker batch size")
        query = (
            "SELECT TOP @limit * FROM c WHERE c.record_type = 'processing_receipt' "
            "AND c.status IN ('PENDING', 'PROCESSING', 'RETRY_PENDING') "
            "AND c.next_attempt_at <= @now AND (IS_NULL(c.lease_until) OR c.lease_until <= @now)"
        )
        records = self._containers["learner"].query_items(
            query=query, parameters=[{"name": "@limit", "value": limit}, {"name": "@now", "value": now}],
            enable_cross_partition_query=True, max_item_count=limit,
        )
        items = []
        for record in records:
            items.append(dict(record))
            if len(items) == limit:
                break
        return items

    def expired_snapshots(self, now: str, limit: int) -> list[dict[str, Any]]:
        if not 1 <= limit <= 100:
            raise ValueError("Invalid revalidation batch size")
        records = self._containers["learner"].query_items(
            query=(
                "SELECT TOP @limit * FROM c WHERE c.record_type = 'learner_snapshot' "
                "AND IS_STRING(c.payload.next_revalidation_at) AND c.payload.next_revalidation_at <= @now"
            ),
            parameters=[{"name": "@limit", "value": limit}, {"name": "@now", "value": now}],
            enable_cross_partition_query=True, max_item_count=limit,
        )
        items = []
        for record in records:
            items.append(dict(record))
            if len(items) == limit:
                break
        return items

    def put_artifact(self, partition: str, identity: str, content: bytes, content_type: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", partition) or not re.fullmatch(r"[a-zA-Z0-9_-]+", identity):
            raise ValueError("Invalid private evidence identity")
        digest = hashlib.sha256(content).hexdigest()
        path = f"{partition}/{identity}/{digest}"
        blob = self._blobs.get_blob_client(path)
        try:
            blob.upload_blob(
                content, overwrite=False, metadata={"sha256": digest},
                content_settings=ContentSettings(content_type=content_type),
            )
        except ResourceExistsError:
            properties = blob.get_blob_properties()
            if properties.metadata.get("sha256") != digest or properties.size != len(content):
                raise MemoryIntegrityError("Existing evidence artifact has conflicting content") from None
        return {"path": path, "sha256": digest, "size": len(content), "content_type": content_type}

    def get_artifact(self, partition: str, reference: Mapping[str, Any]) -> bytes:
        path = str(reference.get("path") or "")
        if not path.startswith(f"{partition}/") or ".." in path.split("/"):
            raise MemoryIntegrityError("Evidence artifact is outside the learner scope")
        data = self._blobs.get_blob_client(path).download_blob().readall()
        if len(data) != reference.get("size") or hashlib.sha256(data).hexdigest() != reference.get("sha256"):
            raise MemoryIntegrityError("Evidence artifact failed integrity validation")
        return data


_repository: CosmosMemoryRepository | None = None
_repository_lock = threading.Lock()


def get_repository() -> CosmosMemoryRepository:
    global _repository
    if _repository is not None:
        return _repository
    from learner_memory.settings import get_memory_settings

    settings = get_memory_settings()
    if not settings.enabled:
        raise MemoryDisabledError("Graph Memory is disabled")
    with _repository_lock:
        if _repository is None:
            from azure_services.persistence.cosmos_db import COSMOS_DATABASE, _get_blob_service_client, get_cosmos_client

            database = get_cosmos_client().get_database_client(COSMOS_DATABASE)
            candidate = CosmosMemoryRepository(
                database.get_container_client(settings.graph_container_name),
                database.get_container_client(settings.learner_container_name),
                _get_blob_service_client().get_container_client(settings.evidence_container_name),
            )
            candidate.validate()
            _repository = candidate
    return _repository
