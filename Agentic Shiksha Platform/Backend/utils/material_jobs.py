import asyncio
import base64
import hashlib
import logging
import mimetypes
from datetime import datetime, timedelta, timezone
from uuid import NAMESPACE_URL, uuid4, uuid5

from azure.core import MatchConditions
from azure.core.exceptions import HttpResponseError, ResourceExistsError, ResourceNotFoundError
from azure.cosmos.exceptions import CosmosResourceExistsError, CosmosResourceNotFoundError
from azure.storage.blob import ContentSettings

from backend.schemas.course_materials import IndexerExecution, MaterialFileStatus, MaterialJob, MaterialJobFile, MaterialJobStatus, MaterialPart, MaterialPreflight, MaterialScope
from utils import course_materials, material_uploads


logger = logging.getLogger(__name__)


def job_container():
    from azure_services.persistence.cosmos_db import get_courses_container

    return get_courses_container()


def load_job(job_id: str) -> MaterialJob | None:
    try:
        return MaterialJob.model_validate(job_container().read_item(item=job_id, partition_key=job_id))
    except CosmosResourceNotFoundError:
        return None


def create_draft(owner_id: str, request_id: str) -> MaterialJob:
    session = str(uuid5(NAMESPACE_URL, f"course-materials:{owner_id}:{request_id}"))
    job_id = f"materials-{session}"
    now = datetime.now(timezone.utc)
    job = MaterialJob(
        id=job_id, owner_id=owner_id, session_uuid=session,
        created_at=now, updated_at=now, next_attempt_at=now,
    )
    try:
        return MaterialJob.model_validate(job_container().create_item(body=job.model_dump(mode="json")))
    except CosmosResourceExistsError:
        existing = load_job(job_id)
        if existing is None or existing.owner_id != owner_id:
            raise ValueError("Draft ownership mismatch") from None
        return existing


def save_job(job: MaterialJob) -> MaterialJob:
    if not job.revision:
        raise ValueError("Job revision is required")
    job.updated_at = datetime.now(timezone.utc)
    saved = job_container().replace_item(
        item=job.id, body=job.model_dump(mode="json"),
        etag=job.revision, match_condition=MatchConditions.IfNotModified,
    )
    return MaterialJob.model_validate(saved)


def claim_job(job: MaterialJob, now: datetime | None = None) -> MaterialJob | None:
    now = now or datetime.now(timezone.utc)
    if (
        job.status not in {"PENDING", "RUNNING"} or job.progress == "uploading"
        or job.next_attempt_at > now or (job.lease_until and job.lease_until > now)
    ):
        return None
    job.status = "RUNNING"
    job.lease_owner = uuid4().hex
    job.lease_until = now + timedelta(minutes=5)
    job.attempts += 1
    return save_job(job)


def save_checkpoint(job: MaterialJob) -> MaterialJob:
    current = load_job(job.id)
    now = datetime.now(timezone.utc)
    if (
        current is None or not job.lease_owner or current.lease_owner != job.lease_owner
        or not current.lease_until or current.lease_until <= now
    ):
        raise ValueError("Processing lease expired")
    job.revision = current.revision
    job.lease_until = current.lease_until
    return save_job(job)


def job_status(job: MaterialJob) -> MaterialJobStatus:
    from azure_services.config import COMMON_INDEX_NAME

    stopped = job.status in {"FAILED", "COMPLETED"} and job.progress in {"preparing", "indexing"}
    ta_status = job.creation.status if job.creation else None
    ta_error = job.creation.error if job.creation else None
    if ta_status in {"PENDING", "RUNNING"} and job.status in {"FAILED", "COMPLETED"}:
        ta_status = "FAILED"
        ta_error = ta_error or "TA creation stopped before completion. Retry to resume its saved progress."
    return MaterialJobStatus(
        job_id=job.id, session_uuid=job.session_uuid, status="FAILED" if stopped else job.status,
        progress="failed" if stopped else job.progress,
        index_name=COMMON_INDEX_NAME, files_uploaded=len(job.files),
        ta_status=ta_status, ta_error=ta_error,
        files=[MaterialFileStatus(
            source_id=entry.source.source_id, filename=entry.source.filename,
            kb_scope=entry.kb_scope,
            status="failed" if stopped and entry.status not in {"ready", "failed"} else entry.status,
            parts=len(entry.parts),
            error=(entry.error or "Material processing stopped. Retry this file.") if stopped and entry.status not in {"ready", "failed"} else entry.error,
        ) for entry in job.files if entry.status != "removed"],
    )


