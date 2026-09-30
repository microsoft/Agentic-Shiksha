import json
import hashlib
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from urllib.parse import quote, unquote, urlencode, urlsplit
from uuid import uuid4

from azure.core import MatchConditions
from azure.core.exceptions import ResourceNotFoundError
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery

from backend.schemas.course_materials import (
    CourseMaterialSource,
    CourseIndexStatus,
    IndexedPassage,
    IndexerExecution,
    IndexingOperation,
    MaterialFile,
    MaterialScope,
)


@lru_cache(maxsize=1)
def get_search_client() -> SearchClient:
    from azure_services.config import COMMON_INDEX_NAME, SEARCH_ENDPOINT
    from common_azure_auth import get_sync_credential

    return SearchClient(
        SEARCH_ENDPOINT, COMMON_INDEX_NAME, get_sync_credential(),
        connection_timeout=10, read_timeout=30, retry_total=2,
    )


def close_search_client() -> None:
    if get_search_client.cache_info().currsize:
        get_search_client().close()
        get_search_client.cache_clear()


def get_material_container():
    from azure_services.config import BLOB_CONTAINER
    from azure_services.persistence.cosmos_db import _get_blob_service_client

    return _get_blob_service_client().get_container_client(BLOB_CONTAINER)


def load_course(agent_name: str) -> dict | None:
    from azure_services.persistence.cosmos_db import _get_agents_container

    try:
        return _get_agents_container().read_item(item=agent_name, partition_key=agent_name)
    except ResourceNotFoundError:
        return None


def load_setup(agent_name: str) -> dict:
    from utils.metadata_cache import setup_cache
    from azure_services.persistence.cosmos_db import _AGENT_SETUPS_CONTAINER, _get_blob_service_client

    def read_setup():
        blob = _get_blob_service_client().get_blob_client(
            _AGENT_SETUPS_CONTAINER, f"{agent_name}/setup.json"
        )
        value = json.loads(blob.download_blob().readall())
        if not isinstance(value, dict):
            raise ValueError("Invalid course setup")
        return value

    return setup_cache.get((_AGENT_SETUPS_CONTAINER, agent_name), read_setup)


def save_operation(course: dict, operation: IndexingOperation) -> None:
    from azure_services.persistence.cosmos_db import _get_agents_container

    _get_agents_container().patch_item(
        item=course["id"], partition_key=course["id"],
        patch_operations=[{
            "op": "set", "path": "/materialIndexing", "value": operation.model_dump(mode="json"),
        }],
        etag=course["_etag"], match_condition=MatchConditions.IfNotModified,
    )


def list_material_files(session_uuid: str, scope: MaterialScope) -> list[MaterialFile]:
    prefix = f"sessions/{session_uuid}/{scope}/"
    files = []
    for blob in get_material_container().list_blobs(name_starts_with=prefix):
        filename = blob.name[len(prefix):]
        files.append(MaterialFile(filename=filename, etag=blob.etag))
        if len(files) > 500:
            raise ValueError("Too many course materials")
    return sorted(files, key=lambda item: item.filename)


def session_filter(session_uuid: str, scope: MaterialScope | None = None) -> str:
    escaped = session_uuid.replace("'", "''")
    expression = f"session_id eq '{escaped}'"
    if scope:
        expression += f" and file_category eq '{scope}'"
    return expression


def material_filename(content_path: str, session_uuid: str, scope: MaterialScope) -> str:
    from azure_services.config import BLOB_CONTAINER, STORAGE_ACCOUNT

    address = urlsplit(content_path)
    prefix = f"/{BLOB_CONTAINER}/sessions/{session_uuid}/{scope}/"
    path = unquote(address.path)
    if (
        address.scheme != "https" or address.hostname != f"{STORAGE_ACCOUNT}.blob.core.windows.net"
        or address.username or address.password or address.port not in (None, 443)
        or not path.startswith(prefix)
    ):
        raise ValueError("Search returned an invalid course source")
    filename = path[len(prefix):]
    if (
        not filename or filename in {".", ".."} or "/" in filename or "\\" in filename
        or any(ord(char) < 32 for char in filename)
    ):
        raise ValueError("Search source filename is invalid")
    return filename


def indexed_material_names(session_uuid: str, scope: MaterialScope) -> set[str]:
    names = set()
    results = get_search_client().search(
        search_text="*", filter=session_filter(session_uuid, scope),
        select=["document_title", "content_path", "content_type"],
    )
    for position, item in enumerate(results):
        if position >= 50000:
            raise ValueError("Course index is too large to verify")
        if item.get("content_type") == "image":
            continue
        filename = material_filename(item.get("content_path") or "", session_uuid, scope)
        if filename != item.get("document_title"):
            raise ValueError("Indexed document identity is invalid")
        names.add(filename)
    return names


def new_operation(session_uuid: str, scope: MaterialScope) -> IndexingOperation:
    return IndexingOperation(
        id=uuid4().hex, session_uuid=session_uuid, kb_scope=scope,
        requested_at=datetime.now(timezone.utc), files=list_material_files(session_uuid, scope),
    )


def operation_status(operation: IndexingOperation, indexed_files: int = 0) -> CourseIndexStatus:
    messages = {
        "indexing": "Files uploaded. Indexing is still in progress.",
        "ready": "Course materials are searchable.",
        "failed": "Course indexing did not complete. Retry indexing.",
        "changed": "Course files changed during indexing. Retry indexing.",
    }
    return CourseIndexStatus(
        ok=operation.state in {"indexing", "ready"}, operation_id=operation.id,
        status=operation.state, expected_files=len(operation.files),
        indexed_files=indexed_files, message=messages[operation.state],
    )


