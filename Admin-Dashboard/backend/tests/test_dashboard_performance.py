from unittest.mock import Mock
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from admin_backend.integrations import cosmos_queries as queries
from admin_backend.core import dashboard_cache


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setattr(queries, "_init", lambda: None)
    dashboard_cache.invalidate_views()
    yield
    dashboard_cache.invalidate_views()


def test_course_creators_are_resolved_in_one_batch(monkeypatch):
    agents = Mock()
    agents.query_items.return_value = [
        {"id": f"course-{number}", "createdById": f"teacher-{number % 12}"} for number in range(24)
    ]
    users = Mock()
    users.query_items.return_value = [{"id": f"teacher-{number}", "displayName": f"Teacher {number}"} for number in range(12)]
    invitations = Mock()
    monkeypatch.setattr(queries, "_agents", lambda: agents)
    monkeypatch.setattr(queries, "_users", lambda: users)
    monkeypatch.setattr(queries, "_invited", lambda: invitations)
    result = queries.list_agents()
    assert len(result) == 24
    assert result[0]["createdByName"] == "Teacher 0"
    users.query_items.assert_called_once()
    users.read_item.assert_not_called()
    invitations.query_items.assert_not_called()


def test_invited_creators_are_batched_only_when_missing(monkeypatch):
    users = Mock()
    users.query_items.return_value = [{"id": "active", "displayName": "Active teacher"}]
    invitations = Mock()
    invitations.query_items.return_value = [{"id": "invited", "name": "Invited teacher"}]
    monkeypatch.setattr(queries, "_users", lambda: users)
    monkeypatch.setattr(queries, "_invited", lambda: invitations)
    result = queries.get_profiles_batch(["active", "invited", "active"], include_invites=True)
    assert set(result) == {"active", "invited"}
    assert invitations.query_items.call_args.kwargs["parameters"] == [{"name": "@user0", "value": "invited"}]


def test_courses_do_not_inherit_creator_or_teacher_departments(monkeypatch):
    agents = Mock()
    agents.query_items.return_value = [{
        "id": "course-example", "createdById": "creator", "teacherIds": ["creator", "teacher", "invited"],
    }, {"id": "unaffiliated"}]
    users = Mock()
    users.query_items.return_value = [
        {"id": "creator", "displayName": "Example Creator", "institute": " College North ", "department": "Engineering",
         "affiliations": [
             {"institute": "college north", "department": "engineering"},
             {"institute": "College South", "department": "Mathematics"},
         ]},
        {"id": "teacher", "college": "College West", "department": "Physics"},
    ]
    invited = Mock()
    invited.query_items.return_value = [{"id": "invited", "institute": "College East", "department": "Chemistry"}]
    monkeypatch.setattr(queries, "_agents", lambda: agents)
    monkeypatch.setattr(queries, "_users", lambda: users)
    monkeypatch.setattr(queries, "_invited", lambda: invited)
    courses = queries.list_agents()
    assert courses[0]["courseAffiliations"] == []
    assert courses[1]["courseAffiliations"] == []
    users.query_items.assert_called_once()
    invited.query_items.assert_called_once()
    assert invited.query_items.call_args.kwargs["parameters"] == [{"name": "@user0", "value": "invited"}]
    assert "c.teacherIds" in agents.query_items.call_args.kwargs["query"]
    assert "c.affiliations" in users.query_items.call_args.kwargs["query"]
    assert "c.department" in invited.query_items.call_args.kwargs["query"]


def test_explicit_course_affiliation_does_not_leak_other_staff_departments(monkeypatch):
    agents = Mock()
    agents.query_items.return_value = [
        {"id": "explicit", "createdById": "creator", "institution": "College North", "department": "Physics"},
        {"id": "partial", "createdById": "creator", "institute": "College North"},
    ]
    users = Mock()
    users.query_items.return_value = [{
        "id": "creator", "institute": "College South", "department": "Mathematics",
        "affiliations": [{"institute": "College North", "department": "Engineering"}],
    }]
    monkeypatch.setattr(queries, "_agents", lambda: agents)
    monkeypatch.setattr(queries, "_users", lambda: users)
    courses = queries.list_agents()
    assert courses[0]["courseAffiliations"] == [{"institute": "College North", "department": "Physics"}]
    assert courses[1]["courseAffiliations"] == []


