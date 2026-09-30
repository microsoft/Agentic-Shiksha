import json
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import agent_tools.custom as tools
from agent_tools.a2ui.catalog import BLOCK_COMPONENT_TYPES, build_catalog_definition
from agent_tools.custom.declare_plan import DeclarePlanTool
from azure_services.agents.agent_creation import AgentToolBuilder
from backend import main
from harness.runtime import GeneralAgent, TOOL_ERROR_PREFIX, _tool_start_events
from utils.prompt_unifier import get_tool_handling_prompt
from utils.tool_definitions import iter_definition_names


def test_flashcard_is_absent_from_tool_factory_catalog_and_current_instructions():
    assert not hasattr(tools, "AddFlashcardTool")
    assert "add_flashcard" not in iter_definition_names()
    builder = AgentToolBuilder(agent_name="course-example")
    builder._add_function_tools()
    assert all(tool.name != "add_flashcard" for tool in builder._tools)
    assert "flashcard" not in BLOCK_COMPONENT_TYPES
    assert all(component["type"] != "Flashcard" for component in build_catalog_definition()["components"])
    assert "add_flashcard" not in get_tool_handling_prompt()
    assert DeclarePlanTool().execute({"tools": ["add_flashcard"]})["status"] == "error"


def test_stale_flashcard_calls_fail_explicitly_without_artifacts_or_success():
    agent = GeneralAgent.__new__(GeneralAgent)
    agent.agent_name = "course-example"
    result = agent._dispatch_tool_call(
        "add_flashcard", json.dumps({"title": "Example", "cards": []}), "call-example", "conversation-example", "user-example"
    )
    assert result["output"].startswith(TOOL_ERROR_PREFIX)
    assert "no longer supported" in result["output"]
    assert "successfully" not in result["output"]
    assert [kind for kind, _data, _conversation in result["yield_events"]] == ["error"]
    assert list(_tool_start_events("add_flashcard", "conversation-example")) == []


def test_legacy_raw_flashcard_json_is_not_rendered_as_prose_or_an_artifact():
    agent = GeneralAgent.__new__(GeneralAgent)
    agent.agent_name = "course-example"
    events = list(agent._handle_plain_text_fallback(
        "conversation-example",
        json.dumps({"name": "add_flashcard", "arguments": {"title": "Example", "cards": []}}),
    ))
    assert [kind for kind, _data, _conversation in events] == ["error"]
    assert "no longer supported" in events[0][1]


@pytest.mark.parametrize("field", ["category", "type"])
@pytest.mark.parametrize("kind", ["flashcard", "flashcards", " FlashCard "])
def test_retired_asset_creates_and_kind_updates_are_rejected_before_storage(monkeypatch, field, kind):
    from azure_services.persistence import cosmos_db

    create = Mock(return_value={"id": "unexpected-asset"})
    update = Mock(return_value={"id": "unexpected-asset"})
    monkeypatch.setattr(cosmos_db, "create_asset", create)
    monkeypatch.setattr(cosmos_db, "update_asset", update)
    client = TestClient(main.app)
    response = client.post("/api/assets", params={"user_id": "example-user"}, json={
        "title": "Example", "category": "other", "type": "json", "content": "{}", field: kind,
    })
    assert response.status_code == 422
    response = client.put(
        "/api/assets/example-asset", params={"user_id": "example-user"}, json={field: kind},
    )
    assert response.status_code == 422
    create.assert_not_called()
    update.assert_not_called()


@pytest.mark.parametrize("payload", [
    {"type": "flashcard", "cards": []},
    {"type": " FlashCards ", "cards": []},
    {"flashcardId": "legacy-cards", "cards": []},
    {"cards": [{"front": "Question", "back": "Answer"}]},
])
def test_retired_payloads_cannot_be_created_or_updated_under_another_category(monkeypatch, payload):
    from azure_services.persistence import cosmos_db

    create = Mock(return_value={"id": "unexpected-asset"})
    update = Mock(return_value={"id": "unexpected-asset"})
    monkeypatch.setattr(cosmos_db, "create_asset", create)
    monkeypatch.setattr(cosmos_db, "update_asset", update)
    client = TestClient(main.app)
    content = json.dumps(payload)
    response = client.post("/api/assets", params={"user_id": "example-user"}, json={
        "title": "Example", "category": "other", "type": "json", "content": content,
    })
    assert response.status_code == 422
    response = client.put(
        "/api/assets/example-asset", params={"user_id": "example-user"}, json={"content": content},
    )
    assert response.status_code == 422
    create.assert_not_called()
    update.assert_not_called()
    with pytest.raises(ValidationError, match="Flashcards have been removed"):
        main.AssetUpdateRequest(content=content)


@pytest.mark.parametrize("content", [
    "Example notes mentioning flashcards",
    "{broken",
    json.dumps({"type": "slides", "deck": {}, "cards": []}),
    json.dumps({"type": "other", "cards": [{"front": "Question", "back": "Answer"}]}),
    json.dumps({"quizId": "quiz", "questions": [], "cards": []}),
    json.dumps({"challengeId": "challenge", "solution": "42", "cards": []}),
])
def test_other_assets_and_partial_updates_remain_valid(content):
    asset = main.AssetCreateRequest(title="Example notes", category="document", type="markdown", content=content)
    assert asset.category == "document"
    assert asset.content == content
    assert main.AssetUpdateRequest(content=content).content == content
    assert main.AssetUpdateRequest(title="Updated").category is None
