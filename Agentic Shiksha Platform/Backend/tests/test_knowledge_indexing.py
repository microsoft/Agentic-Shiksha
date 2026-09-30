from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.dependencies import agent_access
from backend.routers import course_materials as routes
from backend.schemas.course_materials import IndexingOperation, MaterialFile
from azure_services.tools.search import course_index_manager
from utils import course_materials
from utils.course_materials import save_operation as persist_operation


@pytest.fixture
def indexing(monkeypatch):
    course = {
        "id": "course-example", "_etag": "revision-1", "createdById": "teacher-1",
        "teacherIds": ["teacher-1"], "studentIds": ["student-1"],
    }
    files = [MaterialFile(filename="notes.pdf", etag="file-revision-1")]
    monkeypatch.setattr(course_materials, "load_course", lambda _name: deepcopy(course))
    monkeypatch.setattr(agent_access, "student_assignment_ids", lambda user_id: [user_id])
    monkeypatch.setattr(course_materials, "load_setup", lambda _name: {"sessionUuid": "example-session"})
    monkeypatch.setattr(course_materials, "list_material_files", lambda *_args: list(files))
    save = Mock(side_effect=lambda _course, operation: course.update(materialIndexing=operation.model_dump(mode="json")))
    monkeypatch.setattr(course_materials, "save_operation", save)
    monkeypatch.setattr(course_index_manager, "get_common_indexer_status", Mock(return_value={"status": "running"}))
    monkeypatch.setattr(course_index_manager, "run_common_indexer", Mock(return_value=(True, "example-indexer")))
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="teacher-1", role="teacher", status="active")
    return TestClient(app), course, files, save


def start(client):
    return client.post("/api/knowledge/update-index", data={
        "agent_name": "course-example", "session_uuid": "example-session", "kb_scope": "course",
    })


@pytest.mark.parametrize("failure", ["pipeline", "indexer", "exception"])
def test_index_start_failure_is_not_reported_as_success(indexing, monkeypatch, failure):
    status = Mock(return_value={"error": "private service details"} if failure == "pipeline" else {})
    run = Mock(return_value=(False, "private service details"))
    if failure == "exception":
        run.side_effect = RuntimeError("private service details")
    monkeypatch.setattr(course_index_manager, "get_common_indexer_status", status)
    monkeypatch.setattr(course_index_manager, "run_common_indexer", run)

    response = start(indexing[0])

    assert response.status_code == 503
    assert response.json() == {"detail": "Course indexing could not be started. Please retry."}
    if failure == "pipeline":
        run.assert_not_called()


def test_accepted_run_is_pending_and_durable(indexing):
    client, course, files, save = indexing
    response = start(client)
    assert response.status_code == 202
    assert response.json()["status"] == "indexing"
    assert response.json()["indexed_files"] == 0
    assert course["materialIndexing"]["id"] == response.json()["operation_id"]
    assert course["materialIndexing"]["files"] == [item.model_dump() for item in files]
    save.assert_called_once()


@pytest.mark.parametrize("role,user_id,expected", [
    ("student", "student-1", 403), ("teacher", "other-teacher", 403),
    ("teacher", "teacher-1", 202), ("admin", "admin-1", 202),
])
def test_only_course_teachers_can_start_indexing(indexing, role, user_id, expected):
    client = indexing[0]
    client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id=user_id, role=role, status="active")
    assert start(client).status_code == expected
    if expected == 403:
        indexing[3].assert_not_called()


def test_sign_in_required(indexing):
    client = indexing[0]
    client.app.dependency_overrides.clear()
    assert start(client).status_code == 401
    indexing[3].assert_not_called()


def test_session_mismatch_cannot_start_indexing(indexing, monkeypatch):
    monkeypatch.setattr(course_materials, "load_setup", lambda _name: {"sessionUuid": "other-session"})
    assert start(indexing[0]).status_code == 409
    indexing[3].assert_not_called()


def execution(started, *, status="success", failed_items=0):
    return {"lastResult": {
        "status": status, "startTime": started.isoformat(),
        "endTime": (started + timedelta(seconds=1)).isoformat(),
        "itemsFailed": failed_items, "errors": [],
    }}


@pytest.mark.parametrize("scenario,state", [
    ("old-success", "indexing"), ("running", "indexing"),
    ("new-success", "ready"), ("missing-file", "indexing"),
    ("stale-deleted-file", "indexing"), ("partial-failure", "failed"),
    ("execution-failure", "failed"), ("file-replaced", "changed"),
])
def test_readiness_requires_fresh_success_and_exact_file_set(indexing, monkeypatch, scenario, state):
    client, course, files, _save = indexing
    response = start(client)
    operation = IndexingOperation.model_validate(course["materialIndexing"])
    started = operation.requested_at + timedelta(seconds=1)
    names = {"notes.pdf"}
    result = execution(started)
    if scenario == "old-success":
        result = execution(started - timedelta(minutes=1))
    elif scenario == "running":
        result = execution(started, status="inProgress")
    elif scenario == "missing-file":
        names = set()
    elif scenario == "stale-deleted-file":
        names.add("removed.pdf")
    elif scenario == "partial-failure":
        result = execution(started, failed_items=1)
    elif scenario == "execution-failure":
        result = execution(started, status="transientFailure")
    elif scenario == "file-replaced":
        files[0] = MaterialFile(filename="notes.pdf", etag="file-revision-2")
    monkeypatch.setattr(course_index_manager, "get_common_indexer_status", lambda: result)
    query = Mock(return_value=names)
    monkeypatch.setattr(course_materials, "indexed_material_names", query)

    status = client.get("/api/knowledge/index-status", params={
        "agent_name": "course-example", "operation_id": response.json()["operation_id"],
    })
    assert status.status_code == 200
    assert status.json()["status"] == state
    if state == "ready":
        assert status.json()["indexed_files"] == 1
        assert course["materialIndexing"]["state"] == "ready"
        query.assert_called_once_with("example-session", "course")


def test_changed_request_is_not_reported_as_ready(indexing):
    client = indexing[0]
    start(client)
    status = client.get("/api/knowledge/index-status", params={
        "agent_name": "course-example", "operation_id": "f" * 32,
    })
    assert status.status_code == 409


def test_status_failure_is_redacted(indexing, monkeypatch):
    client = indexing[0]
    started = start(client).json()
    monkeypatch.setattr(course_index_manager, "get_common_indexer_status", lambda: {"error": "private service details"})
    status = client.get("/api/knowledge/index-status", params={
        "agent_name": "course-example", "operation_id": started["operation_id"],
    })
    assert status.status_code == 503
    assert "private" not in status.text


def test_operation_times_out_without_claiming_ready(indexing):
    start(indexing[0])
    operation = IndexingOperation.model_validate(indexing[1]["materialIndexing"])
    status = course_materials.check_operation(operation, operation.requested_at + timedelta(minutes=16))
    assert status.status == "failed"


def test_index_query_is_session_and_scope_filtered(monkeypatch, passages):
    client = Mock()
    client.search.return_value = [
        {"document_title": "notes.pdf", "content_path": "https://example.blob.core.windows.net/materials/sessions/example-session/course/notes.pdf"},
    ]
    monkeypatch.setattr(course_materials, "get_search_client", lambda: client)
    assert course_materials.indexed_material_names("example-session", "course") == {"notes.pdf"}
    assert client.search.call_args.kwargs["filter"] == "session_id eq 'example-session' and file_category eq 'course'"