def original_blob_path(job: MaterialJob, entry: MaterialJobFile) -> str:
    return f"material-originals/{job.session_uuid}/{entry.kb_scope}/{entry.source.source_id}/{entry.source.stored_filename}"


def store_upload(job: MaterialJob, scope: MaterialScope, report: MaterialPreflight, content: bytes) -> MaterialJob:
    existing = next((entry for entry in job.files if entry.kb_scope == scope and entry.source.source_id == report.source_id), None)
    if existing and existing.operation == "index":
        return job
    if job.progress not in {"uploading", "ready", "failed"} or (job.lease_until and job.lease_until > datetime.now(timezone.utc)):
        raise ValueError("Materials are processing. Retry after this batch completes.")
    if existing:
        existing.operation, existing.status, existing.error = "index", "uploaded", None
        existing.parts = []
        existing.generation += 1
        job.status, job.progress = "PENDING", "uploading"
        job.index_requested_at, job.index_started_at = None, None
        return save_job(job)
    if len(job.files) >= 500 or sum(entry.source.size_bytes for entry in job.files) + len(content) > material_uploads.MAX_BATCH_BYTES:
        raise material_uploads.MaterialRejected("A material session supports at most 500 originals and 250 MiB.")
    entry = MaterialJobFile(source=report, kb_scope=scope)
    blob = course_materials.get_material_container().get_blob_client(original_blob_path(job, entry))
    try:
        blob.upload_blob(content, overwrite=False, metadata={"AzureSearch_Skip": "true", "source_sha256": report.sha256})
    except ResourceExistsError:
        properties = blob.get_blob_properties()
        if properties.size != report.size_bytes or properties.metadata.get("source_sha256") != report.sha256:
            raise ValueError("Original file identity changed") from None
    job.files.append(entry)
    job.status = "PENDING"
    job.progress = "uploading"
    job.index_requested_at = None
    job.index_started_at = None
    return save_job(job)


def start_processing(job: MaterialJob, source_ids: list[str]) -> MaterialJob:
    if source_ids and not set(source_ids) <= {entry.source.source_id for entry in job.files}:
        raise ValueError("Unknown material selection")
    if job.progress in {"preparing", "indexing"} and job.status in {"PENDING", "RUNNING"}:
        return job
    if job.lease_until and job.lease_until > datetime.now(timezone.utc):
        raise ValueError("Materials are processing")
    for entry in job.files:
        if job.status in {"FAILED", "COMPLETED"} and entry.status in {"uploaded", "preparing", "indexing"}:
            entry.status, entry.error = "failed", "Material processing stopped. Retry this file."
        if entry.status == "failed" and (not source_ids or entry.source.source_id in source_ids):
            entry.status = "uploaded"
            entry.error = None
            entry.attempts = 0
            entry.generation += 1
    job.progress = "preparing" if job.files else "ready"
    job.status = "PENDING" if job.files else "COMPLETED"
    if job.creation and job.creation.status in {"PENDING", "RUNNING"}:
        job.status = "PENDING"
    elif not job.files and job.creation and job.creation.status == "FAILED":
        job.status = "FAILED"
    job.lease_owner = None
    job.lease_until = None
    job.index_requested_at = None
    job.index_started_at = None
    job.failures = 0
    job.next_attempt_at = datetime.now(timezone.utc)
    return save_job(job)


def ensure_edit_job(session: str, agent_name: str, owner_id: str) -> MaterialJob:
    job = load_job(f"materials-{session}")
    if job:
        if job.agent_name != agent_name:
            raise ValueError("Course material session is not attached to this course")
        return job
    now = datetime.now(timezone.utc)
    job = MaterialJob(
        id=f"materials-{session}", session_uuid=session, owner_id=owner_id, agent_name=agent_name,
        created_at=now, updated_at=now, next_attempt_at=now,
    )
    return MaterialJob.model_validate(job_container().create_item(body=job.model_dump(mode="json")))


