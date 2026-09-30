import asyncio
import threading
from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest
from azure.ai.agents.models import VectorStore, VectorStoreDataSourceAssetType
from azure.ai.agents.operations import VectorStoresOperations
from azure.core.exceptions import HttpResponseError, ServiceRequestError
from fastapi.testclient import TestClient

from azure_services.storage.blob_storage_manager import AsyncFileProcessor
from backend import main


BLOB_URIS = [
    "https://example.blob.core.windows.net/materials/notes.pdf",
    "https://example.blob.core.windows.net/materials/exercises.txt",
]


@pytest.fixture
def vector_store_processor(monkeypatch):
    operations = create_autospec(VectorStoresOperations, instance=True)
    operations.create_and_poll.return_value = VectorStore({
        "id": "vs-course",
        "status": "completed",
    })
    processor = AsyncFileProcessor(
        storage_account_name="cistorageaccount",
        document_intelligence_endpoint="https://example.cognitiveservices.azure.com",
        project_endpoint="https://example.services.ai.azure.com/api/projects/ci",
        credential=Mock(),
        temp_dir=".",
    )
    processor._agents_client = SimpleNamespace(vector_stores=operations)
    monkeypatch.setattr(main, "_async_file_processor", processor)
    yield processor, operations
    processor._executor.shutdown(wait=True)


@pytest.mark.parametrize("name", [None, "course-documents"])
def test_blob_vector_store_route_uses_the_shared_processor(vector_store_processor, name):
    payload = {"blob_uris": BLOB_URIS}
    if name is not None:
        payload["vector_store_name"] = name

    response = TestClient(main.app).post("/api/blob/create-vector-store", json=payload)

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "vector_store_id": "vs-course",
        "error": None,
    }
    operations = vector_store_processor[1]
    operations.create_and_poll.assert_called_once()
    arguments = operations.create_and_poll.call_args.kwargs
    assert arguments["name"] == (name or "agent_vector_store")
    assert arguments["retry_total"] == 0
    assert [source.asset_identifier for source in arguments["data_sources"]] == BLOB_URIS
    assert all(
        source.asset_type == VectorStoreDataSourceAssetType.URI_ASSET
        for source in arguments["data_sources"]
    )


def test_vector_store_polling_does_not_block_the_event_loop(vector_store_processor):
    processor, operations = vector_store_processor
    loop_thread = threading.get_ident()
    polling_threads = []
    vector_store = operations.create_and_poll.return_value

    def poll(**_kwargs):
        polling_threads.append(threading.get_ident())
        return vector_store

    operations.create_and_poll.side_effect = poll

    result = asyncio.run(processor.create_vector_store_from_results(BLOB_URIS, "course-documents"))

    assert result is vector_store
    assert len(polling_threads) == 1
    assert polling_threads[0] != loop_thread


@pytest.mark.parametrize("error_type", [HttpResponseError, ServiceRequestError, TimeoutError])
def test_blob_vector_store_service_failure_is_redacted(vector_store_processor, error_type):
    vector_store_processor[1].create_and_poll.side_effect = error_type("private service details")

    response = TestClient(main.app).post(
        "/api/blob/create-vector-store", json={"blob_uris": BLOB_URIS}
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": False,
        "vector_store_id": None,
        "error": "Vector store creation failed",
    }
    vector_store_processor[1].create_and_poll.assert_called_once()


def test_blob_vector_store_does_not_hide_programming_errors(vector_store_processor):
    vector_store_processor[1].create_and_poll.side_effect = RuntimeError("Unexpected bug")

    with pytest.raises(RuntimeError, match="Unexpected bug"):
        asyncio.run(main.create_vector_store_from_blobs(
            main.VectorStoreFromBlobsRequest(blob_uris=BLOB_URIS)
        ))
