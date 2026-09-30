import builtins
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import AzureAISearchTool, MemorySearchPreviewTool
from azure.ai.projects.operations import BetaMemoryStoresOperations
from azure.core.exceptions import ResourceNotFoundError

from agent_tools.hosted.azure_ai_search.builder import build_azure_ai_search_tool
from azure_services.agents import agent_creation
from azure_services.tools.memory import memory_store_manager
from utils import course_creation


def test_search_connection_reference_has_no_import_time_sdk_or_environment_dependency(
    monkeypatch,
):
    import_module = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name.startswith("azure.ai.ml"):
            pytest.fail("Optional management SDK must be loaded only when setup is requested")
        return import_module(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    monkeypatch.delenv("AZURE_SEARCH_CONNECTION_NAME", raising=False)
    monkeypatch.delenv("AZURE_SEARCH_ENDPOINT", raising=False)
    path = (
        Path(__file__).resolve().parents[1]
        / "azure_services" / "tools" / "search" / "azure_ai_search.py"
    )
    spec = importlib.util.spec_from_file_location("search_connection_reference", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert callable(module.create_search_connection)


def test_search_connection_setup_uses_only_the_supplied_management_client(monkeypatch):
    entities = ModuleType("azure.ai.ml.entities")
    connection_factory = Mock()
    entities.AzureAISearchConnection = connection_factory
    monkeypatch.setitem(sys.modules, "azure.ai.ml.entities", entities)
    from azure_services.tools.search.azure_ai_search import create_search_connection

    client = Mock()
    result = create_search_connection(
        client, name="course-search", endpoint="https://example.search.windows.net"
    )

    connection_factory.assert_called_once_with(
        name="course-search", endpoint="https://example.search.windows.net", api_key=None
    )
    client.connections.create_or_update.assert_called_once_with(connection_factory.return_value)
    assert result is client.connections.create_or_update.return_value


def test_search_tool_keeps_course_filter_and_query_settings():
    tool = build_azure_ai_search_tool(
        "course-index", "search-connection", filter="session_id eq 'course-a'", top_k=7,
    )

    assert isinstance(tool, AzureAISearchTool)
    assert tool.type == "azure_ai_search"
    assert len(tool.azure_ai_search.indexes) == 1
    index = tool.azure_ai_search.indexes[0]
    assert index.index_name == "course-index"
    assert index.project_connection_id == "search-connection"
    assert index.query_type == "vector_semantic_hybrid"
    assert index.filter == "session_id eq 'course-a'"
    assert index.top_k == 7


@pytest.fixture
def hosted_memory(monkeypatch):
    credential = Mock()
    operations = Mock(spec_set=BetaMemoryStoresOperations)
    project = SimpleNamespace(beta=SimpleNamespace(memory_stores=operations))
    factory = Mock(spec=AIProjectClient, return_value=project)
    monkeypatch.setattr(memory_store_manager, "_get_credential", lambda: credential)
    monkeypatch.setattr(memory_store_manager, "AIProjectClient", factory)
    manager = memory_store_manager.MemoryStoreManager(
        "https://example.services.ai.azure.com/api/projects/test",
    )
    factory.assert_called_once_with(
        endpoint=manager.project_endpoint, credential=credential, allow_preview=True,
    )
    return manager, operations


def test_memory_tool_keeps_store_scope_and_update_delay(hosted_memory):
    manager, _operations = hosted_memory
    tool = manager.get_memory_search_tool(
        "course-a-memory", scope="student-a", update_delay=90,
    )

    assert isinstance(tool, MemorySearchPreviewTool)
    assert tool.memory_store_name == "course-a-memory"
    assert tool.scope == "student-a"
    assert tool.update_delay == 90


def test_memory_store_crud_uses_beta_operations(hosted_memory):
    manager, operations = hosted_memory
    store = SimpleNamespace(
        name="course-a-memory", id="memory-a", description="Course memory",
        created_at="2026-01-01T00:00:00Z", definition={},
    )
    operations.list.return_value = []
    operations.create.return_value = store

    created = manager.create_memory_store_for_agent("course-a")
    assert created["name"] == store.name
    arguments = operations.create.call_args.kwargs
    assert arguments["name"] == store.name
    assert arguments["definition"].chat_model == manager.chat_model
    assert arguments["definition"].embedding_model == manager.embedding_model
    assert arguments["definition"].options.user_profile_enabled is True
    assert arguments["definition"].options.chat_summary_enabled is True

    operations.list.return_value = [store]
    assert manager.get_memory_store(store.name)["id"] == store.id
    assert manager.list_memory_stores()[0]["name"] == store.name
    assert manager.delete_memory_store(store.name) is True
    operations.delete.assert_called_once_with(store.name)


def test_memory_search_preserves_user_message_and_scope(hosted_memory):
    manager, operations = hosted_memory
    memory = SimpleNamespace(memory_id="memory-a", content="Prefers worked examples")
    operations.search_memories.return_value = SimpleNamespace(
        memories=[SimpleNamespace(memory_item=memory)],
    )

    expected = [{"memory_id": memory.memory_id, "content": memory.content}]
    assert manager.search_memories(
        "course-a-memory", "student-a", "Learning preferences", max_memories=4,
    ) == expected
    arguments = operations.search_memories.call_args.kwargs
    assert arguments["name"] == "course-a-memory"
    assert arguments["scope"] == "student-a"
    assert arguments["items"] == [{"role": "user", "content": "Learning preferences"}]
    assert arguments["options"].max_memories == 4

    assert manager.get_static_memories("course-a-memory", "student-a") == expected
    operations.search_memories.assert_called_with(
        name="course-a-memory", scope="student-a",
    )


def test_memory_update_and_scope_deletion_keep_user_isolation(hosted_memory):
    manager, operations = hosted_memory
    memory = SimpleNamespace(memory_id="memory-a", content="Prefers diagrams")
    operations.begin_update_memories.return_value = SimpleNamespace(
        update_id="update-a",
        result=lambda: SimpleNamespace(
            memory_operations=[SimpleNamespace(kind="create", memory_item=memory)],
        ),
    )

    result = manager.add_memories(
        "course-a-memory", "student-a", ["First message", "Second message"],
        update_delay=30, previous_update_id="previous-a",
    )
    operations.begin_update_memories.assert_called_once_with(
        name="course-a-memory", scope="student-a", update_delay=30,
        previous_update_id="previous-a",
        items=[
            {"role": "user", "content": "First message"},
            {"role": "user", "content": "Second message"},
        ],
    )
    assert result == {
        "update_id": "update-a",
        "operations": [{"kind": "create", "memory_id": "memory-a", "content": "Prefers diagrams"}],
    }
    assert manager.delete_user_memories("course-a-memory", "student-a") is True
    operations.delete_scope.assert_called_once_with(
        name="course-a-memory", scope="student-a",
    )


@pytest.mark.parametrize("exists", [True, False])
def test_course_memory_provisioning_preserves_ownership(monkeypatch, exists):
    from learner_memory import settings

    monkeypatch.setattr(settings, "get_memory_settings", lambda: SimpleNamespace(enabled=False))
    job = SimpleNamespace(
        id="job-a", creation=SimpleNamespace(request=SimpleNamespace(name="course-a")),
    )
    memory = SimpleNamespace(name="course-a-memory", metadata={"course_job_id": job.id})
    operations = Mock(spec_set=BetaMemoryStoresOperations)
    operations.get.return_value = memory
    if not exists:
        operations.get.side_effect = ResourceNotFoundError()
    operations.create.return_value = memory
    project = SimpleNamespace(beta=SimpleNamespace(memory_stores=operations))
    monkeypatch.setattr(course_creation, "get_creation_client", lambda: project)

    assert course_creation.prepare_memory(job) == memory.name
    operations.get.assert_called_once_with(name=memory.name)
    if exists:
        operations.create.assert_not_called()
    else:
        assert operations.create.call_args.kwargs["metadata"] == {"course_job_id": job.id}
        assert operations.create.call_args.kwargs["retry_total"] == 0

    memory.metadata = {"course_job_id": "another-job"}
    with pytest.raises(ValueError, match="ownership"):
        course_creation.prepare_memory(job)


def test_course_client_opts_into_existing_preview_features(monkeypatch):
    import common_azure_auth

    credential = Mock()
    factory = Mock(spec=AIProjectClient)
    monkeypatch.setattr(common_azure_auth, "get_sync_credential", lambda: credential)
    monkeypatch.setattr(course_creation, "AIProjectClient", factory)
    course_creation.get_creation_client.cache_clear()
    try:
        assert course_creation.get_creation_client() is factory.return_value
        assert factory.call_args.kwargs["credential"] is credential
        assert factory.call_args.kwargs["allow_preview"] is True
        assert factory.call_args.kwargs["retry_total"] == 0
    finally:
        course_creation.close_creation_client()


def test_legacy_agent_creator_opts_into_existing_preview_tools(monkeypatch):
    credential = Mock()
    factory = Mock(spec=AIProjectClient)
    monkeypatch.setattr(agent_creation, "get_credential", lambda: credential)
    monkeypatch.setattr(agent_creation, "AIProjectClient", factory)
    creator = agent_creation.AgentCreator(
        "https://example.services.ai.azure.com/api/projects/test", "test-model",
    )

    factory.assert_called_once_with(
        endpoint=creator.project_endpoint, credential=credential, allow_preview=True,
    )