def renew_lease(job: MaterialJob) -> None:
    now = datetime.now(timezone.utc)
    job_container().patch_item(
        item=job.id, partition_key=job.id,
        patch_operations=[{"op": "set", "path": "/lease_until", "value": (now + timedelta(minutes=5)).isoformat()}],
        filter_predicate=f"FROM c WHERE c.lease_owner = '{job.lease_owner}' AND c.lease_until > '{now.isoformat()}'",
    )


def release_job(job: MaterialJob) -> MaterialJob:
    current = load_job(job.id)
    if current is None or current.lease_owner != job.lease_owner:
        raise ValueError("Processing lease changed")
    job.revision = current.revision
    job.lease_owner = None
    job.lease_until = None
    if job.status == "RUNNING":
        job.status = "PENDING"
    return save_job(job)


def prepare_next_file(job: MaterialJob) -> MaterialJob:
    entry = next((entry for entry in job.files if entry.status in {"uploaded", "preparing"}), None)
    if entry is None:
        job.progress = "indexing"
        job.index_requested_at = datetime.now(timezone.utc)
        return save_checkpoint(job)
    entry.status = "preparing"
    entry.attempts += 1
    job = save_checkpoint(job)
    entry = next(item for item in job.files if item.kb_scope == entry.kb_scope and item.source.source_id == entry.source.source_id)
    container = course_materials.get_material_container()
    if entry.operation == "remove":
        for part in entry.parts:
            renew_lease(job)
            remove_indexed_part(job.session_uuid, entry.kb_scope, part.filename)
            try:
                container.get_blob_client(f"sessions/{job.session_uuid}/{entry.kb_scope}/{part.filename}").delete_blob(
                    etag=part.etag, match_condition=MatchConditions.IfNotModified,
                )
            except ResourceNotFoundError:
                pass
        entry.status = "removed"
        return save_checkpoint(job)
    content = container.get_blob_client(original_blob_path(job, entry)).download_blob().readall()
    if len(content) > material_uploads.MAX_FILE_BYTES:
        raise material_uploads.MaterialRejected("The saved original exceeds the processing limit.")
    try:
        for part in material_uploads.prepared_parts(content, entry.source):
            renew_lease(job)
            other_parts = sum(len(item.parts) for item in job.files if item.kb_scope == entry.kb_scope)
            if other_parts >= 500 and not any(item.filename == part.filename for item in entry.parts):
                raise material_uploads.MaterialRejected("This material category exceeds 500 indexing copies. Split it across courses.")
            blob = container.get_blob_client(f"sessions/{job.session_uuid}/{entry.kb_scope}/{part.filename}")
            digest = hashlib.sha256(part.content).hexdigest()
            metadata = {
                "session": job.session_uuid, "kb_scope": entry.kb_scope,
                "source_id": entry.source.source_id, "source_sha256": digest,
                "original_filename": entry.source.stored_filename,
                "processing_generation": str(entry.generation),
                "page_start": str(part.page_start or 1), "page_end": str(part.page_end or 1),
            }
            try:
                blob.upload_blob(
                    part.content, overwrite=False, metadata=metadata,
                    content_settings=ContentSettings(content_type=mimetypes.guess_type(part.filename)[0] or "application/octet-stream"),
                )
            except ResourceExistsError:
                properties = blob.get_blob_properties()
                if properties.size != len(part.content) or properties.metadata.get("source_sha256") != digest:
                    raise material_uploads.MaterialRejected("An indexing copy changed unexpectedly. Upload the original again.") from None
                if properties.metadata.get("processing_generation") != str(entry.generation):
                    blob.set_blob_metadata(metadata, etag=properties.etag, match_condition=MatchConditions.IfNotModified)
            properties = blob.get_blob_properties()
            prepared = MaterialPart(filename=part.filename, etag=properties.etag, page_start=part.page_start, page_end=part.page_end)
            entry.parts = [item for item in entry.parts if item.filename != part.filename] + [prepared]
            job = save_checkpoint(job)
            entry = next(item for item in job.files if item.kb_scope == entry.kb_scope and item.source.source_id == entry.source.source_id)
        entry.status = "indexing"
        entry.error = None
    except material_uploads.MaterialRejected as error:
        entry.status = "failed"
        entry.error = str(error)
    job.next_attempt_at = datetime.now(timezone.utc)
    return save_checkpoint(job)