def test_course_placement_changes_are_visible_on_the_next_list_request(monkeypatch):
    agents = Mock()
    agents.query_items.side_effect = [
        [{"id": "course-example", "institute": "College North", "department": "Physics"}],
        [{"id": "course-example", "institute": "College South", "department": "Electronics"}],
    ]
    monkeypatch.setattr(queries, "_agents", lambda: agents)
    assert queries.list_agents()[0]["courseAffiliations"] == [{"institute": "College North", "department": "Physics"}]
    assert queries.list_agents()[0]["courseAffiliations"] == [{"institute": "College South", "department": "Electronics"}]


def test_fifty_learner_overview_uses_one_profile_query(monkeypatch):
    states = [{
        "id": f"learner-{number}_course-example_state", "userId": f"learner-{number}",
        "agentId": "course-example", "topics": {}, "overall": {"total": 1, "learned": 0},
    } for number in range(50)]
    users = Mock()
    users.query_items.return_value = [{"id": f"learner-{number}", "role": "student"} for number in range(50)]
    monkeypatch.setattr(queries, "list_learning_states_for_agent", lambda _name: states)
    monkeypatch.setattr(queries, "_users", lambda: users)
    result = queries.agent_overview("course-example")
    assert result["student_count"] == 50
    users.query_items.assert_called_once()
    users.read_item.assert_not_called()


def test_profile_batches_are_bounded_and_parameterized(monkeypatch):
    users = Mock()
    users.query_items.return_value = []
    monkeypatch.setattr(queries, "_users", lambda: users)
    identifiers = [f"learner-{number}" for number in range(205)] + ["quoted'identifier"]
    queries.get_profiles_batch(identifiers)
    assert users.query_items.call_count == 3
    for call in users.query_items.call_args_list:
        assert len(call.kwargs["parameters"]) <= 100
        assert "quoted'identifier" not in call.kwargs["query"]


def test_usage_queries_only_the_selected_courses_threads(monkeypatch):
    threads = Mock()
    threads.query_items.return_value = [{"id": "thread-one", "userId": "learner-one"}]
    messages = Mock()
    messages.query_items.return_value = [{"threadId": "thread-one"}]
    monkeypatch.setattr(queries, "_threads_container", threads)
    monkeypatch.setattr(queries, "_messages_container", messages)
    monkeypatch.setattr(queries, "get_profiles_batch", lambda _ids: {"learner-one": {"role": "student"}})
    result = queries.agent_usage_stats("course-example")
    assert result["active_students"] == 1
    request = messages.query_items.call_args.kwargs
    assert "c.threadId IN (@thread0)" in request["query"]
    assert {"name": "@thread0", "value": "thread-one"} in request["parameters"]


@pytest.mark.parametrize("placement", [{}, {"institute": "Different College", "department": "Electronics"}])
def test_overview_projects_only_student_usage_and_preserves_all_time_totals(monkeypatch, placement):
    agents = Mock()
    agents.query_items.return_value = [{"agentId": "course-example", "courseName": "Example", "teacherIds": ["teacher-1"], **placement}]
    users = Mock()
    users.query_items.return_value = [
        {"id": "teacher-1", "role": "teacher", "displayName": "Teacher", "institute": "Example", "department": "Engineering"},
        {"id": "learner-1", "role": "student", "email": "user@example.com", "institute": "Example", "department": "Engineering"},
    ]
    invited = Mock()
    invited.query_items.return_value = []
    threads = Mock()
    threads.query_items.return_value = [
        {"id": "thread-student", "agentId": "course-example", "userId": "learner-1"},
        {"id": "thread-teacher", "agentId": "course-example", "userId": "teacher-1"},
    ]
    messages = Mock()
    legacy_messages = [
        *[{"threadId": "thread-student", "totalTokens": 200} for _ in range(20)],
        {"threadId": "thread-teacher", "totalTokens": 3000},
    ]
    messages.query_items.side_effect = lambda **kwargs: (
        [] if "recordType" in kwargs["query"] else iter(legacy_messages)
    )
    for name, value in (("_agents_container", agents), ("_users_container", users), ("_invited_users_container", invited), ("_threads_container", threads), ("_messages_container", messages)):
        monkeypatch.setattr(queries, name, value)
    courses, users_count = queries.courses_overview()
    assert courses[0]["rounds"] == 20
    assert courses[0]["totalTokens"] == 4000
    assert courses[0]["activeUsers"] == 1
    assert courses[0]["institute"] == placement.get("institute", "")
    assert courses[0]["department"] == placement.get("department", "")
    assert users_count == 1
    request = messages.query_items.call_args.kwargs
    assert "GROUP BY" not in request["query"]
    assert "c.metadata.tokenUsage.total_tokens AS totalTokens" in request["query"]
    assert "c.threadId IN (@thread0)" in request["query"]
    assert request["parameters"] == [{"name": "@role", "value": "assistant"}, {"name": "@thread0", "value": "thread-student"}]
    assert request["max_item_count"] == 500
    courses[0]["rounds"] = 999
    assert queries.courses_overview()[0][0]["rounds"] == 20
    assert messages.query_items.call_count == 2


