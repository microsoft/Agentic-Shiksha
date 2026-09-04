"""
Git-based version control for course curricula.

Each agent/course has its own bare git repo stored as a compressed tarball
in Azure Blob Storage. Operations:
  - save: download repo tarball → commit curriculum.json → re-upload
  - list: download repo → walk git log
  - get: download repo → read blob at specific commit

Uses dulwich (pure Python git) — no system git binary required.
"""

import io
import json
import logging
import os
import re
import shutil
import tarfile
import tempfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from dulwich.objects import Blob, Commit, Tree
from dulwich.repo import Repo
from utils.log_safe import scrub

logger = logging.getLogger(__name__)


def _safe_id(agent_id: str) -> str:
    """Reduce an agent id to characters that cannot traverse or escape a directory.

    Used for the blob path only; temporary directories deliberately keep the id out
    of the filesystem path entirely.
    """
    return re.sub(r"[^A-Za-z0-9._-]", "_", agent_id).lstrip(".")[:64] or "unknown"

_COURSE_CURRICULUM_STORAGE_ACCOUNT = os.environ["STORAGE_ACCOUNT_NAME"]
_COURSE_CURRICULUM_CONTAINER = "course-curriculum-v2"

# File tracked in the git repo
_CURRICULUM_FILENAME = b"curriculum.json"


def _get_blob_service_client():
    """Get a BlobServiceClient for course curriculum storage."""
    from azure.storage.blob import BlobServiceClient
    try:
        from common_azure_auth import get_sync_credential
        credential = get_sync_credential()
    except ImportError:
        from azure.identity import DefaultAzureCredential
        credential = DefaultAzureCredential()
    account_url = f"https://{_COURSE_CURRICULUM_STORAGE_ACCOUNT}.blob.core.windows.net"
    return BlobServiceClient(account_url=account_url, credential=credential)


def _ensure_container():
    """Ensure the course-curriculum blob container exists."""
    try:
        blob_service = _get_blob_service_client()
        container_client = blob_service.get_container_client(_COURSE_CURRICULUM_CONTAINER)
        if not container_client.exists():
            container_client.create_container()
            logger.info(f"Created blob container: {_COURSE_CURRICULUM_CONTAINER}")
    except Exception as e:
        logger.warning(f"Could not ensure course curriculum container: {e}")


def _repo_blob_name(agent_id: str) -> str:
    """Blob path for the repo tarball."""
    return f"{_safe_id(agent_id)}/curriculum-repo.tar.gz"


def _download_repo(agent_id: str, target_dir: str) -> bool:
    """
    Download and extract the bare git repo tarball from blob storage.
    Returns True if a repo was found and extracted, False if not found (new repo needed).
    """
    blob_name = _repo_blob_name(agent_id)
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(
            container=_COURSE_CURRICULUM_CONTAINER, blob=blob_name
        )
        data = blob_client.download_blob().readall()
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            # Safe extraction: filter='data' prevents path traversal (Python 3.12+)
            tar.extractall(path=target_dir, filter="data")
        logger.debug(f"Downloaded git repo for '{scrub(agent_id)}' ({scrub(len(data))} bytes)")
        return True
    except Exception as e:
        # ResourceNotFoundError or similar — repo doesn't exist yet
        if "BlobNotFound" in str(e) or "ResourceNotFound" in str(e) or "404" in str(e):
            logger.info(f"No existing git repo for '{scrub(agent_id)}' — will initialize new")
            return False
        logger.error(f"Failed to download git repo for '{scrub(agent_id)}': {scrub(e)}")
        return False


def _upload_repo(agent_id: str, repo_dir: str) -> bool:
    """
    Tar the bare git repo directory and upload to blob storage.
    """
    from azure.storage.blob import ContentSettings

    blob_name = _repo_blob_name(agent_id)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        # Add repo contents (the bare repo directory)
        for entry in os.listdir(repo_dir):
            full_path = os.path.join(repo_dir, entry)
            tar.add(full_path, arcname=entry)
    buf.seek(0)
    tarball_bytes = buf.getvalue()

    try:
        _ensure_container()
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(
            container=_COURSE_CURRICULUM_CONTAINER, blob=blob_name
        )
        blob_client.upload_blob(
            tarball_bytes,
            overwrite=True,
            content_settings=ContentSettings(content_type="application/gzip"),
        )
        logger.info(
            f"Uploaded git repo for '{scrub(agent_id)}' ({scrub(len(tarball_bytes))} bytes)"
        )
        return True
    except Exception as e:
        logger.error(f"Failed to upload git repo for '{scrub(agent_id)}': {scrub(e)}")
        return False


