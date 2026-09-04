"""
Institute / Department Research – Blob Storage Helpers
──────────────────────────────────────────────────────
Stores structured JSON research results in Azure Blob Storage.
Container: institute-research
Blob layout:
  institutes/{key}.json
  departments/{inst_key}/{dept_key}.json
"""

import os
import re
import json
import logging
import threading
from typing import Dict, Any, Optional, List
from log_safe import scrub

logger = logging.getLogger("dashboard.research_storage")

_INST_RESEARCH_CONTAINER = "institute-research-v2"
_STORAGE_ACCOUNT_NAME = os.environ["STORAGE_ACCOUNT_NAME"]

# In-memory caches
_institute_research_cache: Dict[str, Dict[str, Any]] = {}
_department_research_cache: Dict[str, Dict[str, Any]] = {}
_blob_service_client = None
_blob_service_lock = threading.Lock()


def _get_blob_service_client():
    """Get the process-wide BlobServiceClient for research storage."""
    global _blob_service_client
    if _blob_service_client is not None:
        return _blob_service_client

    from azure.storage.blob import BlobServiceClient

    with _blob_service_lock:
        if _blob_service_client is None:
            try:
                from common_azure_auth import get_sync_credential

                credential = get_sync_credential()
            except ImportError:
                from azure.identity import DefaultAzureCredential

                credential = DefaultAzureCredential(
                    process_timeout=int(os.getenv("AZURE_CLI_TIMEOUT", "60"))
                )
            account_url = f"https://{_STORAGE_ACCOUNT_NAME}.blob.core.windows.net"
            _blob_service_client = BlobServiceClient(
                account_url=account_url,
                credential=credential,
            )
    return _blob_service_client


def _sanitize_blob_key(name: str) -> str:
    """Sanitize a name for use as a blob path segment."""
    return re.sub(r'[^a-zA-Z0-9_-]', '_', name.strip().lower())


def _ensure_inst_research_container():
    """Ensure the institute-research blob container exists."""
    try:
        blob_service = _get_blob_service_client()
        container_client = blob_service.get_container_client(_INST_RESEARCH_CONTAINER)
        if not container_client.exists():
            container_client.create_container()
            logger.info(f"Created blob container: {_INST_RESEARCH_CONTAINER}")
    except Exception as e:
        logger.warning(f"Could not ensure institute research container: {e}")


# ── Institute Research ──────────────────────────────────────────

def save_institute_research(institute_name: str, data: Dict[str, Any]) -> bool:
    key = _sanitize_blob_key(institute_name)
    blob_name = f"institutes/{key}.json"
    data_json = json.dumps(data, indent=2, ensure_ascii=False)

    try:
        from azure.storage.blob import ContentSettings
        _ensure_inst_research_container()
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        blob_client.upload_blob(
            data_json.encode("utf-8"), overwrite=True,
            content_settings=ContentSettings(content_type="application/json"),
        )
        _institute_research_cache[key] = data
        logger.info(f"Saved institute research for '{scrub(institute_name)}' ({scrub(len(data_json))} chars, status={scrub(data.get('status'))})")
        return True
    except Exception as e:
        logger.error(f"Failed to save institute research for '{scrub(institute_name)}': {scrub(e)}")
        return False


def get_institute_research(institute_name: str) -> Optional[Dict[str, Any]]:
    key = _sanitize_blob_key(institute_name)
    if key in _institute_research_cache:
        return _institute_research_cache[key]

    blob_name = f"institutes/{key}.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        download = blob_client.download_blob()
        data = json.loads(download.readall().decode("utf-8"))
        _institute_research_cache[key] = data
        logger.info(f"Loaded institute research for '{scrub(institute_name)}' from blob (status={scrub(data.get('status'))})")
        return data
    except Exception:
        return None


def delete_institute_research(institute_name: str) -> bool:
    key = _sanitize_blob_key(institute_name)
    blob_name = f"institutes/{key}.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        blob_client.delete_blob()
    except Exception:
        pass
    _institute_research_cache.pop(key, None)
    logger.info(f"Deleted institute research for '{institute_name}'")
    return True


# ── Department Research ─────────────────────────────────────────

def save_department_research(institute_name: str, department_name: str, data: Dict[str, Any]) -> bool:
    inst_key = _sanitize_blob_key(institute_name)
    dept_key = _sanitize_blob_key(department_name)
    cache_key = f"{inst_key}/{dept_key}"
    blob_name = f"departments/{inst_key}/{dept_key}.json"
    data_json = json.dumps(data, indent=2, ensure_ascii=False)

    try:
        from azure.storage.blob import ContentSettings
        _ensure_inst_research_container()
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        blob_client.upload_blob(
            data_json.encode("utf-8"), overwrite=True,
            content_settings=ContentSettings(content_type="application/json"),
        )
        _department_research_cache[cache_key] = data
        logger.info(f"Saved department research for '{scrub(department_name)}@{scrub(institute_name)}' ({scrub(len(data_json))} chars, status={scrub(data.get('status'))})")
        return True
    except Exception as e:
        logger.error(f"Failed to save department research for '{scrub(department_name)}@{scrub(institute_name)}': {scrub(e)}")
        return False


def get_department_research(institute_name: str, department_name: str) -> Optional[Dict[str, Any]]:
    inst_key = _sanitize_blob_key(institute_name)
    dept_key = _sanitize_blob_key(department_name)
    cache_key = f"{inst_key}/{dept_key}"

    if cache_key in _department_research_cache:
        return _department_research_cache[cache_key]

    blob_name = f"departments/{inst_key}/{dept_key}.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        download = blob_client.download_blob()
        data = json.loads(download.readall().decode("utf-8"))
        _department_research_cache[cache_key] = data
        logger.info(f"Loaded department research for '{scrub(department_name)}@{scrub(institute_name)}' from blob (status={scrub(data.get('status'))})")
        return data
    except Exception:
        return None


def delete_department_research(institute_name: str, department_name: str) -> bool:
    inst_key = _sanitize_blob_key(institute_name)
    dept_key = _sanitize_blob_key(department_name)
    cache_key = f"{inst_key}/{dept_key}"
    blob_name = f"departments/{inst_key}/{dept_key}.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        blob_client.delete_blob()
    except Exception:
        pass
    _department_research_cache.pop(cache_key, None)
    logger.info(f"Deleted department research for '{department_name}@{institute_name}'")
    return True


def list_all_institute_research() -> List[Dict[str, Any]]:
    """List all institute research results (name + status only)."""
    results = []
    try:
        blob_service = _get_blob_service_client()
        container_client = blob_service.get_container_client(_INST_RESEARCH_CONTAINER)
        for blob in container_client.list_blobs(name_starts_with="institutes/"):
            try:
                blob_client = container_client.get_blob_client(blob.name)
                download = blob_client.download_blob()
                data = json.loads(download.readall().decode("utf-8"))
                results.append({
                    "name": data.get("institute_name", blob.name),
                    "status": data.get("status", "unknown"),
                    "research_type": "institute",
                })
            except Exception:
                continue
    except Exception as e:
        logger.warning(f"Could not list institute research: {e}")
    return results