def test_overview_counts_persisted_usage_without_assistant_messages(monkeypatch):
    agents = Mock()
    agents.query_items.return_value = [{"agentId": "course-example", "courseName": "Example"}]
    users = Mock()
    users.query_items.return_value = [
        {"id": "learner-1", "role": "student", "email": "user@example.com",
         "institute": "Example", "department": "Engineering"},
        {"id": "teacher-1", "role": "teacher"},
    ]
    invited = Mock()
    invited.query_items.return_value = []
    threads = Mock()
    threads.query_items.return_value = []
    messages = Mock()
    events = [
        {"id": "usage-1", "recordType": "token_usage_event", "agentId": "course-example",
         "studentUserId": "learner-1", "conversationId": "foundry-conversation", "totalTokens": 120},
        {"id": "usage-2", "recordType": "token_usage_event", "agentId": "course-example",
         "studentUserId": "learner-1", "conversationId": "foundry-conversation", "totalTokens": 80},
        {"id": "usage-teacher", "recordType": "token_usage_event", "agentId": "course-example",
         "studentUserId": "teacher-1", "totalTokens": 500},
    ]
    messages.query_items.side_effect = lambda **kwargs: (
        events if "recordType" in kwargs["query"] else []
    )
    for name, value in (("_agents_container", agents), ("_users_container", users),
                        ("_invited_users_container", invited), ("_threads_container", threads),
                        ("_messages_container", messages)):
        monkeypatch.setattr(queries, name, value)

    courses, users_count = queries.courses_overview()

    assert courses[0]["totalTokens"] == 200
    assert courses[0]["rounds"] == 2
    assert courses[0]["activeUsers"] == 1
    assert users_count == 1


@pytest.fixture
def usage_sources(monkeypatch):
    containers = {}
    for name in ("agents", "users", "invited_users", "threads", "messages"):
        container = Mock()
        container.query_items.return_value = []
        monkeypatch.setattr(queries, f"_{name}_container", container)
        containers[name] = container
    containers["agents"].query_items.return_value = [
        {"agentId": "course-example", "courseName": "Example"},
        {"agentId": "course-legacy", "courseName": "Legacy"},
    ]
    containers["users"].query_items.return_value = [
        {"id": "learner-1", "role": "student", "displayName": "Learner",
         "email": "user@example.com", "institute": "Example", "department": "Science"},
        {"id": "teacher-1", "role": "teacher"},
    ]
    events = [
        {"id": "usage-1", "agentId": "course-example", "studentUserId": "learner-1",
         "conversationId": "foundry-conversation", "createdAt": "2026-09-01T12:00:00Z", "totalTokens": 120},
        {"id": "usage-2", "agentId": "course-example", "studentUserId": "learner-1",
         "conversationId": "foundry-conversation", "createdAt": "2026-09-01T12:00:00+00:00", "totalTokens": 80},
        {"id": "usage-unattributed", "agentId": "course-example",
         "createdAt": "2026-09-01T13:00:00Z", "totalTokens": 50},
        {"id": "usage-staff", "agentId": "course-example", "studentUserId": "teacher-1",
         "createdAt": "2026-09-01T14:00:00Z", "totalTokens": 500},
    ]
    legacy = []

    def query_messages(**kwargs):
        if "recordType" in kwargs["query"]:
            partition = kwargs.get("partition_key")
            parameters = {item["name"]: item["value"] for item in kwargs.get("parameters", [])}
            return [event for event in events
                    if partition == f"__token_usage__:{event['agentId']}"
                    and event["createdAt"] >= parameters.get("@startDate", "")
                    and event["createdAt"] < parameters.get("@endDate", "9999")]
        return legacy

    containers["messages"].query_items.side_effect = query_messages
    return containers, events, legacy