def test_cross_course_index_metadata_is_rejected(monkeypatch, passages):
    client = Mock()
    client.search.return_value = [
        {"document_title": "notes.pdf", "content_path": "https://example.blob.core.windows.net/materials/sessions/other-session/course/notes.pdf"},
    ]
    monkeypatch.setattr(course_materials, "get_search_client", lambda: client)
    with pytest.raises(ValueError):
        course_materials.indexed_material_names("example-session", "course")


@pytest.fixture
def passages(monkeypatch):
    from azure_services import config

    monkeypatch.setattr(config, "COMMON_INDEX_NAME", "example-index")
    monkeypatch.setattr(config, "STORAGE_ACCOUNT", "example")
    monkeypatch.setattr(config, "BLOB_CONTAINER", "materials")
    document = {
        "content_id": "chunk-1", "document_title": "notes.pdf", "content_text": "Exact passage from page three.",
        "content_path": "https://example.blob.core.windows.net/materials/sessions/example-session/course/notes.pdf",
        "session_id": "example-session", "file_category": "course", "page_number": 3, "logical_section": "Measurement",
    }
    client = Mock()
    client.search.return_value = [document]
    monkeypatch.setattr(course_materials, "get_search_client", lambda: client)
    index = {"index_name": "example-index", "filter": "session_id eq 'example-session'", "query_type": "vector_semantic_hybrid", "top_k": 20}
    return client, document, index


def test_passage_citations_use_exact_indexed_evidence_and_authenticated_file_link(passages):
    client, document, index = passages
    sources = course_materials.retrieve_course_passages("course-example", "example-session", "Read the file", index)
    assert len(sources) == 1
    source = sources[0]
    assert source.excerpt == document["content_text"]
    assert source.filename == "notes.pdf"
    assert source.page_number == 3
    assert source.section == "Measurement"
    assert source.url == "/api/agents/course-example/course-materials/file?filename=notes.pdf&kb_scope=course"
    assert "search.windows.net" not in source.url
    query = client.search.call_args.kwargs
    assert f"({index['filter']})" in query["filter"]
    assert "and (session_id eq 'example-session')" in query["filter"]
    assert query["query_type"] == "semantic"


def test_textbook_passage_retains_its_category_and_download_scope(passages):
    _client, document, index = passages
    document["file_category"] = "textbook"
    document["content_path"] = document["content_path"].replace("/course/", "/textbook/")
    sources = course_materials.retrieve_course_passages("course-example", "example-session", "Read the textbook", index)
    assert sources[0].filename == "notes.pdf"
    assert sources[0].url.endswith("kb_scope=textbook")


def test_pdf_preparation_preserves_original_and_complete_page_references(monkeypatch):
    import fitz
    from utils import material_uploads

    with fitz.open() as document:
        for number in range(5):
            document.new_page().insert_text((72, 72), f"Synthetic course page {number + 1}")
        original = document.tobytes()
    original_copy = bytes(original)
    monkeypatch.setattr(material_uploads, "INDEX_PART_PAGES", 2)
    report = material_uploads.inspect_material("notes.pdf", original)
    parts = list(material_uploads.prepared_parts(original, report))
    assert report.pages == 5
    assert report.needs_preparation
    assert [(part.page_start, part.page_end) for part in parts] == [(1, 2), (3, 4), (5, 5)]
    assert original == original_copy
    assert sum(len(fitz.open(stream=part.content, filetype="pdf")) for part in parts) == 5
    assert all(len(part.content) <= material_uploads.INDEX_PART_BYTES for part in parts)
    assert all(material_uploads.PART_PATTERN.fullmatch(part.filename) for part in parts)
    assert parts == list(material_uploads.prepared_parts(original, report))


@pytest.mark.parametrize("name,content", [
    ("legacy.doc", b"example"), ("empty.txt", b""), ("notes.txt", b"not\x00text"),
    ("broken.pdf", b"%PDF-invalid"), ("broken.docx", b"not a zip"), ("image.png", b"not an image"),
])
def test_material_preflight_rejects_unprocessable_files(name, content):
    from utils.material_uploads import MaterialRejected, inspect_material

    with pytest.raises(MaterialRejected):
        inspect_material(name, content)


def test_material_preflight_rejects_locked_pdf_and_oversized_non_pdf(monkeypatch):
    import fitz
    from utils import material_uploads

    with fitz.open() as document:
        document.new_page()
        locked = document.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="example-only")
    with pytest.raises(material_uploads.MaterialRejected, match="Unlock"):
        material_uploads.inspect_material("locked.pdf", locked)
    monkeypatch.setattr(material_uploads, "INDEX_PART_BYTES", 10)
    with pytest.raises(material_uploads.MaterialRejected, match="Non-PDF"):
        material_uploads.inspect_material("large.txt", b"example text beyond limit")


def test_prepared_names_do_not_overwrite_sanitized_filename_collisions():
    from utils.material_uploads import inspect_material, prepared_parts

    first = inspect_material("notes?.txt", b"example")
    second = inspect_material("notes!.txt", b"example")
    assert first.stored_filename == second.stored_filename
    assert next(prepared_parts(b"example", first)).filename != next(prepared_parts(b"example", second)).filename


@pytest.fixture
def material_job_store(monkeypatch):
    from azure.cosmos.exceptions import CosmosResourceExistsError, CosmosResourceNotFoundError, CosmosHttpResponseError
    from utils import material_jobs

    documents = {}

    def create(*, body):
        if body["id"] in documents:
            raise CosmosResourceExistsError(message="exists")
        documents[body["id"]] = {**deepcopy(body), "_etag": "1"}
        return deepcopy(documents[body["id"]])

    def read(*, item, partition_key):
        assert item == partition_key
        if item not in documents:
            raise CosmosResourceNotFoundError(message="missing")
        return deepcopy(documents[item])

    def replace(*, item, body, etag, match_condition):
        from azure.core import MatchConditions

        assert match_condition == MatchConditions.IfNotModified
        if etag != documents[item]["_etag"]:
            raise CosmosHttpResponseError(status_code=412, message="changed")
        documents[item] = {**deepcopy(body), "_etag": str(int(etag) + 1)}
        return deepcopy(documents[item])

    container = Mock(create_item=Mock(side_effect=create), read_item=Mock(side_effect=read), replace_item=Mock(side_effect=replace))
    monkeypatch.setattr(material_jobs, "job_container", lambda: container)
    return material_jobs, documents, container


def test_material_draft_is_owner_bound_and_idempotent(material_job_store):
    jobs, _documents, _container = material_job_store
    first = jobs.create_draft("teacher-1", "1" * 36)
    assert jobs.create_draft("teacher-1", "1" * 36).id == first.id
    assert jobs.create_draft("teacher-2", "1" * 36).id != first.id
    assert first.progress == "uploading"
    assert jobs.claim_job(first) is None


