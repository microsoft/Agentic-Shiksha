from unittest.mock import Mock

import pytest
from azure.cosmos.exceptions import CosmosHttpResponseError

from azure_services.persistence.learner_memory import (
    CosmosMemoryRepository,
    MemoryCapacityError,
    MemoryConflictError,
    MemoryIntegrityError,
    WriteOperation,
    content_hash,
)
from graph_memory_fakes import FakeMemoryRepository


def test_batch_requires_full_scope_and_conditional_replacements():
    repository = CosmosMemoryRepository(Mock(), Mock(), Mock())
    with pytest.raises(MemoryIntegrityError, match="Cross-partition"):
        repository.batch("learner", "scope-a", [WriteOperation("create", {"id": "event", "partitionKey": "scope-b"})])
    with pytest.raises(MemoryIntegrityError, match="ETag"):
        repository.batch("learner", "scope-a", [WriteOperation("replace", {"id": "state", "partitionKey": "scope-a"})])
    with pytest.raises(MemoryCapacityError):
        repository.batch("learner", "scope-a", [])


def test_cosmos_batch_uses_sdk_if_match_and_same_partition():
    container = Mock()
    container.execute_item_batch.return_value = [{"statusCode": 200, "resourceBody": {"id": "state"}, "eTag": "new"}]
    repository = CosmosMemoryRepository(Mock(), container, Mock())
    body = {"id": "state", "partitionKey": "learner-a", "_etag": "old"}
    result = repository.batch("learner", "learner-a", [WriteOperation("replace", body, "old")])
    container.execute_item_batch.assert_called_once_with(
        batch_operations=[("replace", ("state", {"id": "state", "partitionKey": "learner-a"}), {"if_match_etag": "old"})],
        partition_key="learner-a",
    )
    assert result[0]["_etag"] == "new"


def test_conflicts_are_exposed_not_success_shaped():
    container = Mock()
    container.execute_item_batch.side_effect = CosmosHttpResponseError(status_code=412, message="precondition")
    repository = CosmosMemoryRepository(Mock(), container, Mock())
    with pytest.raises(MemoryConflictError):
        repository.batch("learner", "scope", [WriteOperation("create", {"id": "event", "partitionKey": "scope"})])


def test_record_reads_fail_on_scope_mismatch():
    container = Mock()
    container.read_item.return_value = {"id": "evidence", "partitionKey": "another-student"}
    repository = CosmosMemoryRepository(Mock(), container, Mock())
    with pytest.raises(MemoryIntegrityError):
        repository.read("learner", "this-student", "evidence")


def test_container_configuration_is_checked_before_ledger_use():
    graph, learner, blobs = Mock(), Mock(), Mock()
    graph.read.return_value = {"partitionKey": {"paths": ["/id"]}}
    repository = CosmosMemoryRepository(graph, learner, blobs)
    with pytest.raises(MemoryIntegrityError, match="/partitionKey"):
        repository.validate()
    graph.read.return_value = learner.read.return_value = {"partitionKey": {"paths": ["/partitionKey"]}, "defaultTtl": -1}
    blobs.get_container_properties.return_value = {"public_access": "blob"}
    with pytest.raises(MemoryIntegrityError, match="private"):
        repository.validate()


def test_query_identifiers_and_limits_are_validated():
    repository = CosmosMemoryRepository(Mock(), Mock(), Mock())
    with pytest.raises(ValueError):
        repository.page("learner", "scope", "event", filters={"id OR 1=1": "bad"})
    with pytest.raises(ValueError):
        repository.page("learner", "", "event")
    with pytest.raises(ValueError):
        repository.page("learner", "scope", "event", limit=0)


def test_transaction_fake_rejects_lost_updates_and_rolls_back_history():
    repository = FakeMemoryRepository()
    body = {"id": "state", "partitionKey": "scope", "version": 7}
    original = repository.batch("learner", "scope", [WriteOperation("create", body)])[0]
    repository.batch("learner", "scope", [WriteOperation("replace", {**body, "version": 8}, original["_etag"])])
    with pytest.raises(MemoryConflictError):
        repository.batch("learner", "scope", [
            WriteOperation("create", {"id": "bad-history", "partitionKey": "scope"}),
            WriteOperation("replace", {**body, "version": 9}, original["_etag"]),
        ])
    assert repository.read("learner", "scope", "bad-history") is None
    assert repository.read("learner", "scope", "state")["version"] == 8


def test_artifacts_cannot_cross_scope():
    repository = CosmosMemoryRepository(Mock(), Mock(), Mock())
    with pytest.raises(MemoryIntegrityError):
        repository.get_artifact("student-a", {"path": "student-b/event/hash"})


def test_immutable_payload_corruption_is_not_treated_as_valid_evidence():
    container = Mock()
    body = {"id": "evidence", "partitionKey": "learner", "payload": {"answer": "original"}}
    container.read_item.return_value = {
        **body, "integrity_hash": content_hash(body), "payload": {"answer": "rewritten"},
    }
    with pytest.raises(MemoryIntegrityError, match="integrity"):
        CosmosMemoryRepository(Mock(), container, Mock()).read("learner", "learner", "evidence")
