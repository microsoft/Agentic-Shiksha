import asyncio
import ast
import hashlib
from pathlib import Path
from unittest.mock import MagicMock, Mock

import pytest

from admin_backend.core.contracts import DashboardRepository, EvaluationBackend
from admin_backend.core.errors import InvalidOperation, ResourceNotFound
from admin_backend.core.settings import RuntimeSettings
from admin_backend.schemas.directory import UpdateUserRequest
from admin_backend.services.evaluation import EvaluationService, summarize


@pytest.mark.parametrize("invited", [True, False])
def test_directory_edits_preserve_active_affiliation_and_store_selection(admin_services, invited):
    queries = admin_services.queries
    record = {
        "id": "user-test", "userId": "user-test", "email": "user@example.com",
        "affiliations": [{"institute": "Old", "department": "Old", "role": "student"}],
        "activeAffiliation": 0,
    }
    if invited:
        queries.get_invite_by_id.return_value = record
    else:
        queries.get_user_profile.return_value = record
        queries.upsert_user_profile.side_effect = lambda _user_id, **values: {**record, **values}
    updated = admin_services.directory.update_user("user-test", UpdateUserRequest(
        name="Example", role="teacher", institute="New", department="Physics",
    ))
    assert updated["name"] == "Example"
    assert updated["role"] == "teacher"
    assert updated["institute"] == "New"
    document = queries.save_directory_record.call_args.args[0]
    assert queries.save_directory_record.call_args.kwargs == {"invited": invited}
    assert document["affiliations"] == [{"institute": "New", "department": "Physics", "role": "teacher"}]
    if invited:
        assert document["updatedAt"].endswith("Z")
        queries.upsert_user_profile.assert_not_called()
    else:
        queries.upsert_user_profile.assert_called_once_with(
            "user-test", fullName="Example", displayName="Example", role="teacher",
            institute="New", department="Physics",
        )


def test_directory_removal_and_course_membership_keep_existing_validation(admin_services):
    queries = admin_services.queries
    with pytest.raises(ResourceNotFound, match="User not found"):
        admin_services.directory.remove_user("missing")
    queries.remove_directory_user.assert_not_called()
    queries.get_invite_by_id.side_effect = lambda identifier: {"name": "Invited teacher"} if identifier == "teacher" else None
    queries.transfer_agent_ownership.return_value = {"id": "course"}
    assert admin_services.agents.transfer_ownership("course", {"new_owner_id": " teacher "}) == {
        "status": "ok", "agent_id": "course", "new_owner_id": "teacher", "new_owner_name": "Invited teacher",
    }
    queries.set_agent_teachers.return_value = {"teacherIds": ["teacher"]}
    assert admin_services.agents.set_agent_teachers("course", {
        "teacher_ids": [" teacher ", "", None, 0, False],
    })["teacher_ids"] == ["teacher"]
    queries.set_agent_teachers.assert_called_once_with("course", ["teacher"])
    with pytest.raises(InvalidOperation, match="teacher_ids must be a list"):
        admin_services.agents.set_agent_teachers("course", {"teacher_ids": "teacher"})


def test_batch_evaluation_preserves_partial_failures_and_averaging(admin_services):
    evaluate = admin_services.evaluation.backend().evaluate_groundedness
    evaluate.side_effect = [
        {"groundedness_score": 4.1}, RuntimeError("upstream-private-text"),
        {"groundedness_score": 2.2}, {"groundedness_score": None},
    ]
    result = asyncio.run(admin_services.evaluation.batch({"items": [{}, {}, {}, {}], "method": "llm"}))
    assert result["summary"] == {"total": 4, "evaluated": 2, "average_groundedness": 3.15}
    assert result["results"][1] == {"index": 1, "ok": False, "error": "Evaluation failed"}
    assert "upstream-private-text" not in str(result)
    assert all(call.kwargs["method"] == "llm" for call in evaluate.call_args_list)
    with pytest.raises(InvalidOperation, match="items list is required"):
        asyncio.run(admin_services.evaluation.batch({}))