def test_processing_claim_uses_etag_and_resumes_expired_lease(material_job_store):
    from datetime import datetime, timezone
    from azure.cosmos.exceptions import CosmosHttpResponseError

    jobs, documents, _container = material_job_store
    job = jobs.create_draft("teacher-1", "2" * 36)
    job.progress = "preparing"
    job = jobs.save_job(job)
    stale = job.model_copy(deep=True)
    claimed = jobs.claim_job(job)
    assert claimed.status == "RUNNING"
    assert jobs.claim_job(jobs.load_job(job.id)) is None
    with pytest.raises(CosmosHttpResponseError):
        jobs.claim_job(stale)
    documents[job.id]["lease_until"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    resumed = jobs.claim_job(jobs.load_job(job.id))
    assert resumed.attempts == 2
    assert resumed.lease_owner != claimed.lease_owner
    with pytest.raises(ValueError, match="lease expired"):
        jobs.save_checkpoint(claimed)
    assert jobs.save_checkpoint(resumed).lease_owner == resumed.lease_owner


def test_upload_preflight_and_receipt_do_not_claim_indexing_success(indexing, material_job_store, monkeypatch):
    client = indexing[0]
    container = Mock()
    monkeypatch.setattr(course_materials, "get_material_container", lambda: container)
    preflight = client.post("/api/knowledge/preflight", files=[("files", ("notes.txt", b"Example course notes."))])
    assert preflight.status_code == 200
    assert preflight.json()["accepted"] is True
    invalid = client.post("/api/knowledge/preflight", files=[("files", ("notes.doc", b"not a supported format"))])
    assert invalid.json()["accepted"] is False
    container.get_blob_client.assert_not_called()
    draft = client.post("/api/knowledge/drafts", json={"request_id": "3" * 36}).json()
    uploaded = client.post("/api/knowledge/build", data={"session": draft["session_uuid"], "kb_scope": "textbook"}, files=[("files", ("notes.txt", b"Example course notes."))])
    assert uploaded.status_code == 202, uploaded.text
    assert uploaded.json()["progress"] == "uploading"
    assert uploaded.json()["files"][0]["status"] == "uploaded"
    assert uploaded.json()["files"][0]["kb_scope"] == "textbook"
    metadata = container.get_blob_client.return_value.upload_blob.call_args.kwargs["metadata"]
    assert metadata["AzureSearch_Skip"] == "true"
    assert container.get_blob_client.return_value.upload_blob.call_args.kwargs["overwrite"] is False
    result = client.post(f"/api/knowledge/jobs/{draft['job_id']}/process", json={})
    assert result.status_code == 202
    assert result.json()["progress"] == "preparing"
    course_index_manager.run_common_indexer.assert_not_called()


def test_material_jobs_reject_other_owner_student_and_unclaimed_session(indexing, material_job_store):
    client = indexing[0]
    draft = client.post("/api/knowledge/drafts", json={"request_id": "4" * 36}).json()
    client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="other-teacher", role="teacher", status="active")
    assert client.get(f"/api/knowledge/jobs/{draft['job_id']}").status_code == 403
    assert client.post("/api/knowledge/build", data={"session": draft["session_uuid"], "kb_scope": "course"}, files=[("files", ("notes.txt", b"example"))]).status_code == 403
    assert client.post("/api/knowledge/build", data={"session": "a" * 36, "kb_scope": "course"}, files=[("files", ("notes.txt", b"example"))]).status_code == 404
    client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="student-1", role="student", status="active")
    assert client.post("/api/knowledge/drafts", json={"request_id": "5" * 36}).status_code == 403


def test_material_worker_resumes_copies_and_triggers_one_index_run(material_job_store, monkeypatch):
    import hashlib
    from azure.core.exceptions import ResourceExistsError
    from utils import material_uploads
    from backend.schemas.course_materials import MaterialJobFile

    jobs, _documents, _container = material_job_store
    content = b"Synthetic course material."
    job = jobs.create_draft("teacher-1", "6" * 36)
    job.files = [MaterialJobFile(source=material_uploads.inspect_material("notes.txt", content), kb_scope="textbook")]
    job = jobs.start_processing(jobs.save_job(job), [])
    part = next(material_uploads.prepared_parts(content, job.files[0].source))
    blob = Mock()
    blob.download_blob.return_value.readall.return_value = content
    blob.upload_blob.side_effect = ResourceExistsError(message="previous worker already uploaded")
    blob.get_blob_properties.return_value = SimpleNamespace(size=len(part.content), metadata={"source_sha256": hashlib.sha256(part.content).hexdigest(), "processing_generation": "0"}, etag="copy-v1")
    container = Mock()
    container.get_blob_client.return_value = blob
    monkeypatch.setattr(course_materials, "get_material_container", lambda: container)
    monkeypatch.setattr(jobs, "renew_lease", lambda _job: None)
    run = Mock(return_value=(True, "example-indexer"))
    status = Mock(return_value={})
    monkeypatch.setattr(course_index_manager, "run_common_indexer", run)
    monkeypatch.setattr(course_index_manager, "get_common_indexer_status", status)

    def advance():
        pending = jobs.load_job(job.id)
        pending.next_attempt_at = pending.created_at
        return jobs.advance_job(jobs.claim_job(jobs.save_job(pending)))

    prepared = advance()
    assert prepared.files[0].status == "indexing"
    assert prepared.files[0].parts[0].filename == part.filename
    assert blob.set_blob_metadata.call_count == 0
    boundary = advance().index_requested_at
    assert boundary is not None
    advance()
    advance()
    run.assert_called_once()
    status.return_value = execution(boundary + timedelta(seconds=1))
    monkeypatch.setattr(course_materials, "indexed_material_names", lambda *_args: {part.filename})
    done = advance()
    assert done.status == "COMPLETED"
    assert done.files[0].status == "ready"


def test_material_worker_reports_unindexed_file_and_retries_only_failure(material_job_store, monkeypatch):
    from utils import material_uploads
    from backend.schemas.course_materials import MaterialJobFile, MaterialPart

    jobs, _documents, _container = material_job_store
    job = jobs.create_draft("teacher-1", "7" * 36)
    for name in ("ready.txt", "failed.txt"):
        job.files.append(MaterialJobFile(
            source=material_uploads.inspect_material(name, b"example"), kb_scope="course", status="indexing",
            parts=[MaterialPart(filename=name, etag="revision")],
        ))
    job.progress = "indexing"
    job.index_requested_at = job.created_at
    job = jobs.save_job(job)
    monkeypatch.setattr(course_index_manager, "get_common_indexer_status", lambda: execution(job.created_at + timedelta(seconds=1)))
    monkeypatch.setattr(course_materials, "indexed_material_names", lambda *_args: {"ready.txt"})
    result = jobs.advance_job(jobs.claim_job(job))
    assert result.status == "FAILED"
    assert [entry.status for entry in result.files] == ["ready", "failed"]
    retry = jobs.start_processing(result, [result.files[1].source.source_id])
    assert [entry.status for entry in retry.files] == ["ready", "uploaded"]
    assert retry.files[1].generation == 1
    assert retry.files[0].generation == 0


def test_prepared_passage_uses_original_page_and_preserved_download(passages, material_job_store):
    from backend.schemas.course_materials import MaterialJobFile, MaterialPart
    from utils import material_uploads

    jobs, _documents, _container = material_job_store
    _client, document, index = passages
    job = jobs.create_draft("teacher-1", "8" * 36)
    job.agent_name = "course-example"
    source = material_uploads.inspect_material("Original notes.txt", b"example")
    source.filename = "Original notes.pdf"
    source.stored_filename = "Original_notes.pdf"
    filename = f"Original_notes--{source.source_id}--p000051-000100.pdf"
    job.files = [MaterialJobFile(source=source, kb_scope="textbook", parts=[MaterialPart(filename=filename, etag="revision", page_start=51, page_end=100)])]
    jobs.save_job(job)
    document.update(
        document_title=filename, file_category="textbook", session_id=job.session_uuid,
        content_path=f"https://example.blob.core.windows.net/materials/sessions/{job.session_uuid}/textbook/{filename}",
        page_number=3,
    )
    index["filter"] = f"session_id eq '{job.session_uuid}'"
    citation = course_materials.retrieve_course_passages("course-example", job.session_uuid, "Read the textbook", index)[0]
    assert citation.filename == "Original notes.pdf"
    assert citation.page_number == 53
    assert f"source_id={source.source_id}" in citation.url
    assert "filename=Original+notes.pdf" in citation.url


