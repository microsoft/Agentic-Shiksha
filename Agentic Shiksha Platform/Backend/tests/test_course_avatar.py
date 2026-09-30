from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from backend import main
from backend.schemas.course_avatar import CourseAvatar
from backend.schemas.course_creation import CourseCreationRequest
from backend.schemas.agent_membership import AgentListItem


@pytest.mark.parametrize("initials,expected", [
    ("tc", "TC"), (" e\u0301m ", "\u00c9M"), ("PHY", "PHY"),
    ("1A", "1A"), ("", None), (None, None),
])
def test_avatar_normalizes_initials(initials, expected):
    assert CourseAvatar(initials=initials).initials == expected


@pytest.mark.parametrize("data", [
    {"initials": "ABCD"}, {"initials": "A B"}, {"initials": "<b>"},
    {"initials": "\u0301"}, {"initials": "A\nB"}, {"initials": 42},
    {"color": "red"}, {"color": "#fff"}, {"color": "#1234567"},
    {"color": "url(example)"}, {"unexpected": "value"},
])
def test_avatar_rejects_invalid_customization(data):
    with pytest.raises(ValidationError):
        CourseAvatar.model_validate(data)


def test_creation_and_list_contracts_keep_avatar_settings():
    request = CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid="a" * 36,
        agentAvatar={"initials": "ex", "color": "#34d399"},
    )
    restored = CourseCreationRequest.model_validate_json(request.model_dump_json())
    assert restored.agentAvatar.model_dump() == {"initials": "EX", "color": "#34d399"}
    row = AgentListItem(id=request.name, name=request.name, agentAvatar=restored.agentAvatar)
    assert row.model_dump()["agentAvatar"] == restored.agentAvatar.model_dump()
    assert CourseCreationRequest(name="course-example", courseName="Example", sessionUuid="a" * 36).agentAvatar is None


def test_durable_creation_saves_avatar_in_setup_and_metadata(monkeypatch):
    from azure_services.persistence import cosmos_db
    from utils import course_creation, metadata_cache

    request = CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid="a" * 36,
        agentAvatar={"initials": "TC", "color": "#22d3ee"},
    )
    job = SimpleNamespace(
        id="example-job", owner_id="example-teacher", session_uuid=request.sessionUuid,
        creation=SimpleNamespace(request=request, specification=SimpleNamespace(description="Example course"), manage_code="ABC123"),
    )
    blob = Mock()
    client = Mock()
    client.get_blob_client.return_value = blob
    create = Mock()
    monkeypatch.setattr(course_creation.material_jobs.course_materials, "load_course", lambda _name: None)
    monkeypatch.setattr(cosmos_db, "_get_blob_service_client", lambda: client)
    monkeypatch.setattr(cosmos_db, "create_agent_metadata", create)
    monkeypatch.setattr(metadata_cache, "invalidate_agent_metadata", Mock())
    monkeypatch.setattr(course_creation, "enqueue_curriculum", Mock())
    course_creation.persist_created_course(job)
    saved = json.loads(blob.upload_blob.call_args.args[0])
    assert saved["agentAvatar"] == {"initials": "TC", "color": "#22d3ee"}
    assert create.call_args.kwargs["metadata"]["agentAvatar"] == saved["agentAvatar"]


@pytest.mark.parametrize("change,expected", [
    ({}, {"initials": "TC", "color": "#22d3ee"}),
    ({"agentAvatar": None}, None),
    ({"agentAvatar": {"initials": "mc", "color": "#fbbf24"}}, {"initials": "MC", "color": "#fbbf24"}),
])
def test_setup_updates_preserve_omitted_avatar_and_allow_explicit_reset(monkeypatch, change, expected):
    old = {"agentAvatar": {"initials": "TC", "color": "#22d3ee"}}
    save = Mock()
    update = Mock(return_value={"id": "course-example"})
    monkeypatch.setattr(main, "_load_setup_json", lambda _name: deepcopy(old))
    monkeypatch.setattr(main, "_save_setup_json", save)
    monkeypatch.setattr(main, "update_agent_metadata", update)
    monkeypatch.setattr(main, "_invalidate_agent_list_caches", Mock())
    details = main.AgentSetupDetails(
        agentId="course-example", agentKind="course", courseName="Example",
        courseLevel="Certificate", courseDuration="1 Year", additionalContext="", **change,
    )
    assert main.save_agent_setup_endpoint(details) == {"ok": True}
    assert save.call_args.args[1]["agentAvatar"] == expected
    if change:
        assert update.call_args.kwargs["metadata"] == {"agentAvatar": expected}
    else:
        update.assert_not_called()


def test_setup_reads_current_picture_metadata_after_image_changes(monkeypatch):
    from azure_services.persistence import cosmos_db

    monkeypatch.setattr(cosmos_db, "load_agent_setup", lambda _name: {
        "agentImageUrl": "/old-image.jpg", "agentAvatar": None, "conversationStarters": [],
    })
    monkeypatch.setattr(cosmos_db, "get_agent_metadata", lambda _name: {
        "agentImageUrl": "", "metadata": {"agentAvatar": {"initials": "EX", "color": "#60a5fa"}},
    })
    result = main._load_setup_json("course-example")
    assert result["agentImageUrl"] == ""
    assert result["agentAvatar"] == {"initials": "EX", "color": "#60a5fa"}


def test_failed_setup_storage_does_not_report_success(monkeypatch):
    from azure_services.persistence import cosmos_db

    monkeypatch.setattr(cosmos_db, "save_agent_setup", lambda *_args: False)
    with pytest.raises(RuntimeError, match="could not be saved"):
        main._save_setup_json("course-example", {})


def test_agent_list_exposes_saved_avatar(monkeypatch):
    avatar = {"initials": "TC", "color": "#34d399"}
    monkeypatch.setattr(main, "list_agents_for_user", lambda **_kwargs: [{
        "id": "course-example", "name": "course-Example", "createdById": "example-teacher",
        "metadata": {"agentAvatar": avatar},
    }])
    monkeypatch.setattr(main, "get_users_batch", lambda _ids: {})
    monkeypatch.setattr(main, "get_invited_users_batch", lambda _emails: {})
    rows = main.azure_agents_list(force_refresh=True, user_id="example-teacher", user_role="teacher")
    assert rows[0]["agentAvatar"] == avatar
