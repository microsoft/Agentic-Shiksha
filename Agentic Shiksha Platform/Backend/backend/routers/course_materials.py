import asyncio
import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import PurePosixPath
from typing import Annotated
from urllib.parse import quote, urlencode

from azure.core.exceptions import HttpResponseError, ResourceNotFoundError
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.dependencies.agent_access import check_agent_access
from backend.core.research import get_research_workers
from backend.schemas.course_materials import (
    CourseAccessRecord, CourseFileItem, CourseFileList, CourseIndexRequest, CourseIndexStatus, CourseMaterialScope,
    IndexingOperation, MaterialDraftRequest, MaterialJobRequest, MaterialJobStatus,
    MaterialPreflightResponse, MaterialPreflightResult, MaterialScope, MaterialUploadRequest,
)
from utils import course_materials, material_jobs, material_uploads


logger = logging.getLogger(__name__)
CurrentUser = Annotated[ActiveUser, Depends(get_current_active_user)]


@asynccontextmanager
async def materials_lifespan(app: FastAPI):
    from utils.course_creation import close_creation_client, get_creation_client, run_curriculum_worker

    course_materials.get_search_client()
    get_creation_client()
    stop = asyncio.Event()
    worker = asyncio.create_task(material_jobs.run_worker(stop))
    curriculum_worker = asyncio.create_task(run_curriculum_worker(stop))
    try:
        yield
    finally:
        stop.set()
        get_research_workers().shutdown_event.set()
        await worker
        await curriculum_worker
        close_creation_client()
        course_materials.close_search_client()


router = APIRouter(prefix="/api", tags=["Course materials"], lifespan=materials_lifespan)


def require_teacher(user: ActiveUser) -> None:
    if user.role == "student":
        raise HTTPException(status_code=403, detail="Teacher access required")


def require_material_job(job_id: str, user: ActiveUser):
    require_teacher(user)
    job = material_jobs.load_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Material batch not found")
    if job.agent_name:
        _course, session = require_course(job.agent_name, user, edit=True)
        if session != job.session_uuid:
            raise HTTPException(status_code=409, detail="Course material session changed")
    elif job.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Material batch access required")
    return job


def material_request_error(error: Exception) -> HTTPException:
    if isinstance(error, material_uploads.MaterialRejected):
        return HTTPException(status_code=422, detail=str(error))
    if isinstance(error, ValueError) or (isinstance(error, HttpResponseError) and error.status_code == 412):
        return HTTPException(status_code=409, detail="Material batch changed or is processing. Reload its status and retry.")
    logger.warning("Material request failed (%s)", type(error).__name__)
    return HTTPException(status_code=503, detail="Course materials could not be saved. Please retry.")


def upload_limits(files: list[UploadFile]) -> None:
    if not 1 <= len(files) <= material_uploads.MAX_FILES:
        raise material_uploads.MaterialRejected("Select between 1 and 100 files per batch.")
    size = 0
    for upload in files:
        upload.file.seek(0, 2)
        size += upload.file.tell()
        upload.file.seek(0)
    if size > material_uploads.MAX_BATCH_BYTES:
        raise material_uploads.MaterialRejected("A batch must not exceed 250 MiB.")


@router.post("/knowledge/preflight", response_model=MaterialPreflightResponse)
def preflight_materials(files: Annotated[list[UploadFile], File()], user: CurrentUser):
    require_teacher(user)
    try:
        upload_limits(files)
        results = []
        for upload in files:
            try:
                report = material_uploads.inspect_material(upload.filename or "", upload.file.read(material_uploads.MAX_FILE_BYTES + 1))
                results.append(MaterialPreflightResult(filename=report.filename, accepted=True, details=report))
            except material_uploads.MaterialRejected as error:
                results.append(MaterialPreflightResult(filename=(upload.filename or "")[:255], accepted=False, error=str(error)))
        return MaterialPreflightResponse(
            accepted=all(result.accepted for result in results),
            max_file_bytes=material_uploads.MAX_FILE_BYTES, max_batch_bytes=material_uploads.MAX_BATCH_BYTES,
            max_files=material_uploads.MAX_FILES, max_pdf_pages=material_uploads.MAX_PDF_PAGES,
            index_part_bytes=material_uploads.INDEX_PART_BYTES, index_part_pages=material_uploads.INDEX_PART_PAGES,
            extensions=sorted(material_uploads.EXTENSIONS), files=results,
        )
    except Exception as error:
        raise material_request_error(error) from None


@router.post("/knowledge/drafts", response_model=MaterialJobStatus)
def create_material_draft(body: MaterialDraftRequest, user: CurrentUser):
    require_teacher(user)
    try:
        return material_jobs.job_status(material_jobs.create_draft(user.id, body.request_id))
    except Exception as error:
        raise material_request_error(error) from None