def test_creation_is_durable_idempotent_and_rejects_changed_input(material_job_store, monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest
    from utils import course_creation

    jobs, _documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    job = jobs.create_draft("teacher-1", "9" * 36)
    request = CourseCreationRequest(name="course-example", courseName="Example", sessionUuid=job.session_uuid, model="example-model")
    started = course_creation.start_creation(job, request)
    assert started.creation.status == "PENDING"
    assert course_creation.start_creation(jobs.load_job(job.id), request).creation.manage_code == started.creation.manage_code
    with pytest.raises(ValueError, match="request changed"):
        course_creation.start_creation(jobs.load_job(job.id), request.model_copy(update={"courseName": "Different"}))
    other = jobs.create_draft("teacher-2", "9" * 36)
    with pytest.raises(ValueError, match="reserved"):
        course_creation.start_creation(other, request.model_copy(update={"sessionUuid": other.session_uuid}))


def test_creation_checkpoints_independent_preparation_and_requires_metadata_save(material_job_store, monkeypatch):
    import threading
    from backend.schemas.course_creation import CourseCreationRequest, CourseSpecification
    from utils import course_creation

    jobs, _documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    monkeypatch.setattr(course_creation, "find_owned_agent", lambda _job: None)
    barrier = threading.Barrier(2, timeout=5)
    specification = CourseSpecification(description="Example", instructions="Course-specific specification for the example course.")

    def prepare_spec(_request):
        barrier.wait()
        return specification

    def prepare_memory(_job):
        barrier.wait()
        return "example-memory"

    generate = Mock(side_effect=prepare_spec)
    memory = Mock(side_effect=prepare_memory)
    create = Mock(return_value="1")
    persist = Mock(side_effect=RuntimeError("private storage failure"))
    monkeypatch.setattr(course_creation, "generate_specification", generate)
    monkeypatch.setattr(course_creation, "prepare_memory", memory)
    monkeypatch.setattr(course_creation, "create_foundry_agent", create)
    monkeypatch.setattr(course_creation, "persist_created_course", persist)
    job = jobs.create_draft("teacher-1", "a" * 36)
    job = course_creation.start_creation(job, CourseCreationRequest(name="course-example", courseName="Example", sessionUuid=job.session_uuid))

    def advance():
        pending = jobs.load_job(job.id)
        pending.next_attempt_at = pending.created_at
        return jobs.advance_job(jobs.claim_job(jobs.save_job(pending)))

    assert advance().creation.progress == "creating"
    assert advance().creation.progress == "saving"
    failed_save = advance()
    assert course_creation.creation_status(failed_save).result is None
    assert "private" not in failed_save.creation.error
    persist.side_effect = None
    completed = advance()
    assert completed.creation.status == "COMPLETED"
    assert completed.agent_name == "course-example"
    assert course_creation.creation_status(completed).result.agent_id == "course-example"
    generate.assert_called_once()
    memory.assert_called_once()
    create.assert_called_once()
    assert persist.call_count == 2


@pytest.fixture
def specification_response(monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest
    from utils import course_creation

    client = MagicMock()
    project = Mock()
    project.get_openai_client.return_value.with_options.return_value = client
    monkeypatch.setattr(course_creation, "get_creation_client", lambda: project)
    request = CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid="a" * 36,
        additionalContext="A synthetic introductory course.",
    )
    return request, client.__enter__.return_value.responses.create


def test_specification_generation_prevents_response_tools_from_replacing_json(specification_response):
    import json
    from utils import course_creation

    request, create = specification_response
    payload = {"description": "Example course", "instructions": "Teach the example course using its defined learning outcomes."}
    create.side_effect = lambda **kwargs: SimpleNamespace(
        status="completed",
        output_text=json.dumps(payload) if kwargs.get("tool_choice") == "none" else "",
    )
    result = course_creation.generate_specification(request)
    assert result.model_dump() == payload
    options = create.call_args.kwargs
    assert options["tool_choice"] == "none"
    assert options["store"] is False
    assert options["extra_body"]["agent_reference"]["type"] == "agent_reference"
    assert "agent" not in options["extra_body"]
    # Foundry rejects request-level text.format when a named agent is specified.
    assert "text" not in options
    assert "model" not in options
    assert "tools" not in options
    assert "synthetic introductory course" in options["input"]
    create.assert_called_once()


@pytest.mark.parametrize("status,payload", [
    ("incomplete", '{"description":"Example","instructions":"Otherwise valid course-specific instructions."}'),
    ("failed", '{"description":"Example","instructions":"Otherwise valid course-specific instructions."}'),
    ("completed", ""),
    ("completed", "private malformed response"),
    ("completed", '{"description":"Example","instructions":12}'),
    ("completed", '{"description":"Example","instructions":"short"}'),
    ("completed", '{"description":"Example","instructions":"Long enough instructions for the course.","unexpected":"private"}'),
])
def test_invalid_or_incomplete_specification_is_a_safe_retryable_failure(specification_response, status, payload, caplog):
    from utils import course_creation

    request, create = specification_response
    create.return_value = SimpleNamespace(status=status, output_text=payload)
    with pytest.raises(RuntimeError, match="specification") as failure:
        course_creation.generate_specification(request)
    assert "private" not in str(failure.value)
    assert "private" not in caplog.text
    create.assert_called_once()


def test_valid_fenced_specification_remains_supported(specification_response):
    from utils import course_creation

    request, create = specification_response
    create.return_value = SimpleNamespace(
        status="completed",
        output_text='```json\n{"description":"Example","instructions":"Course-specific instructions for the example."}\n```',
    )
    assert course_creation.generate_specification(request).description == "Example"


def test_invalid_specification_retries_are_bounded_and_keep_saved_memory(material_job_store, monkeypatch, specification_response):
    from utils import course_creation

    request, create = specification_response
    jobs, _documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda value, _owner: value)
    monkeypatch.setattr(course_creation, "find_owned_agent", lambda _job: None)
    memory = Mock(return_value="example-memory")
    monkeypatch.setattr(course_creation, "prepare_memory", memory)
    create.return_value = SimpleNamespace(status="completed", output_text="private malformed output")
    job = jobs.create_draft("teacher-1", "a" * 36)
    job = course_creation.start_creation(job, request.model_copy(update={"sessionUuid": job.session_uuid}))
    for attempt in range(4):
        job.next_attempt_at = job.created_at
        job = jobs.advance_job(jobs.claim_job(jobs.save_job(job)))
        assert job.creation.status == ("FAILED" if attempt == 3 else "PENDING")
        assert job.creation.specification is None
        assert job.creation.agent_create_started is False
    assert create.call_count == 4
    assert "specification" in job.creation.error
    assert "private" not in job.creation.error
    memory.assert_called_once()


