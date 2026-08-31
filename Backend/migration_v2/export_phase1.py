"""
Phase A of the v1 freeze / v2 cutover: export everything worth keeping from
Phase 1, then verify the archive can be read back.

Read-only against every live source. Writes only to the ``phase1-archive``
blob container and a local staging directory.

Usage:
    python migration_v2/export_phase1.py [--skip-memories]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
logger = logging.getLogger("export_phase1")
logger.setLevel(logging.INFO)

ARCHIVE_CONTAINER = "phase1-archive"
# Staged outside the repo: the snapshot contains student PII and the repo folder
# is OneDrive-synced, which also locks files mid-write.
STAGING = Path(tempfile.gettempdir()) / "ekalaiva_phase1_archive"

# Meta agents whose names also begin with "course-". A naive prefix filter would
# delete the course builder and the conversational agent along with the TAs.
PROTECTED_AGENTS = {
    "course-agent-creation-agent",
    "course-conversational-agent",
    "temp-course-agent",
}

PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
STORAGE_ACCOUNT = os.environ["STORAGE_ACCOUNT_NAME"]


def _plain(obj: Any) -> Any:
    """Best-effort conversion of an SDK model into JSON-serialisable data."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    for attr in ("as_dict", "model_dump", "dict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return _plain(fn())
            except Exception:
                pass
    if isinstance(obj, dict):
        return {str(k): _plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_plain(v) for v in obj]
    return str(obj)


# ---------------------------------------------------------------- agents


def list_ta_agents(project_client) -> List[str]:
    names = []
    for agent in project_client.agents.list():
        name = getattr(agent, "name", None) or getattr(agent, "id", None)
        if name and name.startswith("course-") and name not in PROTECTED_AGENTS:
            names.append(str(name))
    return sorted(names)


def export_agent(project_client, agent_name: str, scopes_by_agent, memory_mgr) -> Dict[str, Any]:
    from azure_services.persistence.cosmos_db import (
        get_agent_metadata,
        get_course_curriculum,
        load_agent_setup,
    )

    bundle: Dict[str, Any] = {
        "agentName": agent_name,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "sources": {},
    }

    # 1. Foundry definition — instructions, model, tools, tool_resources
    try:
        definition = project_client.agents.get(agent_name=agent_name).versions.get("latest").definition
        bundle["foundryDefinition"] = _plain(definition)
        bundle["sources"]["foundryDefinition"] = "ok"
    except Exception as exc:
        bundle["foundryDefinition"] = None
        bundle["sources"]["foundryDefinition"] = f"FAILED: {exc}"

    # 2. Cosmos metadata — description, conversation starters, course details
    for key, fn in (("cosmosMetadata", get_agent_metadata), ("agentSetup", load_agent_setup),
                    ("courseCurriculum", get_course_curriculum)):
        try:
            bundle[key] = _plain(fn(agent_name))
            bundle["sources"][key] = "ok" if bundle[key] else "absent"
        except Exception as exc:
            bundle[key] = None
            bundle["sources"][key] = f"FAILED: {exc}"

    # 3. Memory store — metadata always, per-scope contents when available
    bundle["memoryStore"] = None
    bundle["memories"] = []
    if memory_mgr is not None:
        store_name = f"{agent_name}-memory"
        try:
            store = memory_mgr.get_memory_store(store_name)
            bundle["memoryStore"] = _plain(store)
            if store:
                for scope in sorted(scopes_by_agent.get(agent_name, set())):
                    try:
                        items = memory_mgr.get_static_memories(store_name, scope)
                        if items:
                            bundle["memories"].append({"scope": scope, "items": _plain(items)})
                    except Exception:
                        continue
            bundle["sources"]["memoryStore"] = "ok" if store else "absent"
        except Exception as exc:
            bundle["sources"]["memoryStore"] = f"FAILED: {exc}"

    return bundle


# ---------------------------------------------------------------- cosmos


def snapshot_cosmos(out_dir: Path) -> Dict[str, int]:
    from azure_services.persistence.cosmos_db import get_cosmos_client
    import azure_services.persistence.cosmos_db as cdb

    get_cosmos_client()
    database = cdb._database
    out_dir.mkdir(parents=True, exist_ok=True)

    counts: Dict[str, int] = {}
    for meta in sorted(database.list_containers(), key=lambda c: c["id"]):
        name = meta["id"]
        container = database.get_container_client(name)
        path = out_dir / f"{name}.ndjson"
        written = 0
        with path.open("w", encoding="utf-8") as handle:
            for doc in container.query_items(
                query="SELECT * FROM c", enable_cross_partition_query=True
            ):
                handle.write(json.dumps(doc, ensure_ascii=False) + "\n")
                written += 1
        counts[name] = written
        logger.info("  cosmos %-34s %6d docs", name, written)
    return counts


def scopes_per_agent() -> Dict[str, set]:
    """Map agent -> user ids that have threads with it, for memory export."""
    import azure_services.persistence.cosmos_db as cdb

    mapping: Dict[str, set] = {}
    try:
        container = cdb._database.get_container_client("chat_threads_v1")
        for row in container.query_items(
            query="SELECT c.userId, c.agentId FROM c", enable_cross_partition_query=True
        ):
            agent, user = row.get("agentId"), row.get("userId")
            if agent and user:
                mapping.setdefault(agent, set()).add(user)
    except Exception as exc:
        logger.warning("could not map thread scopes: %s", exc)
    return mapping


# ---------------------------------------------------------------- blob


def blob_service():
    from azure.storage.blob import BlobServiceClient
    from common_azure_auth import get_sync_credential

    return BlobServiceClient(
        account_url=f"https://{STORAGE_ACCOUNT}.blob.core.windows.net",
        credential=get_sync_credential(),
    )