@router.post("/knowledge/build", response_model=MaterialJobStatus, status_code=202)
def knowledge_build(body: Annotated[MaterialUploadRequest, Form()], user: CurrentUser):
    require_teacher(user)
    try:
        if body.agent_name:
            _course, session = require_course(body.agent_name, user, edit=True)
            if session != body.session:
                raise HTTPException(status_code=409, detail="Course material session changed")
            job = material_jobs.ensure_edit_job(session, body.agent_name, user.id)
        else:
            job = require_material_job(f"materials-{body.session}", user)
        upload_limits(body.files)
        for upload in body.files:
            content = upload.file.read(material_uploads.MAX_FILE_BYTES + 1)
            report = material_uploads.inspect_material(upload.filename or "", content)
            job = material_jobs.store_upload(job, body.kb_scope, report, content)
        return material_jobs.job_status(job)
    except HTTPException:
        raise
    except Exception as error:
        raise material_request_error(error) from None


@router.get("/knowledge/jobs/{job_id}", response_model=MaterialJobStatus)
def material_job_status(job_id: str, user: CurrentUser):
    try:
        return material_jobs.job_status(require_material_job(job_id, user))
    except HTTPException:
        raise
    except Exception as error:
        raise material_request_error(error) from None


@router.post("/knowledge/jobs/{job_id}/process", response_model=MaterialJobStatus, status_code=202)
def process_material_job(job_id: str, body: MaterialJobRequest, user: CurrentUser):
    try:
        job = require_material_job(job_id, user)
        return material_jobs.job_status(material_jobs.start_processing(job, body.source_ids))
    except HTTPException:
        raise
    except Exception as error:
        raise material_request_error(error) from None


@router.get("/knowledge/jobs/{job_id}/events", response_class=StreamingResponse)
async def material_job_events(job_id: str, request: Request, user: CurrentUser):
    await asyncio.to_thread(require_material_job, job_id, user)

    async def events():
        for _attempt in range(600):
            if await request.is_disconnected():
                return
            status = await asyncio.to_thread(material_job_status, job_id, user)
            yield f"event: status\ndata: {status.model_dump_json()}\n\n"
            if status.status in {"COMPLETED", "FAILED"}:
                return
            await asyncio.sleep(2)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})


def require_course(agent_name: str, user: ActiveUser, *, edit: bool = False) -> tuple[dict, str]:
    course = course_materials.load_course(agent_name)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    record = CourseAccessRecord.model_validate(course)
    if record.id != agent_name:
        raise HTTPException(status_code=403, detail="Course access required")
    if edit and user.role == "student":
        raise HTTPException(status_code=403, detail="Course access required")
    check_agent_access(course, user)
    setup = CourseMaterialScope.model_validate(course_materials.load_setup(agent_name))
    return course, setup.session_uuid


def indexing_error(error: Exception) -> HTTPException:
    if isinstance(error, HttpResponseError) and error.status_code == 412:
        return HTTPException(status_code=409, detail="Course changed. Retry indexing.")
    logger.warning("Course indexing request failed (%s)", type(error).__name__)
    return HTTPException(status_code=503, detail="Course indexing could not be started. Please retry.")


@router.get("/agents/{agent_name}/course-materials", response_model=CourseFileList)
def list_course_materials(agent_name: str, user: CurrentUser, kb_scope: MaterialScope = "course"):
    try:
        _course, session = require_course(agent_name, user, edit=True)
        job = material_jobs.load_job(f"materials-{session}")
        items = []
        known_copies = set()
        if job:
            if job.agent_name != agent_name:
                raise HTTPException(status_code=409, detail="Course material session changed")
            for entry in job.files:
                known_copies.update(part.filename for part in entry.parts)
                if entry.kb_scope != kb_scope or entry.operation == "remove":
                    continue
                params = {"filename": entry.source.filename, "kb_scope": kb_scope, "source_id": entry.source.source_id}
                items.append(CourseFileItem(
                    filename=entry.source.filename, kind=PurePosixPath(entry.source.stored_filename).suffix.lstrip("."),
                    size=entry.source.size_bytes, source_id=entry.source.source_id,
                    download_url=f"/api/agents/{quote(agent_name, safe='')}/course-materials/file?{urlencode(params)}",
                ))
        prefix = f"sessions/{session}/{kb_scope}/"
        for blob in course_materials.get_material_container().list_blobs(name_starts_with=prefix):
            filename = blob.name[len(prefix):]
            if filename in known_copies or material_uploads.PART_PATTERN.fullmatch(filename) or material_uploads.COPY_PATTERN.fullmatch(filename):
                continue
            if "/" in filename or "\\" in filename or filename in {".", ".."}:
                continue
            items.append(CourseFileItem(
                filename=filename, kind=PurePosixPath(filename).suffix.lstrip("."), size=blob.size,
                download_url=f"/api/agents/{quote(agent_name, safe='')}/course-materials/file?{urlencode({'filename': filename, 'kb_scope': kb_scope})}",
            ))
            if len(items) > 500:
                raise ValueError("Too many materials")
        return CourseFileList(files=items)
    except HTTPException:
        raise
    except Exception as error:
        raise material_request_error(error) from None