def test_managed_file_list_and_removal_preserve_original(indexing, material_job_store, monkeypatch):
    from backend.schemas.course_materials import MaterialJobFile, MaterialPart
    from utils import material_uploads

    jobs, _documents, _container = material_job_store
    client = indexing[0]
    job = jobs.create_draft("teacher-1", "b" * 36)
    job.agent_name, job.progress, job.status = "course-example", "ready", "COMPLETED"
    source = material_uploads.inspect_material("notes.txt", b"example")
    filename = next(material_uploads.prepared_parts(b"example", source)).filename
    job.files = [MaterialJobFile(source=source, kb_scope="textbook", status="ready", parts=[MaterialPart(filename=filename, etag="part-etag")])]
    jobs.save_job(job)
    monkeypatch.setattr(course_materials, "load_setup", lambda _name: {"sessionUuid": job.session_uuid})
    container = Mock()
    container.list_blobs.return_value = [SimpleNamespace(name=f"sessions/{job.session_uuid}/textbook/{filename}", size=7)]
    monkeypatch.setattr(course_materials, "get_material_container", lambda: container)
    result = client.get("/api/agents/course-example/course-materials", params={"kb_scope": "textbook"})
    assert result.status_code == 200
    assert [item["filename"] for item in result.json()["files"]] == ["notes.txt"]
    assert "source_id=" in result.json()["files"][0]["download_url"]
    removal = client.delete("/api/agents/course-example/course-materials/file", params={"kb_scope": "textbook", "source_id": source.source_id})
    assert removal.status_code == 202
    monkeypatch.setattr(jobs, "renew_lease", lambda _job: None)
    remove_indexed = Mock()
    monkeypatch.setattr(jobs, "remove_indexed_part", remove_indexed)
    sealed = jobs.start_processing(jobs.load_job(job.id), [])
    removed = jobs.advance_job(jobs.claim_job(sealed))
    assert removed.files[0].status == "removed"
    remove_indexed.assert_called_once_with(job.session_uuid, "textbook", filename)
    container.get_blob_client.assert_called_once_with(f"sessions/{job.session_uuid}/textbook/{filename}")
    assert jobs.job_status(removed).files == []
    removed.progress = "ready"
    restored = jobs.store_upload(jobs.save_job(removed), "textbook", source, b"example")
    assert restored.files[0].status == "uploaded"
    assert restored.files[0].operation == "index"
    assert restored.files[0].parts == []
    assert restored.files[0].generation == 1


def test_uncertain_foundry_create_reconciles_without_second_version(material_job_store, monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest
    from utils import course_creation

    jobs, _documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    job = jobs.create_draft("teacher-1", "c" * 36)
    job = course_creation.start_creation(job, CourseCreationRequest(name="course-example", courseName="Example", sessionUuid=job.session_uuid))
    job.creation.agent_create_started = True
    job = jobs.save_job(job)
    client = Mock()
    monkeypatch.setattr(course_creation, "get_creation_client", lambda: client)
    client.agents.get.return_value = SimpleNamespace(versions=SimpleNamespace(latest=SimpleNamespace(version="1", metadata={"course_job_id": job.id})))
    assert course_creation.create_foundry_agent(job) == "1"
    client.agents.create_version.assert_not_called()
    client.agents.get.return_value.versions.latest.metadata = {"course_job_id": "other-job"}
    with pytest.raises(ValueError, match="unrelated"):
        course_creation.create_foundry_agent(job)
    from azure.core.exceptions import ResourceNotFoundError

    client.agents.get.side_effect = ResourceNotFoundError(message="not yet visible")
    with pytest.raises(RuntimeError, match="awaiting confirmation"):
        course_creation.create_foundry_agent(job)
    client.agents.create_version.assert_not_called()


def test_creation_failed_preparation_has_bounded_attempts(material_job_store, monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest
    from utils import course_creation

    jobs, _documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    monkeypatch.setattr(course_creation, "find_owned_agent", lambda _job: None)
    generate = Mock(side_effect=RuntimeError("temporary model failure"))
    monkeypatch.setattr(course_creation, "generate_specification", generate)
    memory = Mock(return_value="example-memory")
    monkeypatch.setattr(course_creation, "prepare_memory", memory)
    job = jobs.create_draft("teacher-1", "d" * 36)
    job = course_creation.start_creation(job, CourseCreationRequest(name="course-example", courseName="Example", sessionUuid=job.session_uuid))
    for _attempt in range(4):
        job.next_attempt_at = job.created_at
        job = jobs.advance_job(jobs.claim_job(jobs.save_job(job)))
    assert job.creation.status == "FAILED"
    assert generate.call_count == 4
    memory.assert_called_once()


def test_creation_status_distinguishes_unsubmitted_drafts_without_writes(indexing, material_job_store):
    from backend.routers import course_creation as creation_routes

    client = indexing[0]
    client.app.include_router(creation_routes.router)
    jobs, documents, container = material_job_store
    job = jobs.create_draft("teacher-1", "f" * 36)
    before = deepcopy(documents)
    response = client.get(f"/api/agents/creation-jobs/{job.id}")
    assert response.status_code == 200
    assert response.json()["status"] == "NOT_STARTED"
    assert response.json()["result"] is None
    assert client.post(f"/api/agents/creation-jobs/{job.id}/retry").status_code == 409
    assert documents == before
    container.replace_item.assert_not_called()


@pytest.mark.parametrize("creation_state", ["PENDING", "RUNNING", "FAILED"])
@pytest.mark.parametrize("parent_state", ["FAILED", "COMPLETED"])
def test_terminal_parent_creation_can_resume_preserving_saved_checkpoints(material_job_store, monkeypatch, creation_state, parent_state):
    from backend.schemas.course_creation import CourseCreationRequest, CourseSpecification
    from utils import course_creation

    jobs, _documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    job = jobs.create_draft("teacher-1", "e" * 36)
    job = course_creation.start_creation(job, CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid=job.session_uuid,
    ))
    job.status = parent_state
    job.creation.status = creation_state
    job.creation.progress = "creating"
    job.creation.agent_create_started = True
    job.creation.specification = CourseSpecification(
        description="Example", instructions="Saved instructions for the example course.",
    )
    job.creation.memory_store_name = "saved-memory"
    job = jobs.save_job(job)
    before = job.model_copy(deep=True)

    status = course_creation.creation_status(job)
    assert status.status == "FAILED"
    assert status.course_name == "Example"
    assert status.error
    assert status.result is None
    resumed = course_creation.retry_creation(job)
    assert resumed.status == resumed.creation.status == "PENDING"
    assert resumed.creation.progress == before.creation.progress
    assert resumed.creation.agent_create_started
    assert resumed.creation.specification == before.creation.specification
    assert resumed.creation.memory_store_name == before.creation.memory_store_name
    assert resumed.creation.manage_code == before.creation.manage_code
    assert resumed.creation.request == before.creation.request
    assert resumed.session_uuid == before.session_uuid


def test_creation_retry_never_takes_over_an_active_lease(material_job_store, monkeypatch):
    from datetime import datetime, timezone
    from backend.schemas.course_creation import CourseCreationRequest
    from utils import course_creation

    jobs, documents, container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    job = jobs.create_draft("teacher-1", "f" * 36)
    job = course_creation.start_creation(job, CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid=job.session_uuid,
    ))
    job.creation.status = "FAILED"
    job.lease_owner = "active-worker"
    job.lease_until = datetime.now(timezone.utc) + timedelta(minutes=1)
    job = jobs.save_job(job)
    before = deepcopy(documents)
    container.replace_item.reset_mock()
    with pytest.raises(ValueError, match="processing"):
        course_creation.retry_creation(job)
    container.replace_item.assert_not_called()
    assert documents == before