def failed_index_parts(errors: list[dict], job: MaterialJob) -> tuple[set[str], bool]:
    failed = set()
    unmatched = False
    expected = {part.filename for entry in job.files for part in entry.parts}
    for error in errors:
        key = str(error.get("key") or "")[:8192]
        candidates = [key]
        try:
            candidates.append(base64.urlsafe_b64decode(key + "=" * (-len(key) % 4)).decode("utf-8"))
        except (ValueError, UnicodeError):
            pass
        matched = False
        for candidate in candidates:
            for scope in {entry.kb_scope for entry in job.files}:
                try:
                    filename = course_materials.material_filename(candidate, job.session_uuid, scope)
                except ValueError:
                    continue
                if filename in expected:
                    failed.add(filename)
                    matched = True
        unmatched |= not matched
    return failed, unmatched


def check_indexing(job: MaterialJob) -> MaterialJob:
    from azure_services.tools.search.course_index_manager import get_common_indexer_status, run_common_indexer

    waiting = [entry for entry in job.files if entry.status == "indexing"]
    now = datetime.now(timezone.utc)
    job.next_attempt_at = now + timedelta(seconds=10)
    if waiting:
        if job.index_requested_at is None:
            raise ValueError("Missing indexing boundary")
        if now - job.index_requested_at > timedelta(hours=2):
            for entry in waiting:
                entry.status, entry.error = "failed", "Indexing timed out. Retry this file."
        else:
            status = get_common_indexer_status()
            if "error" in status:
                raise RuntimeError("Index pipeline unavailable")
            raw = status.get("lastResult")
            execution = IndexerExecution.model_validate(raw) if raw else None
            fresh = execution and execution.start_time and execution.start_time >= job.index_requested_at
            if execution and execution.status == "inProgress":
                return job
            if not fresh:
                if not job.index_started_at:
                    accepted, _result = run_common_indexer()
                    if not accepted:
                        raise RuntimeError("Index run was not accepted")
                    job.index_started_at = now
                    return save_checkpoint(job)
                return job
            if not execution.end_time or execution.end_time < execution.start_time:
                return job
            errors = [*execution.errors, *(raw.get("warnings") or [])]
            failed, unmatched = failed_index_parts(errors, job)
            uncertain = unmatched or (execution.failed_items > 0 and not failed) or execution.status != "success"
            indexed = {scope: course_materials.indexed_material_names(job.session_uuid, scope) for scope in {entry.kb_scope for entry in waiting}}
            for entry in waiting:
                expected = {part.filename for part in entry.parts}
                if not uncertain and expected and not expected & failed and expected <= indexed[entry.kb_scope]:
                    entry.status, entry.error = "ready", None
                else:
                    entry.status, entry.error = "failed", "Not all indexing copies were verified as searchable. Retry this file."
    job.status = "FAILED" if any(entry.status == "failed" for entry in job.files) else "COMPLETED"
    job.progress = "failed" if job.status == "FAILED" else "ready"
    if job.status == "COMPLETED":
        job.output_ref = job_status(job).index_name
    return job