def _open_or_init_repo(repo_dir: str, exists: bool) -> Repo:
    """Open an existing bare repo or initialize a new one."""
    if exists:
        return Repo(repo_dir)
    else:
        os.makedirs(repo_dir, exist_ok=True)
        return Repo.init_bare(repo_dir)


def save_course_curriculum_version(
    agent_id: str,
    course_curriculum: Dict[str, Any],
    commit_message: str,
    user_id: str = "unknown",
) -> Optional[str]:
    """
    Commit a new version of the course curriculum to the agent's git repo.
    Returns the commit SHA (hex string) as the version_id, or None on failure.
    """
    tmp_dir = tempfile.mkdtemp(prefix="curriculum_git_")
    repo_dir = os.path.join(tmp_dir, "repo.git")
    os.makedirs(repo_dir, exist_ok=True)

    try:
        # Download existing repo (or start fresh)
        repo_exists = _download_repo(agent_id, repo_dir)
        repo = _open_or_init_repo(repo_dir, repo_exists)

        # Create the curriculum blob object
        curriculum_json = json.dumps(course_curriculum, indent=2, ensure_ascii=False)
        blob_obj = Blob.from_string(curriculum_json.encode("utf-8"))
        repo.object_store.add_object(blob_obj)

        # Create tree with the curriculum file
        tree = Tree()
        tree.add(_CURRICULUM_FILENAME, 0o100644, blob_obj.id)
        repo.object_store.add_object(tree)

        # Determine parent commit (if any)
        parents = []
        try:
            head_ref = repo.refs[b"refs/heads/main"]
            parents = [head_ref]
        except KeyError:
            pass  # First commit — no parent

        # Create commit
        now = datetime.now(timezone.utc)
        timestamp = int(now.timestamp())
        tz_offset = 0  # UTC

        author = f"{user_id} <{user_id}@ekalaiva>".encode("utf-8")
        commit = Commit()
        commit.tree = tree.id
        commit.parents = parents
        commit.author = author
        commit.committer = author
        commit.commit_time = timestamp
        commit.author_time = timestamp
        commit.commit_timezone = tz_offset
        commit.author_timezone = tz_offset
        commit.encoding = b"UTF-8"
        commit.message = commit_message.encode("utf-8")

        repo.object_store.add_object(commit)

        # Update refs/heads/main
        repo.refs[b"refs/heads/main"] = commit.id

        # Upload the updated repo
        if not _upload_repo(agent_id, repo_dir):
            return None

        version_id = commit.id.decode("ascii")
        logger.info(
            f"Git commit {scrub(version_id[:8])} for '{scrub(agent_id)}': {scrub(commit_message)}"
        )
        return version_id

    except Exception as e:
        logger.error(f"Failed to save git curriculum version for '{scrub(agent_id)}': {scrub(e)}")
        return None
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def list_course_curriculum_versions(agent_id: str) -> List[Dict[str, Any]]:
    """
    List all commits (versions) from the agent's git repo.
    Returns list of version metadata dicts sorted newest-first.
    """
    tmp_dir = tempfile.mkdtemp(prefix="curriculum_git_")
    repo_dir = os.path.join(tmp_dir, "repo.git")
    os.makedirs(repo_dir, exist_ok=True)

    try:
        repo_exists = _download_repo(agent_id, repo_dir)
        if not repo_exists:
            return []

        repo = Repo(repo_dir)

        # Get HEAD of main branch
        try:
            head = repo.refs[b"refs/heads/main"]
        except KeyError:
            return []

        # Walk the commit graph
        versions = []
        visited = set()
        stack = [head]

        while stack:
            commit_id = stack.pop()
            if commit_id in visited:
                continue
            visited.add(commit_id)

            commit = repo.object_store[commit_id]
            if not isinstance(commit, Commit):
                continue

            commit_time = datetime.fromtimestamp(
                commit.commit_time, tz=timezone.utc
            )
            author_str = commit.author.decode("utf-8", errors="replace")
            # Extract username from "user <user@ekalaiva>" format
            saved_by = author_str.split(" <")[0] if " <" in author_str else author_str

            versions.append({
                "version_id": commit_id.decode("ascii"),
                "commit_message": commit.message.decode("utf-8", errors="replace").strip(),
                "saved_by": saved_by,
                "saved_at": commit_time.isoformat(),
            })

            # Follow parents
            for parent_id in commit.parents:
                if parent_id not in visited:
                    stack.append(parent_id)

        # Sort newest first
        versions.sort(key=lambda v: v["saved_at"], reverse=True)
        return versions

    except Exception as e:
        logger.error(f"Failed to list git curriculum versions for '{scrub(agent_id)}': {scrub(e)}")
        return []
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def get_course_curriculum_version(
    agent_id: str, version_id: str
) -> Optional[Dict[str, Any]]:
    """
    Retrieve the course curriculum at a specific commit (version_id = commit SHA).
    Returns the version metadata + curriculum dict, or None if not found.
    """
    tmp_dir = tempfile.mkdtemp(prefix="curriculum_git_")
    repo_dir = os.path.join(tmp_dir, "repo.git")
    os.makedirs(repo_dir, exist_ok=True)

    try:
        repo_exists = _download_repo(agent_id, repo_dir)
        if not repo_exists:
            return None

        repo = Repo(repo_dir)

        commit_id = version_id.encode("ascii")
        commit = repo.object_store[commit_id]
        if not isinstance(commit, Commit):
            return None

        # Read the tree to get curriculum.json blob
        tree = repo.object_store[commit.tree]
        curriculum_blob_id = None
        for item in tree.items():
            if item.path == _CURRICULUM_FILENAME:
                curriculum_blob_id = item.sha
                break

        if curriculum_blob_id is None:
            logger.error(f"No curriculum.json in commit {scrub(version_id[:8])} for '{scrub(agent_id)}'")
            return None

        blob_obj = repo.object_store[curriculum_blob_id]
        curriculum = json.loads(blob_obj.data.decode("utf-8"))

        commit_time = datetime.fromtimestamp(
            commit.commit_time, tz=timezone.utc
        )
        author_str = commit.author.decode("utf-8", errors="replace")
        saved_by = author_str.split(" <")[0] if " <" in author_str else author_str

        return {
            "version_id": version_id,
            "commit_message": commit.message.decode("utf-8", errors="replace").strip(),
            "saved_by": saved_by,
            "saved_at": commit_time.isoformat(),
            "curriculum": curriculum,
        }

    except KeyError:
        logger.error(f"Commit '{scrub(version_id)}' not found in repo for '{scrub(agent_id)}'")
        return None
    except Exception as e:
        logger.error(f"Failed to get git curriculum version '{scrub(version_id)}' for '{scrub(agent_id)}': {scrub(e)}")
        return None
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def diff_course_curriculum_versions(
    agent_id: str, version_id_old: str, version_id_new: str
) -> Optional[Dict[str, Any]]:
    """
    Get the curriculum JSON for two versions (for client-side diffing).
    Returns dict with 'old' and 'new' curriculum dicts, or None on error.
    """
    tmp_dir = tempfile.mkdtemp(prefix="curriculum_git_")
    repo_dir = os.path.join(tmp_dir, "repo.git")
    os.makedirs(repo_dir, exist_ok=True)

    try:
        repo_exists = _download_repo(agent_id, repo_dir)
        if not repo_exists:
            return None

        repo = Repo(repo_dir)

        def _read_curriculum_at_commit(cid: str) -> Optional[Dict]:
            commit = repo.object_store[cid.encode("ascii")]
            tree = repo.object_store[commit.tree]
            for item in tree.items():
                if item.path == _CURRICULUM_FILENAME:
                    blob_obj = repo.object_store[item.sha]
                    return json.loads(blob_obj.data.decode("utf-8"))
            return None

        old_curriculum = _read_curriculum_at_commit(version_id_old)
        new_curriculum = _read_curriculum_at_commit(version_id_new)

        if old_curriculum is None or new_curriculum is None:
            return None

        return {"old": old_curriculum, "new": new_curriculum}

    except Exception as e:
        logger.error(
            f"Failed to diff versions '{scrub(version_id_old)}' vs '{scrub(version_id_new)}' for '{scrub(agent_id)}': {scrub(e)}"
        )
        return None
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