def test_created_ta_reports_stopped_materials_without_claiming_processing(material_job_store, monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest, CourseSpecification
    from utils import course_creation

    jobs, _documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    job = jobs.create_draft("teacher-1", "a" * 36)
    job = course_creation.start_creation(job, CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid=job.session_uuid,
    ))
    job.creation.status, job.creation.progress = "COMPLETED", "created"
    job.creation.specification = CourseSpecification(
        description="Example", instructions="Saved instructions for the example course.",
    )
    job.status, job.progress = "FAILED", "indexing"
    status = course_creation.creation_status(job)
    assert status.status == "COMPLETED"
    assert status.materials_status == status.result.materials_status == "failed"
    assert status.result.knowledge_pending
    assert course_creation.retry_creation(job).creation.status == "COMPLETED"


def test_failed_material_job_exposes_stalled_files_and_retries_without_losing_ready_files(material_job_store):
    from backend.schemas.course_materials import MaterialJobFile, MaterialPart
    from utils import material_uploads

    jobs, _documents, _container = material_job_store
    job = jobs.create_draft("teacher-1", "d" * 36)
    job.files = [
        MaterialJobFile(
            source=material_uploads.inspect_material(name, b"example"), kb_scope="course", status=state,
            parts=[MaterialPart(filename=name + ".html", etag="original-copy")],
        ) for name, state in [("ready.md", "ready"), ("stalled.md", "indexing")]
    ]
    job.status, job.progress = "FAILED", "indexing"
    job = jobs.save_job(job)
    before = job.model_copy(deep=True)
    status = jobs.job_status(job)
    assert status.progress == "failed"
    assert [file.status for file in status.files] == ["ready", "failed"]
    assert status.files[1].error
    assert job == before

    resumed = jobs.start_processing(job, [job.files[1].source.source_id])
    assert resumed.status == "PENDING"
    assert resumed.progress == "preparing"
    assert resumed.files[0] == before.files[0]
    assert resumed.files[1].status == "uploaded"
    assert resumed.files[1].source == before.files[1].source
    assert resumed.files[1].parts == before.files[1].parts
    assert resumed.files[1].generation == 1


def test_empty_material_retry_does_not_stop_pending_creation(material_job_store, monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest
    from utils import course_creation

    jobs, _documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    job = jobs.create_draft("teacher-1", "c" * 36)
    job = course_creation.start_creation(job, CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid=job.session_uuid,
    ))
    resumed = jobs.start_processing(job, [])
    assert resumed.status == "PENDING"
    assert resumed.creation.status == "PENDING"
    assert jobs.claim_job(resumed) is not None


def test_exhausted_worker_failure_marks_pending_creation_failed(material_job_store, monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest
    from utils import course_creation

    jobs, _documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    job = jobs.create_draft("teacher-1", "b" * 36)
    job = course_creation.start_creation(job, CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid=job.session_uuid,
    ))
    job.failures = 3
    job = jobs.save_job(job)
    monkeypatch.setattr(course_creation, "advance_creation", Mock(side_effect=RuntimeError("private checkpoint failure")))
    failed = jobs.advance_job(jobs.claim_job(job))
    assert failed.status == failed.creation.status == "FAILED"
    assert failed.creation.error
    assert "private" not in failed.creation.error
    assert failed.lease_owner is None


def test_text_indexing_copies_are_supported_escaped_and_complete():
    from html import unescape
    from utils import material_uploads

    original = ("Example <script>not executable</script> & notes\n" * 2000).encode()
    report = material_uploads.inspect_material("notes.md", original)
    parts = list(material_uploads.prepared_parts(original, report))
    recovered = "".join(unescape(part.content.decode().split("<pre>", 1)[1].split("</pre>", 1)[0]) for part in parts)
    assert recovered == original.decode()
    assert all(part.filename.endswith(".html") for part in parts)
    assert all(material_uploads.COPY_PATTERN.fullmatch(part.filename) for part in parts)
    assert all(b"<script>" not in part.content and len(part.content) <= material_uploads.INDEX_PART_BYTES for part in parts)


def test_curriculum_is_queued_once_and_recovers_completed_output(material_job_store, monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest, CreationTextbook, CurriculumResearchJob
    from utils import course_creation
    from backend import main

    jobs, documents, _container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    job = jobs.create_draft("teacher-1", "e" * 36)
    job = course_creation.start_creation(job, CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid=job.session_uuid,
        textbooks=[CreationTextbook(name="Example handbook")],
    ))
    course_creation.enqueue_curriculum(job)
    course_creation.enqueue_curriculum(job)
    records = [document for document in documents.values() if document["job_type"] == "course_curriculum"]
    assert len(records) == 1
    research = CurriculumResearchJob.model_validate(records[0])
    assert course_creation.load_curriculum_research("course-example", "unrelated-session").id == research.id
    monkeypatch.setattr(course_creation, "curriculum_is_complete", lambda _name: True)
    generate = Mock()
    monkeypatch.setattr(main, "_background_textbook_research", generate)
    course_creation.run_curriculum_research(research)
    generate.assert_not_called()


