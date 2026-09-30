from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dependencies import agent_access, learner_access
from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.routers import assessments, learner_memory
from learner_memory import service as service_module, settings
from test_graph_memory_processing import SCOPE, service_fixture


def client_fixture(monkeypatch):
    service, repository, extractor, graph = service_fixture()
    course = {
        "id": SCOPE.course_id, "_etag": "course-1", "status": "active", "createdById": "teacher-a",
        "teacherIds": [], "studentIds": [SCOPE.student_id],
        "memory_scope": {"tenant_id": SCOPE.tenant_id, "institute_id": SCOPE.institute_id},
        "curriculum_binding": {"curriculum_id": SCOPE.curriculum_id, "curriculum_version": SCOPE.curriculum_version},
        "graph_memory_mode": "authoritative",
    }
    service.register_scope(SCOPE.tenant_id, SCOPE.institute_id, ["admin-a"])
    monkeypatch.setattr(settings, "get_memory_settings", lambda: service.settings)
    monkeypatch.setattr(service_module, "get_service", lambda: service)
    monkeypatch.setattr(agent_access, "load_agent", lambda _identity: course)
    monkeypatch.setattr(agent_access, "student_assignment_ids", lambda _identity: [])
    monkeypatch.setattr(learner_access, "load_target_profile", lambda uid: {"id": uid, "role": "student", "status": "active"})
    from azure_services.persistence import cosmos_db

    monkeypatch.setattr(cosmos_db, "create_first_quiz_attempt", Mock(return_value=({"id": "compatibility-asset"}, True)))
    app = FastAPI()
    app.include_router(assessments.router)
    app.include_router(learner_memory.router)
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id=SCOPE.student_id, role="student", status="active")
    return TestClient(app), app, service, repository, extractor, graph


def test_real_http_contract_restores_server_grading_after_reload(monkeypatch):
    client, _app, service, _repository, _extractor, _graph = client_fixture(monkeypatch)
    public = service.freeze_assessment(SCOPE, [], "Frozen title", ["M1-A"], "http-quiz")
    response = client.post("/api/quiz-attempts/first", json={
        "userId": SCOPE.student_id, "quizId": "http-quiz", "title": "Browser edited title",
        "agentId": SCOPE.course_id, "assessmentType": "concept_inventory",
        "assessmentInstanceId": "http-quiz", "curriculumVersion": SCOPE.curriculum_version,
        "event_id": "http-quiz-event",
        "answers": [{"problemId": "M1-A", "selected": [1], "correct": [1], "reason": "I selected the second option."}],
    })
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["answers"][0]["correct"] == [0]
    assert result["score"] == 0
    assert "correct" not in public["questions"][0]
    restored = client.get(f"/api/quiz-attempts/http-quiz/first?agentId={SCOPE.course_id}")
    assert restored.status_code == 200, restored.text
    assert restored.json()["answers"] == result["answers"]
    assert restored.json()["score"] == 0
    assert restored.json()["receipt"]["event_id"] == "http-quiz-event"


def test_real_memory_endpoint_exposes_processing_failure_without_success_fallback(monkeypatch):
    client, app, service, _repository, extractor, _graph = client_fixture(monkeypatch)
    service.freeze_assessment(SCOPE, [], "Frozen title", ["M1-A"], "failed-quiz")
    result = service.submit_assessment(SCOPE, "failed-quiz", [{"selected": [0], "reason": "A direct explanation."}], "failed-event")
    from learner_memory.settings import MemorySettings
    from learner_memory.processor import MemoryProcessor

    service.settings = MemorySettings(**{**service.settings.model_dump(), "max_attempts": 1})
    extractor.fail = True
    try:
        service.process_event(SCOPE, result["receipt"]["event_id"])
    except ValueError:
        pass
    response = client.get(f"/api/agents/{SCOPE.course_id}/learners/{SCOPE.student_id}/memory")
    assert response.status_code == 200, response.text
    assert response.json()["snapshot_version"] == 0
    assert response.json()["pending_count"] == 1
    assert response.json()["processing_receipt"]["status"] == "FAILED"
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="teacher-a", role="teacher", status="active")
    retry = client.post(f"/api/agents/{SCOPE.course_id}/learners/{SCOPE.student_id}/memory/recomputations", json={"event_id": "operator-retry"})
    assert retry.status_code == 202, retry.text
    extractor.fail = False
    MemoryProcessor(service).process(SCOPE, "failed-event")
    assert service.get_snapshot(SCOPE).snapshot_version == 1


def test_teacher_evidence_requires_authorized_role_and_records_provenance(monkeypatch):
    client, app, service, _repository, _extractor, _graph = client_fixture(monkeypatch)
    endpoint = f"/api/agents/{SCOPE.course_id}/learners/{SCOPE.student_id}/memory/events"
    payload = {
        "event_id": "teacher-check", "source_id": "reviewed-response",
        "answer": "A", "reasoning": "The definition excludes repeated vertices.",
        "problem_ids": ["M1-A"], "verified_learner_work": True,
    }
    denied = client.post(endpoint, json=payload)
    assert denied.status_code == 403
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="teacher-a", role="teacher", status="active")
    accepted = client.post(endpoint, json=payload)
    assert accepted.status_code == 202, accepted.text
    service.process_event(SCOPE, accepted.json()["event_id"])
    evidence = service.list_evidence(SCOPE)
    assert evidence[0].source == "TEACHER_ASSESSMENT"
    assert evidence[0].provenance.actor_id == "teacher-a"
    assert evidence[0].quality.catalog_approved
    assert service.get_snapshot(SCOPE).misconception_states["M1"].state != "CLEARED"


def test_config_contract_exposes_only_real_management_permission(monkeypatch):
    client, app, _service, _repository, _extractor, _graph = client_fixture(monkeypatch)
    response = client.get(f"/api/agents/{SCOPE.course_id}/memory/config")
    assert response.status_code == 200
    assert response.json()["can_manage"] is False
    assert response.json()["graph_memory_mode"] == "authoritative"
    assert response.json()["revision"] == "course-1"
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="teacher-a", role="teacher", status="active")
    assert client.get(f"/api/agents/{SCOPE.course_id}/memory/config").json()["can_manage"] is False


def test_existing_curriculum_import_reuses_course_content_but_never_imports_crossings(monkeypatch):
    client, app, service, _repository, _extractor, _graph = client_fixture(monkeypatch)
    from utils import course_creation

    monkeypatch.setattr(course_creation, "load_curriculum_snapshot", lambda _course: {
        "course_name": "Existing course", "all_threshold_concepts": ["Connectivity"],
        "Connectivity": {"description": "Connections", "misconceptions": ["Local links always give global connectivity"]},
    })
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="teacher-a", role="teacher", status="active")
    response = client.post(
        f"/api/agents/{SCOPE.course_id}/course-curriculum/graph/import",
        json={"curriculum_version": "import-v2"},
    )
    assert response.status_code == 200, response.text
    graph = response.json()["graph"]
    assert graph["status"] == "DRAFT"
    assert graph["published_ready"] is False
    assert graph["policies"]["teacher_reviewed"] is False
    assert any(node["name"] == "Connectivity" for node in graph["nodes"])
    assert service.read_graph(SCOPE.tenant_id, SCOPE.curriculum_id, "import-v2") is None
