"""Transactional test double; never used by the application."""

from __future__ import annotations

import hashlib
import threading
from copy import deepcopy
from datetime import datetime

from azure_services.persistence.learner_memory import (
    MemoryConflictError,
    MemoryIntegrityError,
    RecordPage,
    WriteOperation,
    account_memory_charge,
    before_memory_read,
    verify_record_integrity,
)


class FakeMemoryRepository:
    def __init__(self):
        self.records: dict[tuple[str, str, str], dict] = {}
        self.artifacts: dict[str, bytes] = {}
        self.lock = threading.RLock()
        self.revision = 0
        self.reads: list[tuple[str, str, str]] = []
        self.commits: list[list[WriteOperation]] = []
        self.fail_next_batch: Exception | None = None

    def read(self, store, partition, identity):
        before_memory_read()
        account_memory_charge({"x-ms-request-charge": "1"})
        with self.lock:
            self.reads.append((store, partition, identity))
            record = deepcopy(self.records.get((store, partition, identity)))
            if record:
                verify_record_integrity(record)
            return record

    def batch(self, store, partition, operations):
        with self.lock:
            if self.fail_next_batch is not None:
                failure, self.fail_next_batch = self.fail_next_batch, None
                raise failure
            pending = deepcopy(self.records)
            result = []
            revision = self.revision
            for operation in operations:
                document = deepcopy(operation.document)
                if document["partitionKey"] != partition:
                    raise MemoryIntegrityError("Cross-partition transaction")
                key = (store, partition, document["id"])
                previous = pending.get(key)
                if operation.kind == "create":
                    if previous is not None:
                        raise MemoryConflictError("Duplicate create")
                elif previous is None or previous["_etag"] != operation.etag:
                    raise MemoryConflictError("Stale replacement")
                revision += 1
                document["_etag"] = f"v{revision}"
                pending[key] = document
                result.append(deepcopy(document))
            self.revision = revision
            self.records = pending
            self.commits.append(deepcopy(list(operations)))
            return result

    def page(self, store, partition, record_type, *, filters=None, limit=100, continuation=None):
        before_memory_read()
        account_memory_charge({"x-ms-request-charge": "2"})
        def field(record, name):
            value = record
            for part in name.split("."):
                value = value.get(part) if isinstance(value, dict) else None
            return value

        with self.lock:
            documents = [
                deepcopy(value) for (kind, pk, _identity), value in self.records.items()
                if kind == store and pk == partition and value.get("record_type") == record_type
                and all(field(value, key) == expected for key, expected in (filters or {}).items())
            ]
        documents.sort(key=lambda item: item["id"])
        for document in documents:
            verify_record_integrity(document)
        start = int(continuation or 0)
        selected = documents[start:start + limit]
        next_offset = start + len(selected)
        return RecordPage(selected, str(next_offset) if next_offset < len(documents) else None)

    def due_receipts(self, now, limit):
        moment = datetime.fromisoformat(now.replace("Z", "+00:00"))
        with self.lock:
            return [
                deepcopy(record) for (store, _pk, _id), record in self.records.items()
                if store == "learner" and record.get("record_type") == "processing_receipt"
                and record["status"] in {"PENDING", "PROCESSING", "RETRY_PENDING"}
                and datetime.fromisoformat(record["next_attempt_at"].replace("Z", "+00:00")) <= moment
                and (not record.get("lease_until") or datetime.fromisoformat(record["lease_until"].replace("Z", "+00:00")) <= moment)
            ][:limit]

    def expired_snapshots(self, now, limit):
        moment = datetime.fromisoformat(now.replace("Z", "+00:00"))
        with self.lock:
            return [
                deepcopy(record) for (store, _pk, _id), record in self.records.items()
                if store == "learner" and record.get("record_type") == "learner_snapshot"
                and record["payload"].get("next_revalidation_at")
                and datetime.fromisoformat(record["payload"]["next_revalidation_at"].replace("Z", "+00:00")) <= moment
            ][:limit]

    def put_artifact(self, partition, identity, content, content_type):
        digest = hashlib.sha256(content).hexdigest()
        path = f"{partition}/{identity}/{digest}"
        with self.lock:
            if path in self.artifacts and self.artifacts[path] != content:
                raise MemoryIntegrityError("Conflicting artifact")
            self.artifacts[path] = content
        return {"path": path, "sha256": digest, "size": len(content), "content_type": content_type}

    def get_artifact(self, partition, reference):
        if not reference["path"].startswith(partition + "/"):
            raise MemoryIntegrityError("Cross-scope artifact")
        data = self.artifacts[reference["path"]]
        if hashlib.sha256(data).hexdigest() != reference["sha256"]:
            raise MemoryIntegrityError("Corrupt artifact")
        return data