@router.delete("/agents/{agent_name}/course-materials/file", response_model=MaterialJobStatus, status_code=202)
def remove_course_material(
    agent_name: str, source_id: Annotated[str, Query(pattern=r"^[a-f0-9]{32}$")],
    user: CurrentUser, kb_scope: MaterialScope = "course",
):
    try:
        _course, session = require_course(agent_name, user, edit=True)
        job = require_material_job(f"materials-{session}", user)
        return material_jobs.job_status(material_jobs.remove_material(job, source_id, kb_scope))
    except HTTPException:
        raise
    except Exception as error:
        raise material_request_error(error) from None


@router.post("/knowledge/update-index", response_model=CourseIndexStatus, status_code=202)
def update_course_index(body: Annotated[CourseIndexRequest, Form()], user: CurrentUser):
    from azure_services.tools.search.course_index_manager import get_common_indexer_status, run_common_indexer

    try:
        course, session = require_course(body.agent_name, user, edit=True)
        if session != body.session_uuid:
            raise HTTPException(status_code=409, detail="Course material session changed. Reload the course.")
        operation = course_materials.new_operation(session, body.kb_scope)
        course_materials.save_operation(course, operation)
        if "error" in get_common_indexer_status():
            raise RuntimeError("Index pipeline is unavailable")
        accepted, _result = run_common_indexer()
        if not accepted:
            raise RuntimeError("Indexer did not accept the run")
        return course_materials.operation_status(operation)
    except HTTPException:
        raise
    except Exception as error:
        raise indexing_error(error) from None


@router.get("/knowledge/index-status", response_model=CourseIndexStatus)
def get_index_status(
    agent_name: Annotated[str, Query(min_length=1, max_length=160)],
    operation_id: Annotated[str, Query(pattern=r"^[a-f0-9]{32}$")],
    user: CurrentUser,
):
    try:
        course, session = require_course(agent_name, user, edit=True)
        stored = course.get("materialIndexing")
        if not stored:
            raise HTTPException(status_code=404, detail="Indexing request not found")
        operation = IndexingOperation.model_validate(stored)
        if operation.id != operation_id or operation.session_uuid != session:
            raise HTTPException(status_code=409, detail="Indexing request changed. Reload the course.")
        previous_state = operation.state
        result = course_materials.check_operation(operation)
        if operation.state != previous_state:
            course_materials.save_operation(course, operation)
        return result
    except HTTPException:
        raise
    except Exception as error:
        if isinstance(error, HttpResponseError) and error.status_code == 412:
            raise HTTPException(status_code=409, detail="Course changed. Retry indexing.") from None
        logger.warning("Course indexing status failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Indexing status could not be checked. Please retry.") from None


@router.get("/agents/{agent_name}/course-materials/file", response_class=StreamingResponse)
def download_material(
    agent_name: str,
    filename: Annotated[str, Query(min_length=1, max_length=255, pattern=r"^[^/\\\x00-\x1f]+$")],
    user: CurrentUser,
    kb_scope: MaterialScope = "course",
    source_id: Annotated[str | None, Query(pattern=r"^[a-f0-9]{32}$")] = None,
):
    try:
        _course, session = require_course(agent_name, user)
        if filename in {".", ".."}:
            raise HTTPException(status_code=400, detail="Invalid filename")
        blob_path = f"sessions/{session}/{kb_scope}/{filename}"
        if source_id:
            job = material_jobs.load_job(f"materials-{session}")
            if job is None or job.agent_name != agent_name:
                raise HTTPException(status_code=404, detail="Course file not found")
            entry = next((entry for entry in job.files if entry.kb_scope == kb_scope and entry.source.source_id == source_id and entry.source.filename == filename), None)
            if entry is None:
                raise HTTPException(status_code=404, detail="Course file not found")
            blob_path = material_jobs.original_blob_path(job, entry)
        blob = course_materials.get_material_container().get_blob_client(blob_path)
        download = blob.download_blob()
        return StreamingResponse(
            download.chunks(), media_type=mimetypes.guess_type(filename)[0] or "application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
                "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
            },
        )
    except HTTPException:
        raise
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Course file not found") from None
    except Exception as error:
        logger.warning("Course file download failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Course file could not be opened. Please retry.") from None