def test_evaluation_summary_retains_nulls_rounding_and_bucket_boundaries():
    assert summarize([]) == {
        "total": 0, "avgFaithfulness": None, "avgAnswerRelevancy": None,
        "avgContextPrecision": None, "avgOverall": None, "maxScore": 5,
    }
    result = summarize([
        {"overallScore": value, "groundednessScore": 3} for value in (1, 1.99, 2, 2.99, 3, 3.99, 4, 5)
    ] + [{"overallScore": None}], distribution=True)
    assert result["total"] == 9
    assert result["avgFaithfulness"] == 3
    assert result["distribution"] == {"1-2": 2, "2-3": 2, "3-4": 2, "4-5": 2}


def test_evaluation_cycle_deduplicates_bounds_batches_and_keeps_caches_local(admin_services):
    queries = admin_services.queries
    messages = [
        {"messageGroupId": group, "threadId": "thread-test", "userId": "learner"}
        for group in ("already-done", "first", "first", "second", "third")
    ]
    queries.get_recent_assistant_messages.return_value = messages + [{}]
    queries.get_evaluated_message_group_ids.return_value = {"already-done"}
    queries.get_thread.return_value = {"agentId": "course-test"}
    queries.get_agent_session_uuid.return_value = "session-test"
    runtime = RuntimeSettings(eval_batch_limit=2, eval_lookback_hours=12)
    asyncio.run(admin_services.evaluation.evaluate_recent(runtime))
    evaluate = admin_services.evaluation.backend().evaluate_and_store_groundedness
    assert [call.kwargs["message_group_id"] for call in evaluate.call_args_list] == ["first", "second"]
    assert all(call.kwargs["session_id"] == "session-test" and call.kwargs["method"] == "llm"
               for call in evaluate.call_args_list)
    queries.get_recent_assistant_messages.assert_called_once_with(limit=4, since_hours=12)
    queries.get_thread.assert_called_once_with("thread-test", "learner")
    queries.get_agent_session_uuid.assert_called_once_with("course-test")
    other_queries = Mock(spec=DashboardRepository)
    other_backend = Mock(spec=EvaluationBackend)
    other_service = EvaluationService(other_queries, lambda: other_backend)
    assert other_service._threads == {}
    assert other_service._agent_sessions == {}


def test_missing_optional_session_and_failed_item_do_not_stop_evaluation_batch(admin_services):
    queries = admin_services.queries
    queries.get_recent_assistant_messages.return_value = [
        {"messageGroupId": "first", "threadId": "missing", "userId": "learner"},
        {"messageGroupId": "second"},
    ]
    queries.get_evaluated_message_group_ids.return_value = set()
    queries.get_thread.return_value = None
    evaluate = admin_services.evaluation.backend().evaluate_and_store_groundedness
    evaluate.side_effect = [RuntimeError("offline failure"), None]
    asyncio.run(admin_services.evaluation.evaluate_recent(RuntimeSettings()))
    assert evaluate.call_count == 2
    assert all(call.kwargs["session_id"] is None for call in evaluate.call_args_list)
    queries.get_agent_session_uuid.assert_not_called()