def check_operation(operation: IndexingOperation, now: datetime | None = None) -> CourseIndexStatus:
    from azure_services.tools.search.course_index_manager import get_common_indexer_status

    current_files = list_material_files(operation.session_uuid, operation.kb_scope)
    if current_files != operation.files:
        operation.state = "changed"
        return operation_status(operation)
    if operation.state != "indexing":
        return operation_status(operation, len(operation.files) if operation.state == "ready" else 0)

    current_time = now or datetime.now(timezone.utc)
    if current_time - operation.requested_at > timedelta(minutes=15):
        operation.state = "failed"
        return operation_status(operation)

    status = get_common_indexer_status()
    if "error" in status:
        raise RuntimeError("Indexer status is unavailable")
    last_result = status.get("lastResult")
    if not last_result:
        return operation_status(operation)
    execution = IndexerExecution.model_validate(last_result)
    if not execution.start_time or execution.start_time < operation.requested_at:
        return operation_status(operation)
    if execution.status == "inProgress":
        return operation_status(operation)
    if (
        execution.status != "success" or execution.failed_items or execution.errors
        or not execution.end_time or execution.end_time < execution.start_time
    ):
        operation.state = "failed"
        return operation_status(operation)

    expected = {item.filename for item in operation.files}
    indexed = indexed_material_names(operation.session_uuid, operation.kb_scope)
    if indexed == expected:
        operation.state = "ready"
    return operation_status(operation, len(indexed & expected))


def retrieve_course_passages(
    agent_name: str, session_uuid: str, question: str, index: dict,
) -> list[CourseMaterialSource]:
    from azure_services.config import COMMON_INDEX_NAME

    if index.get("index_name") != COMMON_INDEX_NAME or not index.get("filter"):
        raise ValueError("Course Search configuration does not match the configured index")
    query_type = index.get("query_type") or "vector_semantic_hybrid"
    if query_type not in {"simple", "semantic", "vector", "vector_simple_hybrid", "vector_semantic_hybrid"}:
        raise ValueError("Unsupported course Search query type")
    query = question[:4000]
    options = {
        "search_text": None if query_type == "vector" else query,
        "filter": f"({index['filter']}) and ({session_filter(session_uuid)}) and content_type ne 'image'",
        "select": [
            "content_id", "document_title", "content_path", "content_text", "session_id",
            "file_category", "page_number", "logical_section",
        ],
        "top": min(max(int(index.get("top_k") or 5), 1), 20),
    }
    if "vector" in query_type:
        options["vector_queries"] = [VectorizableTextQuery(text=query, fields="content_embedding", k_nearest_neighbors=20)]
    if "semantic" in query_type:
        options.update(query_type="semantic", semantic_configuration_name="semantic-config")

    sources = []
    seen = set()
    remaining = 12000
    material_job = None
    for item in get_search_client().search(**options):
        passage = IndexedPassage.model_validate(dict(item))
        if passage.session_id != session_uuid:
            raise ValueError("Search returned a different course session")
        filename = material_filename(passage.content_path, session_uuid, passage.file_category)
        if filename != passage.document_title:
            raise ValueError("Search source filename does not match its document")
        from utils.material_uploads import COPY_PATTERN, PART_PATTERN

        copy_match = PART_PATTERN.fullmatch(filename) or COPY_PATTERN.fullmatch(filename)
        page_number = passage.page_number
        download_params = {"filename": filename, "kb_scope": passage.file_category}
        if copy_match:
            from utils.material_jobs import load_job

            if material_job is None:
                material_job = load_job(f"materials-{session_uuid}")
            if material_job is None or material_job.agent_name != agent_name:
                raise ValueError("Prepared source ownership could not be verified")
            entry = next((entry for entry in material_job.files if entry.kb_scope == passage.file_category and entry.source.source_id == copy_match["source"]), None)
            part = next((part for part in entry.parts if part.filename == filename), None) if entry else None
            if entry is None or part is None:
                raise ValueError("Prepared source identity could not be verified")
            if entry.operation == "remove":
                continue
            filename = entry.source.filename
            download_params.update(filename=filename, source_id=entry.source.source_id)
            if page_number is not None and part.page_start is not None:
                page_number += part.page_start - 1
                if part.page_end is None or page_number > part.page_end:
                    raise ValueError("Prepared source page is out of range")
        excerpt = passage.content_text[:min(4000, remaining)]
        if not excerpt.strip():
            continue
        digest = hashlib.sha256(
            f"{agent_name}\0{passage.content_id}\0{passage.content_text}".encode("utf-8")
        ).hexdigest()[:24]
        citation_id = f"course-{digest}"
        if citation_id in seen:
            continue
        seen.add(citation_id)
        source = CourseMaterialSource(
            citation_id=citation_id, title=filename, filename=filename, excerpt=excerpt,
            url=f"/api/agents/{quote(agent_name, safe='')}/course-materials/file?" + urlencode(download_params),
            page_number=page_number, section=passage.logical_section,
            truncated=len(excerpt) < len(passage.content_text),
        )
        sources.append(source)
        remaining -= len(excerpt)
        if len(sources) >= 8 or remaining <= 0:
            break
    return sources