def advance_job(job: MaterialJob) -> MaterialJob:
    try:
        if job.creation and job.creation.status in {"PENDING", "RUNNING"}:
            from utils.course_creation import advance_creation

            job = advance_creation(job)
        else:
            job = prepare_next_file(job) if job.progress == "preparing" else check_indexing(job)
            job.failures = 0
        if job.creation and job.creation.status == "FAILED" and job.progress in {"ready", "failed"}:
            job.status = "FAILED"
    except Exception as error:
        logger.warning("Material job %s failed at %s (%s)", job.id, job.progress, type(error).__name__)
        current = load_job(job.id)
        if current is None or current.lease_owner != job.lease_owner:
            raise ValueError("Processing lease changed") from None
        job = current
        job.failures += 1
        status_code = getattr(error, "status_code", None)
        permanent = isinstance(error, (ValueError, material_uploads.MaterialRejected)) or (status_code is not None and status_code < 500 and status_code not in {408, 409, 412, 429})
        if permanent or job.failures >= 4:
            if job.creation and job.creation.status in {"PENDING", "RUNNING"}:
                job.creation.status = "FAILED"
                job.creation.error = "TA creation stopped before completion. Retry to resume its saved progress."
            for entry in job.files:
                if entry.status not in {"ready", "failed", "removed"}:
                    entry.status, entry.error = "failed", "Material processing could not complete. Retry this file."
            job.status, job.progress = "FAILED", "failed"
        else:
            job.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=min(60, 5 * 2 ** job.failures))
    return release_job(job)


def remove_indexed_part(session: str, scope: MaterialScope, filename: str) -> None:
    search = course_materials.get_search_client()
    escaped = filename.replace("'", "''")
    results = search.search(
        search_text="*", filter=course_materials.session_filter(session, scope) + f" and document_title eq '{escaped}'",
        select=["content_id", "content_path"],
    )
    batch = []
    for document in results:
        if course_materials.material_filename(document["content_path"], session, scope) != filename:
            raise ValueError("Indexed source identity mismatch")
        batch.append({"content_id": document["content_id"]})
        if len(batch) == 100:
            if not all(result.succeeded for result in search.delete_documents(documents=batch)):
                raise RuntimeError("Indexed copy removal failed")
            batch = []
    if batch and not all(result.succeeded for result in search.delete_documents(documents=batch)):
        raise RuntimeError("Indexed copy removal failed")


def remove_material(job: MaterialJob, source_id: str, scope: MaterialScope) -> MaterialJob:
    if job.progress not in {"ready", "failed", "uploading"} or (job.lease_until and job.lease_until > datetime.now(timezone.utc)):
        raise ValueError("Materials are processing")
    entry = next((entry for entry in job.files if entry.source.source_id == source_id and entry.kb_scope == scope), None)
    if entry is None:
        raise ValueError("Material not found")
    if entry.status == "removed":
        return job
    entry.operation, entry.status, entry.error = "remove", "uploaded", None
    job.progress, job.status = "uploading", "PENDING"
    job.next_attempt_at = datetime.now(timezone.utc)
    job.index_requested_at = None
    job.index_started_at = None
    return save_job(job)


def due_jobs() -> list[str]:
    now = datetime.now(timezone.utc).isoformat()
    return [item["id"] for item in job_container().query_items(
        query="SELECT TOP 4 c.id FROM c WHERE c.job_type = @kind AND c.status IN ('PENDING', 'RUNNING') AND c.progress != 'uploading' AND c.next_attempt_at <= @now AND (IS_NULL(c.lease_until) OR c.lease_until <= @now)",
        parameters=[{"name": "@kind", "value": "course_materials"}, {"name": "@now", "value": now}],
        enable_cross_partition_query=True, max_item_count=4,
    )]


async def process_claimed_job(job: MaterialJob) -> None:
    work = asyncio.create_task(asyncio.to_thread(advance_job, job))
    while not work.done():
        done, _pending = await asyncio.wait({work}, timeout=30)
        if not done:
            try:
                await asyncio.to_thread(renew_lease, job)
            except Exception:
                await work
                raise
    await work


async def run_worker(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            for job_id in await asyncio.to_thread(due_jobs):
                if stop.is_set():
                    break
                job = await asyncio.to_thread(load_job, job_id)
                try:
                    claimed = await asyncio.to_thread(claim_job, job) if job else None
                    if claimed:
                        await process_claimed_job(claimed)
                except HttpResponseError as error:
                    if error.status_code != 412:
                        logger.warning("Material worker %s request failed (%s)", job_id, type(error).__name__)
        except Exception as error:
            logger.warning("Material worker unavailable (%s)", type(error).__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=5)
        except asyncio.TimeoutError:
            continue