@pytest.mark.parametrize("department", [False, True])
@pytest.mark.parametrize("result", ['{"profile":{"name":"Example"}}', "not JSON", RuntimeError("offline failure")])
def test_research_job_state_transitions_are_fakeable_and_fail_closed(admin_services, department, result):
    responder = admin_services.research.respond
    if isinstance(result, Exception):
        responder.side_effect = result
    else:
        responder.return_value = result
    store = admin_services.research.storage
    if department:
        admin_services.research.run_department("Example Institute", "Physics", "  Use official sources.  ")
        writes = store.save_department_research.call_args_list
    else:
        admin_services.research.run_institute("Example Institute", "  Use official sources.  ")
        writes = store.save_institute_research.call_args_list
    assert [call.args[-1]["status"] for call in writes] == [
        "researching", "completed" if isinstance(result, str) and result.startswith("{") else "failed",
    ]
    assert writes[-1].args[-1]["institute_name"] == "Example Institute"
    if department:
        assert writes[-1].args[-1]["department_name"] == "Physics"
    assert responder.call_args.args[0].endswith(
        "\n\n**Additional Instructions from Admin:**\nUse official sources."
    )
    if isinstance(result, Exception):
        assert writes[-1].args[-1]["error"] == "Research failed"


def test_research_prompt_expressions_are_unchanged_from_baseline():
    source = Path(__file__).resolve().parents[1] / "admin_backend" / "services" / "research.py"
    module = ast.parse(source.read_text(encoding="utf-8"))
    service = next(node for node in module.body if isinstance(node, ast.ClassDef))
    expected = {
        "run_institute": "03ab71ef08a9f1fb23b8676f2e537957f5304cf16a96b2e0f8d98a721fee8799",
        "run_department": "ffaf72cf7a06eb384dd7dc8df562c8d5964859564164ed3354c014edd59c80e7",
    }
    for method in service.body:
        if not isinstance(method, ast.FunctionDef) or method.name not in expected:
            continue
        prompt = next(
            node for node in ast.walk(method) if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "research_prompt" for target in node.targets)
        )
        assert hashlib.sha256(ast.dump(prompt, include_attributes=False).encode()).hexdigest() == expected.pop(method.name)
    assert not expected


def test_research_bulk_status_and_cancel_marker_keep_existing_shapes(admin_services):
    research = admin_services.research
    research.storage.get_department_research.return_value = {"status": "completed"}
    assert research.bulk_status({"items": [
        {"institute": " Example "}, {"type": "department", "institute": " Example ", "department": " Physics "},
        {"institute": ""}, {"type": "department", "institute": "Other", "department": ""},
    ]}) == {"statuses": {
        "Example": {"status": "not_started"}, "Example::Physics": {"status": "completed"},
        "Other": {"status": "not_started"},
    }}
    assert research.cancel_institute(" Example ") == {"status": "not_started", "institute": " Example "}
    research.storage.get_institute_research.return_value = {"status": "researching"}
    assert research.cancel_institute(" Example ") == {"status": "cancelled", "institute": " Example "}
    name, record = research.storage.save_institute_research.call_args.args
    assert name == record["institute_name"] == "Example"
    assert record["cancelled_at"].endswith("Z")
    research.respond.assert_not_called()


def test_research_adapter_uses_its_own_endpoint_agent_reference_and_credentials(monkeypatch):
    from admin_backend.integrations.research_agent import research_response

    credentials = MagicMock()
    project = MagicMock()
    project.__enter__.return_value = project
    client = project.get_openai_client.return_value
    client.conversations.create.return_value.id = "conversation-test"
    client.responses.create.return_value.output_text = '{"status":"offline"}'
    credential_factory = Mock(return_value=credentials)
    project_factory = Mock(return_value=project)
    monkeypatch.setattr("azure.identity.DefaultAzureCredential", credential_factory)
    monkeypatch.setattr("azure.ai.projects.AIProjectClient", project_factory)
    assert research_response("unchanged prompt") == '{"status":"offline"}'
    credential_factory.assert_called_once_with(process_timeout=60)
    project_factory.assert_called_once_with(
        endpoint="https://research.example.invalid/api/projects/test",
        credential=credentials.__enter__.return_value,
    )
    client.responses.create.assert_called_once_with(
        conversation="conversation-test", input="unchanged prompt",
        extra_body={"agent_reference": {"name": "test-research-agent", "type": "agent_reference"}},
    )
    project.__exit__.assert_called_once()
    credentials.__exit__.assert_called_once()