def test_period_uses_events_and_excludes_staff_and_out_of_range_usage(usage_sources):
    containers, events, _legacy = usage_sources
    containers["threads"].query_items.return_value = [
        {"id": "local-thread", "userId": "learner-1", "agentId": "course-example",
         "createdAt": "2026-09-01T12:00:00Z"},
        {"id": "staff-thread", "userId": "teacher-1", "agentId": "course-example",
         "createdAt": "2026-09-01T12:00:00Z"},
    ]
    events.append({"id": "older-usage", "agentId": "course-example", "studentUserId": "learner-1",
                   "createdAt": "2026-08-31T23:59:59Z", "totalTokens": 900})

    result = queries.today_stats("2026-09-01", "2026-09-01")

    assert result["tokens"] == 250
    assert result["rounds"] == 3
    assert result["activeStudents"] == 1
    assert result["newConversations"] == 1


def test_student_breakdown_uses_explicit_attribution_not_conversation_ids(usage_sources):
    _containers, _events, _legacy = usage_sources

    assert queries.per_student_token_usage("course-example") == [{
        "userId": "learner-1", "displayName": "Learner", "email": "user@example.com",
        "totalTokens": 200, "rounds": 2,
    }]
    assert queries.per_student_token_usage("course-legacy") == []


def test_events_replace_same_course_legacy_totals_but_preserve_other_courses(usage_sources):
    containers, _events, legacy = usage_sources
    containers["threads"].query_items.return_value = [
        {"id": "event-course-thread", "userId": "learner-1", "agentId": "course-example",
         "createdAt": "2026-09-01T12:00:00Z"},
        {"id": "legacy-course-thread", "userId": "learner-1", "agentId": "course-legacy",
         "createdAt": "2026-09-01T12:00:00Z"},
    ]
    legacy.extend([
        {"threadId": "event-course-thread", "createdAt": "2026-09-01T12:00:00Z",
         "totalTokens": 200, "tokenUsage": {"total_tokens": 200}},
        {"threadId": "legacy-course-thread", "createdAt": "2026-09-01T12:00:00Z",
         "totalTokens": 30, "tokenUsage": {"total_tokens": 30}},
    ])

    courses, _users_count = queries.courses_overview()
    assert {course["agentId"]: course["totalTokens"] for course in courses} == {
        "course-example": 250, "course-legacy": 30,
    }
    assert {course["agentId"]: (
        course["attributedTokens"], course["attributedRounds"], course["attributedStudents"]
    ) for course in courses} == {
        "course-example": (200, 2, 1), "course-legacy": (30, 1, 1),
    }
    assert queries.today_stats("2026-09-01", "2026-09-01")["tokens"] == 280
    assert queries.per_student_token_usage()[0]["totalTokens"] == 230
    assert queries.per_student_token_usage()[0]["rounds"] == 3


def test_unattributed_events_do_not_invent_student_usage(usage_sources):
    _containers, events, _legacy = usage_sources
    events[:] = [event for event in events if not event.get("studentUserId")]

    courses, _users_count = queries.courses_overview()
    course = next(course for course in courses if course["agentId"] == "course-example")

    assert course["totalTokens"] == 50
    assert course["rounds"] == 1
    assert course["attributedTokens"] == 0
    assert course["attributedRounds"] == 0
    assert course["attributedStudents"] == 0
    assert course["activeUsers"] == 0
    assert queries.per_student_token_usage("course-example") == []


def test_summary_cache_coalesces_concurrent_reads():
    entered = Event()
    release = Event()
    calls = []

    @dashboard_cache.cached_view
    def summary(course):
        calls.append(course)
        entered.set()
        assert release.wait(2)
        return {"course": course}

    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = [pool.submit(summary, "course-example") for _ in range(4)]
        assert entered.wait(2)
        release.set()
        assert [task.result(timeout=3) for task in pending] == [{"course": "course-example"}] * 4
    assert calls == ["course-example"]


def test_summary_expiry_invalidation_and_failure_retry(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(dashboard_cache, "monotonic", lambda: now[0])
    calls = Mock(side_effect=[{"value": 1}, {"value": 2}, RuntimeError("unavailable"), {"value": 3}])

    @dashboard_cache.cached_view
    def summary():
        return calls()

    assert summary() == summary() == {"value": 1}
    now[0] = 31
    assert summary() == {"value": 2}
    dashboard_cache.invalidate_views()
    with pytest.raises(RuntimeError):
        summary()
    assert summary() == {"value": 3}


def test_successful_or_partial_admin_edits_invalidate_summaries():
    calls = Mock(return_value={"count": 1})

    @dashboard_cache.cached_view
    def summary():
        return calls()

    @dashboard_cache.invalidates_views
    def edit(fail=False):
        if fail:
            raise RuntimeError("partial write")

    summary()
    edit()
    summary()
    with pytest.raises(RuntimeError):
        edit(True)
    summary()
    assert calls.call_count == 3