def test_automatic_curriculum_enqueue_reuses_manual_retry_job(curriculum_retry_api, monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest, CreationTextbook
    from utils import course_creation

    client, _course, _plan, (jobs, documents, _container) = curriculum_retry_api
    client.post("/api/agents/course-example/course-curriculum/retry", json={})
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    draft = jobs.create_draft("teacher-1", "c" * 36)
    draft = course_creation.start_creation(draft, CourseCreationRequest(
        name="course-example", courseName="Example", sessionUuid=draft.session_uuid,
        textbooks=[CreationTextbook(name="Example handbook")],
    ))
    course_creation.enqueue_curriculum(draft)
    assert sum(record["job_type"] == "course_curriculum" for record in documents.values()) == 1


@pytest.mark.parametrize("job_state,plan,expected,retry", [
    (None, None, "not_available", True),
    ("PENDING", None, "processing", False),
    ("RUNNING", {"syllabus": [{}], "_error": "earlier failure"}, "processing", False),
    ("FAILED", {"syllabus": [{}], "_status": "syllabus_ready"}, "failed", True),
    (None, {"syllabus": [{}], "_status": "syllabus_ready"}, "failed", True),
    ("COMPLETED", None, "failed", True),
    (None, {"syllabus": [{}], "all_threshold_concepts": ["Example"]}, "ready", False),
])
def test_curriculum_status_uses_live_job_instead_of_partial_artifact(job_state, plan, expected, retry):
    from datetime import datetime, timezone
    from backend.schemas.course_creation import CurriculumResearchJob
    from utils import course_creation

    research = CurriculumResearchJob(
        id="curriculum-" + "a" * 36, agent_name="course-example", owner_id="teacher-1",
        source_job_id="materials-" + "a" * 36, status=job_state, next_attempt_at=datetime.now(timezone.utc),
    ) if job_state else None
    result = course_creation.curriculum_status("course-example", plan, research, can_edit=True, status_only=True)
    assert result.status == expected
    assert result.can_retry is retry
    assert result.course_curriculum is None
    assert course_creation.curriculum_status("course-example", plan, research).can_retry is False


def test_known_legacy_curriculum_generation_does_not_offer_retry():
    from utils import course_creation

    result = course_creation.curriculum_status("course-example", None, None, can_edit=True, legacy_running=True)
    assert result.status == "processing"
    assert result.can_retry is False


@pytest.fixture
def curriculum_retry_api(indexing, material_job_store, monkeypatch):
    from backend.routers import course_creation as creation_routes
    from utils import course_creation

    client, course, _files, _save = indexing
    client.app.include_router(creation_routes.router)
    plan = {"value": None}
    monkeypatch.setattr(course_creation, "load_curriculum_snapshot", lambda _name: deepcopy(plan["value"]))
    monkeypatch.setattr(course_materials, "load_setup", lambda _name: {
        "sessionUuid": "example-session", "courseName": "Example course", "additionalContext": "Saved learning outcomes.",
        "textbooks": [{"id": "saved-book", "name": "Example handbook", "edition": "1", "type": "primary", "authors": []}],
    })
    return client, course, plan, material_job_store


def test_curriculum_retry_is_durable_and_duplicate_requests_do_not_restart(curriculum_retry_api):
    from utils import course_creation

    client, _course, plan, (_jobs, documents, container) = curriculum_retry_api
    address = "/api/agents/course-example/course-curriculum"
    assert client.get(address).json()["can_retry"] is True
    first = client.post(address + "/retry", json={})
    assert first.status_code == 202
    assert first.json()["status"] == "processing"
    assert first.json()["can_retry"] is False
    assert len(documents) == 1
    record = next(iter(documents.values()))
    assert record["inputs"]["course_name"] == "Example course"
    assert record["inputs"]["textbooks"][0]["name"] == "Example handbook"
    plan["value"] = {"syllabus": [{}], "_status": "syllabus_ready", "_error": "old private error"}
    for state in ("PENDING", "RUNNING"):
        record["status"] = state
        response = client.post(address + "/retry", json={})
        assert response.json()["status"] == "processing"
        assert response.json()["can_retry"] is False
    container.create_item.assert_called_once()
    container.replace_item.assert_not_called()
    assert "old private error" not in client.get(address).text
    assert course_creation.load_curriculum_research("course-example", "example-session").status == "RUNNING"


def test_failed_curriculum_retry_reuses_job_and_preserves_partial_output(curriculum_retry_api):
    client, _course, plan, (_jobs, documents, container) = curriculum_retry_api
    address = "/api/agents/course-example/course-curriculum"
    client.post(address + "/retry", json={})
    record = next(iter(documents.values()))
    record.update(status="FAILED", attempts=2, error="Generation failed")
    plan["value"] = {"syllabus": [{"title": "Partial module"}], "_status": "syllabus_ready", "_error": "private model error"}
    assert client.get(address).json()["status"] == "failed"
    assert client.get(address).json()["can_retry"] is True
    result = client.post(address + "/retry", json={})
    assert result.json()["status"] == "processing"
    assert len(documents) == 1
    assert next(iter(documents.values()))["attempts"] == 0
    assert plan["value"]["syllabus"] == [{"title": "Partial module"}]
    container.replace_item.assert_called_once()


def test_curriculum_retry_requires_active_course_edit_access(curriculum_retry_api):
    client, _course, _plan, (_jobs, _documents, container) = curriculum_retry_api
    address = "/api/agents/course-example/course-curriculum"
    client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="student-1", role="student", status="active")
    assert client.get(address).json()["can_retry"] is False
    assert client.post(address + "/retry", json={}).status_code == 403
    client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="outsider", role="teacher", status="active")
    assert client.post(address + "/retry", json={}).status_code == 403
    client.app.dependency_overrides.clear()
    assert client.post(address + "/retry", json={}).status_code == 401
    container.create_item.assert_not_called()


def test_curriculum_worker_can_run_saved_inputs_for_an_older_ta(curriculum_retry_api, monkeypatch):
    from backend import main
    from utils import course_creation

    client, _course, _plan, _store = curriculum_retry_api
    client.post("/api/agents/course-example/course-curriculum/retry", json={})
    job = course_creation.load_curriculum_research("course-example", "example-session")
    monkeypatch.setattr(course_creation, "curriculum_is_complete", Mock(side_effect=[False, True]))
    generate = Mock()
    monkeypatch.setattr(main, "_background_textbook_research", generate)
    course_creation.run_curriculum_research(job)
    generate.assert_called_once()
    assert generate.call_args.kwargs["additional_context"] == "Saved learning outcomes."


@pytest.mark.parametrize("operation", ["create", "replace"])
def test_concurrent_curriculum_retries_keep_the_winning_job(curriculum_retry_api, monkeypatch, operation):
    from utils import course_creation

    client, _course, _plan, (_jobs, documents, container) = curriculum_retry_api
    address = "/api/agents/course-example/course-curriculum"
    client.post(address + "/retry", json={})
    record = next(iter(documents.values()))
    if operation == "replace":
        record["status"] = "FAILED"
        stale = course_creation.load_curriculum_research("course-example", "example-session")
    else:
        stale = None
    record.update(status="RUNNING", attempts=1, _etag="2", lease_owner="winning-worker")
    current = course_creation.load_curriculum_research("course-example", "example-session")
    monkeypatch.setattr(course_creation, "load_curriculum_research", Mock(side_effect=[stale, current]))
    result = client.post(address + "/retry", json={})
    assert result.status_code == 202
    assert result.json()["status"] == "processing"
    assert result.json()["can_retry"] is False
    assert len(documents) == 1
    assert next(iter(documents.values()))["lease_owner"] == "winning-worker"


def test_curriculum_status_does_not_hide_an_active_older_session_job(curriculum_retry_api):
    from utils import course_creation

    client, _course, _plan, (_jobs, documents, _container) = curriculum_retry_api
    client.post("/api/agents/course-example/course-curriculum/retry", json={})
    canonical = next(iter(documents.values()))
    canonical["status"] = "FAILED"
    session = "a" * 36
    identity = f"curriculum-{session}"
    documents[identity] = {**deepcopy(canonical), "id": identity, "status": "RUNNING"}
    assert course_creation.load_curriculum_research("course-example", session).id == identity


def test_curriculum_read_errors_never_queue_a_replacement(curriculum_retry_api, monkeypatch):
    from utils import course_creation

    client, _course, _plan, (_jobs, documents, _container) = curriculum_retry_api
    monkeypatch.setattr(course_creation, "load_curriculum_snapshot", Mock(side_effect=RuntimeError("private storage detail")))
    address = "/api/agents/course-example/course-curriculum"
    for response in [client.get(address), client.post(address + "/retry", json={})]:
        assert response.status_code == 503
        assert "private storage" not in response.text
    assert documents == {}


def test_legacy_curriculum_retry_endpoints_share_active_job_guard(curriculum_retry_api):
    client, _course, _plan, (_jobs, documents, container) = curriculum_retry_api
    first = client.post("/api/agents/course-example/retry-textbook-research")
    assert first.status_code == 202
    second = client.post("/api/agents/course-example/retry-threshold-research")
    assert second.status_code == 202
    assert second.json()["status"] == "processing"
    assert len(documents) == 1
    container.replace_item.assert_not_called()


