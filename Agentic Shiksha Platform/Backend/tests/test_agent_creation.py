import asyncio
import json
from unittest.mock import AsyncMock, Mock

import pytest

from backend import main
from base_agents import agent_manager


@pytest.fixture
def manager_clients(monkeypatch):
    monkeypatch.setattr(agent_manager, "AgentChat", Mock())
    monkeypatch.setattr(agent_manager, "AgentInfoTool", Mock())


@pytest.mark.parametrize("config_path", [None, "custom-agents.json"])
def test_learning_agent_factory_uses_shared_manager(
    monkeypatch, manager_clients, config_path
):
    if config_path is None:
        monkeypatch.delenv("AZURE_AGENTS_CONFIG_PATH", raising=False)
    else:
        monkeypatch.setenv("AZURE_AGENTS_CONFIG_PATH", config_path)
    monkeypatch.setattr(main, "_application_settings", main.ApplicationSettings())

    manager = main.learning_agent_manager()

    assert type(manager) is agent_manager.BaseAgentManager
    assert manager.project_endpoint == main.PROJECT_ENDPOINT
    assert manager.config_path == (config_path or "configs/azure_agents.json")
    assert manager.credential_factory is main.get_async_credential


@pytest.fixture
def legacy_creation(monkeypatch, tmp_path, manager_clients):
    monkeypatch.setenv("AZURE_AGENTS_CONFIG_PATH", str(tmp_path / "agents.json"))
    monkeypatch.setattr(main, "_application_settings", main.ApplicationSettings())
    monkeypatch.setattr(main, "ALLOWED_DEPLOYMENTS", {"test-model"})
    monkeypatch.setattr(
        main,
        "call_meta_agent_for_prompt",
        AsyncMock(return_value=("Course description", "Course prompt", ["Start here"])),
    )
    monkeypatch.setattr(
        main, "unify_agent_prompts", Mock(return_value="Unified course instructions")
    )
    monkeypatch.setattr(
        main, "create_memory_store_for_agent", Mock(return_value={"name": "course-memory"})
    )
    manager = main.learning_agent_manager()
    monkeypatch.setattr(main, "learning_agent_manager", Mock(return_value=manager))
    monkeypatch.setattr(manager, "_find_agent_remote_by_name", AsyncMock(return_value=None))
    creator = AsyncMock(return_value="course-agent-id")
    monkeypatch.setattr(agent_manager, "agent_creator", creator)
    request = {
        "agent_kind": "learning",
        "name": "course-example",
        "user_description": "",
        "course_name": "Example course",
        "course_level": "Undergraduate",
        "course_duration": "One semester",
        "additional_context": "",
        "model": "test-model",
        "created_by_id": "teacher-1",
    }
    return manager, creator, request


@pytest.mark.parametrize(
    "search_options",
    [
        {},
        {
            "custom_search_instance_name": "course-search",
            "course_urls": ["https://example.com/course"],
            "search_index_name": "course-index",
            "search_index_filter": "session_id eq 'course-session'",
            "search_connection_id": "course-search-connection",
        },
    ],
)
def test_legacy_creation_preserves_options_without_saving_config(
    legacy_creation, search_options
):
    manager, creator, request = legacy_creation
    request.update(search_options)

    result = asyncio.run(main._path2_create_agent(**request))

    creator.assert_awaited_once_with(
        project_endpoint=main.PROJECT_ENDPOINT,
        agent_name="course-example",
        instructions="Unified course instructions",
        model_deployment="test-model",
        config_path=manager.config_path,
        save_to_config=False,
        include_web_search=False,
        include_custom_search=False,
        custom_search_instance_name=search_options.get("custom_search_instance_name"),
        course_urls=search_options.get("course_urls"),
        search_index_name=search_options.get("search_index_name"),
        search_index_filter=search_options.get("search_index_filter"),
        search_connection_id=search_options.get("search_connection_id"),
        memory_store_name="course-memory",
        memory_scope="{{$userId}}",
        memory_update_delay=300,
        credential_factory=main.get_async_credential,
    )
    assert result == {
        "agent_id": "course-agent-id",
        "name": "course-example",
        "description": "Course description",
        "conversation_starters": ["Start here"],
        "instructions_preview": "Unified course instructions",
        "memory_store_name": "course-memory",
    }
    assert not manager._config_file.exists()


@pytest.mark.parametrize("source", ["local", "remote"])
def test_legacy_creation_keeps_duplicate_name_protection(legacy_creation, source):
    manager, creator, request = legacy_creation
    if source == "local":
        manager._config_file.write_text(
            json.dumps({"course-example": {"agent_id": "existing-agent"}}),
            encoding="utf-8",
        )
    else:
        manager._find_agent_remote_by_name.return_value = {
            "id": "existing-agent",
            "name": "course-example",
        }

    with pytest.raises(ValueError, match="already exists"):
        asyncio.run(main._path2_create_agent(**request))

    creator.assert_not_awaited()


def test_legacy_creation_propagates_creation_failure(legacy_creation):
    _manager, creator, request = legacy_creation
    creator.side_effect = RuntimeError("Creation failed")

    with pytest.raises(RuntimeError, match="Creation failed"):
        asyncio.run(main._path2_create_agent(**request))

    creator.assert_awaited_once()
