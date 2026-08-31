"""
Phase D: delete the Phase 1 TA agents from Azure AI Foundry.

Irreversible. Every agent is re-verified against the blob archive immediately
before deletion, and refuses to run if any bundle is missing or unreadable.

Only Foundry agent definitions are removed. Student data in the frozen v1
database, the archive, the memory stores and the Search indexes are untouched.

Usage:
    python migration_v2/delete_phase1_tas.py           # dry run
    python migration_v2/delete_phase1_tas.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

ARCHIVE_CONTAINER = "phase1-archive"
STORAGE_ACCOUNT = os.environ["STORAGE_ACCOUNT_NAME"]
PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]

# Meta agents whose names also begin with "course-". A naive prefix filter would
# take the course builder and the conversational agent out with the TAs.
PROTECTED = {
    "course-agent-creation-agent",
    "course-conversational-agent",
    "temp-course-agent",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    from azure.ai.projects import AIProjectClient
    from azure.storage.blob import BlobServiceClient

    from common_azure_auth import get_sync_credential

    credential = get_sync_credential()
    blob = BlobServiceClient(
        account_url=f"https://{STORAGE_ACCOUNT}.blob.core.windows.net", credential=credential
    ).get_container_client(ARCHIVE_CONTAINER)
    project = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)

    manifest = json.loads(blob.get_blob_client("manifest.json").download_blob().readall())
    archived = {a["agentName"] for a in manifest["agents"]}
    print(f"archive manifest lists {len(archived)} TA bundles")

    live = set()
    for agent in project.agents.list():
        name = getattr(agent, "name", None) or getattr(agent, "id", None)
        if name:
            live.add(str(name))

    targets = sorted(n for n in live if n.startswith("course-") and n not in PROTECTED)

    print("\n=== safety checks ===")
    protected_live = sorted(PROTECTED & live)
    print(f"  protected agents present and excluded : {len(protected_live)} -> {protected_live}")

    not_archived = [n for n in targets if n not in archived]
    if not_archived:
        print(f"  *** {len(not_archived)} target(s) have NO archive bundle: {not_archived}")
        print("  refusing to delete anything.")
        return 1
    print(f"  every target has an archive bundle    : {len(targets)}/{len(targets)}")

    print("\n=== re-verifying each bundle reads back from the archive ===")
    bad = []
    for name in targets:
        try:
            raw = blob.get_blob_client(f"agents/{name}.json").download_blob().readall()
            bundle = json.loads(raw)
            broken = [k for k, v in bundle.get("sources", {}).items() if str(v).startswith("FAILED")]
            if broken:
                bad.append((name, f"unreadable sources: {broken}"))
            elif bundle.get("foundryDefinition") is None:
                bad.append((name, "no foundryDefinition"))
        except Exception as exc:
            bad.append((name, f"archive read failed: {exc}"))
    if bad:
        print(f"  *** {len(bad)} bundle(s) failed verification:")
        for name, why in bad:
            print(f"      {name}: {why}")
        print("  refusing to delete anything.")
        return 1
    print(f"  all {len(targets)} bundles verified readable")

    print(f"\n=== {len(targets)} agents to delete ===")
    for name in targets:
        print(f"    {name}")

    if not args.apply:
        print("\n  DRY RUN - nothing deleted. Re-run with --apply.")
        return 0

    print("\n=== deleting ===")
    deleted, failed = [], []
    for name in targets:
        try:
            project.agents.delete(agent_name=name)
            deleted.append(name)
            print(f"    deleted {name}")
        except Exception as exc:
            failed.append((name, str(exc)[:120]))
            print(f"    FAILED  {name}: {str(exc)[:120]}")

    print("\n=== verification ===")
    remaining = set()
    for agent in project.agents.list():
        n = getattr(agent, "name", None) or getattr(agent, "id", None)
        if n:
            remaining.add(str(n))
    still_there = sorted(n for n in remaining if n.startswith("course-") and n not in PROTECTED)
    survived_protected = sorted(PROTECTED & remaining)

    print(f"  deleted                     : {len(deleted)}")
    print(f"  failed                      : {len(failed)}")
    print(f"  TA agents still present     : {len(still_there)} {still_there if still_there else ''}")
    print(f"  protected agents intact     : {len(survived_protected)} -> {survived_protected}")
    print(f"  total agents remaining      : {len(remaining)}")

    ok = not failed and not still_there and len(survived_protected) == len(PROTECTED & (remaining | PROTECTED))
    print(f"\nRESULT: {'PASS' if ok else 'NEEDS ATTENTION'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