def test_creation_seals_batch_with_one_conditional_write(material_job_store, monkeypatch):
    from backend.schemas.course_creation import CourseCreationRequest
    from utils import course_creation

    jobs, _documents, container = material_job_store
    monkeypatch.setattr(course_creation, "normalize_request", lambda request, _owner: request)
    job = jobs.create_draft("teacher-1", "f" * 36)
    started = course_creation.start_creation(job, CourseCreationRequest(name="course-example", courseName="Example", sessionUuid=job.session_uuid))
    assert started.creation.status == "PENDING"
    assert started.progress == "ready"
    container.replace_item.assert_called_once()


def test_replacement_workflow_routes_are_unique_and_neighboring_chat_routes_remain():
    from backend import main

    for method, path in [
        ("POST", "/api/knowledge/build"), ("POST", "/api/agents/create-async"),
        ("GET", "/api/agents/{agent_name}/course-curriculum"),
        ("POST", "/api/agents/{agent_name}/course-curriculum/retry"),
        ("POST", "/api/agents/{agent_name}/retry-textbook-research"),
        ("POST", "/api/agents/{agent_name}/retry-threshold-research"),
        ("POST", "/api/chat/thread/{thread_id}/share"), ("DELETE", "/api/chat/thread/{thread_id}/share"),
        ("PUT", "/api/chat/thread/{thread_id}"), ("DELETE", "/api/chat/thread/{thread_id}"),
    ]:
        routes_found = [route for route in main.app.routes if getattr(route, "path", None) == path and method in getattr(route, "methods", set())]
        assert len(routes_found) == 1, (method, path)
        assert not routes_found[0].endpoint.__name__.startswith("_legacy_")


def test_two_passages_from_one_file_have_distinct_stable_citations(passages):
    client, document, index = passages
    second = {**document, "content_id": "chunk-2", "content_text": "Another exact passage."}
    client.search.return_value = [document, second, document]
    first = course_materials.retrieve_course_passages("course-example", "example-session", "Read the file", index)
    again = course_materials.retrieve_course_passages("course-example", "example-session", "Read the file", index)
    assert len(first) == 2
    assert first[0].url == first[1].url
    assert first[0].citation_id != first[1].citation_id
    assert first == again


@pytest.mark.parametrize("field,value", [
    ("session_id", "other-session"),
    ("content_path", "https://other.blob.core.windows.net/materials/sessions/example-session/course/notes.pdf"),
    ("content_path", "https://example.blob.core.windows.net/materials/sessions/other-session/course/notes.pdf"),
    ("content_path", "https://example.blob.core.windows.net/old-materials/sessions/example-session/course/notes.pdf"),
    ("document_title", "another.pdf"),
    ("content_text", ""),
])
def test_unverified_passage_identity_is_rejected(passages, field, value):
    _client, document, index = passages
    document[field] = value
    with pytest.raises(ValueError):
        course_materials.retrieve_course_passages("course-example", "example-session", "Read the file", index)


def test_excerpt_is_bounded_without_inventing_page_or_section(passages):
    _client, document, index = passages
    document.update(content_text="a" * 8000, page_number=None, logical_section=None)
    source = course_materials.retrieve_course_passages("course-example", "example-session", "Read the file", index)[0]
    assert len(source.excerpt) == 4000
    assert source.truncated
    assert source.page_number is None
    assert source.section is None


def test_missing_scope_or_wrong_index_is_rejected(passages):
    client, _document, index = passages
    for change in ({"filter": None}, {"index_name": "other-index"}):
        with pytest.raises(ValueError):
            course_materials.retrieve_course_passages("course-example", "example-session", "Read the file", {**index, **change})
    client.search.assert_not_called()


def test_file_download_checks_membership_and_uses_saved_session(indexing, monkeypatch):
    client = indexing[0]
    client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="student-1", role="student", status="active")
    container = Mock()
    container.get_blob_client.return_value.download_blob.return_value.chunks.return_value = iter([b"example file"])
    monkeypatch.setattr(course_materials, "get_material_container", lambda: container)
    result = client.get("/api/agents/course-example/course-materials/file", params={"filename": "notes.pdf"})
    assert result.status_code == 200
    assert result.content == b"example file"
    assert result.headers["cache-control"] == "private, no-store"
    container.get_blob_client.assert_called_once_with("sessions/example-session/course/notes.pdf")


def test_file_download_rejects_non_member_and_path_traversal(indexing, monkeypatch):
    client = indexing[0]
    container = Mock()
    monkeypatch.setattr(course_materials, "get_material_container", lambda: container)
    for filename in ("../other.pdf", "..", "folder\\notes.pdf"):
        assert client.get("/api/agents/course-example/course-materials/file", params={"filename": filename}).status_code in (400, 422)
    client.app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="outsider", role="student", status="active")
    assert client.get("/api/agents/course-example/course-materials/file", params={"filename": "notes.pdf"}).status_code == 403
    container.get_blob_client.assert_not_called()


def test_editing_files_does_not_reconfigure_shared_search_resources(indexing, monkeypatch):
    ensure = Mock()
    monkeypatch.setattr(course_index_manager, "ensure_common_index_pipeline", ensure)
    assert start(indexing[0]).status_code == 202
    ensure.assert_not_called()


def test_malformed_course_membership_fails_closed(indexing):
    client, course, _files, save = indexing
    course["createdById"] = "another-owner"
    course["teacherIds"] = "teacher-10"
    assert start(client).status_code == 503
    save.assert_not_called()


def test_index_state_updates_use_etag_without_replacing_course_metadata(indexing, monkeypatch):
    from azure.core import MatchConditions
    from azure_services.persistence import cosmos_db

    start(indexing[0])
    course = indexing[1]
    operation = IndexingOperation.model_validate(course["materialIndexing"])
    container = Mock()
    monkeypatch.setattr(cosmos_db, "_get_agents_container", lambda: container)
    persist_operation(course, operation)
    container.patch_item.assert_called_once_with(
        item="course-example", partition_key="course-example",
        patch_operations=[{
            "op": "set", "path": "/materialIndexing", "value": operation.model_dump(mode="json"),
        }],
        etag="revision-1", match_condition=MatchConditions.IfNotModified,
    )
    container.upsert_item.assert_not_called()


def test_material_snapshot_rejects_missing_blob_version(monkeypatch):
    container = Mock()
    container.list_blobs.return_value = [SimpleNamespace(name="sessions/example-session/course/notes.pdf", etag=None)]
    monkeypatch.setattr(course_materials, "get_material_container", lambda: container)
    with pytest.raises(ValueError):
        course_materials.list_material_files("example-session", "course")


@pytest.mark.parametrize("fallback", [False, True])
def test_indexer_access_tokens_are_never_logged(monkeypatch, caplog, fallback):
    import azure.identity
    import common_azure_auth

    token = "synthetic-token-must-not-appear-in-logs"
    getter = Mock(side_effect=ImportError() if fallback else None, return_value=token)
    monkeypatch.setattr(common_azure_auth, "get_token_with_retry", getter)
    credential = Mock()
    credential.get_token.return_value = SimpleNamespace(token=token)
    monkeypatch.setattr(azure.identity, "DefaultAzureCredential", Mock(return_value=credential))
    caplog.set_level("INFO")
    assert course_index_manager._get_access_token() == token
    assert token not in caplog.text