def upload_tree(root: Path) -> int:
    service = blob_service()
    try:
        service.create_container(ARCHIVE_CONTAINER)
        logger.info("created container %s", ARCHIVE_CONTAINER)
    except Exception:
        logger.info("container %s already exists", ARCHIVE_CONTAINER)

    container = service.get_container_client(ARCHIVE_CONTAINER)
    uploaded = 0
    for path in sorted(root.rglob("*")):
        if path.is_file():
            blob_name = path.relative_to(root).as_posix()
            with path.open("rb") as handle:
                container.upload_blob(name=blob_name, data=handle, overwrite=True)
            uploaded += 1
    return uploaded


def verify_archive(root: Path, manifest: Dict[str, Any]) -> bool:
    """Re-read the archive from blob and check it against the manifest."""
    container = blob_service().get_container_client(ARCHIVE_CONTAINER)
    remote = {b.name: b.size for b in container.list_blobs()}

    ok = True
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        name = path.relative_to(root).as_posix()
        if name not in remote:
            logger.error("MISSING in archive: %s", name)
            ok = False
        elif remote[name] != path.stat().st_size:
            logger.error("SIZE MISMATCH: %s local=%d remote=%d",
                         name, path.stat().st_size, remote[name])
            ok = False

    # An agent that is genuinely empty upstream is a faithful export, not a
    # failure — only a source we could not read is.
    for agent in manifest["agents"]:
        broken = [k for k, v in agent["sources"].items() if str(v).startswith("FAILED")]
        if broken:
            logger.error("UNREADABLE SOURCES for %s: %s", agent["agentName"], ", ".join(broken))
            ok = False
        elif not agent["hasInstructions"]:
            logger.warning("%s has no instructions upstream (exported as empty)",
                           agent["agentName"])
    return ok


# ---------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-memories", action="store_true")
    args = parser.parse_args()

    from azure.ai.projects import AIProjectClient
    from common_azure_auth import get_sync_credential

    if STAGING.exists():
        shutil.rmtree(STAGING, ignore_errors=True)
    (STAGING / "agents").mkdir(parents=True, exist_ok=True)

    project_client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=get_sync_credential())

    logger.info("=== Cosmos snapshot ===")
    counts = snapshot_cosmos(STAGING / "cosmos")

    scopes = {} if args.skip_memories else scopes_per_agent()
    memory_mgr = None
    if not args.skip_memories:
        try:
            from azure_services.tools.memory.memory_store_manager import MemoryStoreManager

            memory_mgr = MemoryStoreManager(PROJECT_ENDPOINT)
        except Exception as exc:
            logger.warning("memory store manager unavailable, skipping memories: %s", exc)

    logger.info("=== TA agent bundles ===")
    ta_names = list_ta_agents(project_client)
    agent_summaries = []
    for name in ta_names:
        bundle = export_agent(project_client, name, scopes, memory_mgr)
        (STAGING / "agents" / f"{name}.json").write_text(
            json.dumps(bundle, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        instructions = ((bundle.get("foundryDefinition") or {}).get("instructions") or "")
        summary = {
            "agentName": name,
            "hasInstructions": bool(instructions.strip()),
            "instructionChars": len(instructions),
            "toolCount": len((bundle.get("foundryDefinition") or {}).get("tools") or []),
            "hasSetup": bool(bundle.get("agentSetup")),
            "hasCurriculum": bool(bundle.get("courseCurriculum")),
            "memoryScopes": len(bundle.get("memories") or []),
            "sources": bundle["sources"],
        }
        agent_summaries.append(summary)
        logger.info(
            "  %-58s instr=%-6d tools=%-2d setup=%-5s curr=%-5s mem=%d",
            name, summary["instructionChars"], summary["toolCount"],
            summary["hasSetup"], summary["hasCurriculum"], summary["memoryScopes"],
        )

    manifest = {
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "projectEndpoint": PROJECT_ENDPOINT,
        "storageAccount": STORAGE_ACCOUNT,
        "cosmosDatabase": os.getenv("COSMOS_DATABASE", "ekalaiva"),
        "cosmosCounts": counts,
        "cosmosTotal": sum(counts.values()),
        "taAgentCount": len(ta_names),
        "protectedAgents": sorted(PROTECTED_AGENTS),
        "agents": agent_summaries,
    }
    (STAGING / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    logger.info("=== uploading to %s ===", ARCHIVE_CONTAINER)
    uploaded = upload_tree(STAGING)
    logger.info("  uploaded %d blobs", uploaded)

    logger.info("=== verifying archive ===")
    ok = verify_archive(STAGING, manifest)

    print("\n" + "=" * 62)
    print(f"cosmos documents archived : {manifest['cosmosTotal']}")
    print(f"TA agent bundles          : {len(agent_summaries)}")
    print(f"bundles with instructions : "
          f"{sum(1 for a in agent_summaries if a['hasInstructions'])}/{len(agent_summaries)}")
    print(f"bundles with setup.json   : "
          f"{sum(1 for a in agent_summaries if a['hasSetup'])}/{len(agent_summaries)}")
    print(f"bundles with curriculum   : "
          f"{sum(1 for a in agent_summaries if a['hasCurriculum'])}/{len(agent_summaries)}")
    print(f"memory scopes captured    : "
          f"{sum(a['memoryScopes'] for a in agent_summaries)}")
    unreadable = sum(
        1 for a in agent_summaries
        if any(str(v).startswith("FAILED") for v in a["sources"].values())
    )
    print(f"bundles with read errors  : {unreadable}")
    print(f"blobs uploaded            : {uploaded}")
    print(f"VERIFICATION              : {'PASS' if ok else 'FAIL'}")
    print("=" * 62)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
