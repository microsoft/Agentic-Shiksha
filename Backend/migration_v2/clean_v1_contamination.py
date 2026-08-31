"""
Remove documents written to the frozen v1 database after the 2026-08-03 cutover.

A document is only deleted when BOTH hold:
  1. its id is absent from the phase1-archive dump for that container, and
  2. its _ts is after the cutover.

The archive is the authoritative record of Phase 1, so requiring both means a
genuine Phase 1 document can never be removed by a clock or timezone mistake.

Usage:
    python migration_v2/clean_v1_contamination.py            # dry run
    python migration_v2/clean_v1_contamination.py --apply
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import sys
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")
logging.disable(logging.WARNING)

from azure.cosmos import CosmosClient  # noqa: E402
from azure.storage.blob import BlobServiceClient  # noqa: E402

from common_azure_auth import get_sync_credential  # noqa: E402

V1_DATABASE = "ekalaiva"
ARCHIVE_CONTAINER = "phase1-archive"
STORAGE_ACCOUNT = os.environ["STORAGE_ACCOUNT_NAME"]

# The archive snapshot completed shortly before this; anything newer is Phase 2.
CUTOVER = dt.datetime(2026, 8, 3, 16, 0, tzinfo=dt.timezone.utc)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    credential = get_sync_credential()
    archive = BlobServiceClient(
        account_url=f"https://{STORAGE_ACCOUNT}.blob.core.windows.net", credential=credential
    ).get_container_client(ARCHIVE_CONTAINER)
    database = CosmosClient(
        url=os.environ["COSMOS_ENDPOINT"],
        credential=credential,
    ).get_database_client(V1_DATABASE)

    cutover_ts = int(CUTOVER.timestamp())
    grand_total = 0
    plan = []

    print(f"cutover: {CUTOVER:%Y-%m-%d %H:%M} UTC\n")
    print(f"{'container':<32}{'live':>7}{'archived':>10}{'extra':>7}{'to delete':>11}")
    print("-" * 68)

    for meta in sorted(database.list_containers(), key=lambda c: c["id"]):
        name = meta["id"]
        pk_field = meta["partitionKey"]["paths"][0].lstrip("/")
        container = database.get_container_client(name)

        try:
            raw = archive.get_blob_client(f"cosmos/{name}.ndjson").download_blob().readall()
        except Exception:
            print(f"{name:<32}{'-':>7}{'NO ARCHIVE - skipped':>28}")
            continue

        archived_ids = {
            json.loads(line)["id"] for line in raw.decode("utf-8").splitlines() if line.strip()
        }

        live = list(
            container.query_items(
                query=f"SELECT c.id, c._ts, c.userId, c.recordType, c.{pk_field} AS pk FROM c",
                enable_cross_partition_query=True,
            )
        )
        extra = [d for d in live if d["id"] not in archived_ids]
        doomed = [d for d in extra if d["_ts"] > cutover_ts]

        print(f"{name:<32}{len(live):>7}{len(archived_ids):>10}{len(extra):>7}{len(doomed):>11}")

        # An unarchived doc that predates the cutover would mean the archive is
        # incomplete; never delete those, but do surface them.
        stale = [d for d in extra if d["_ts"] <= cutover_ts]
        if stale:
            print(f"{'':<32}  {len(stale)} unarchived but PRE-cutover - left alone, investigate")

        if doomed:
            kinds = Counter(
                "token_usage"
                if str(d.get("userId", "")).startswith("__token_usage__")
                else "real data"
                for d in doomed
            )
            newest = dt.datetime.fromtimestamp(max(d["_ts"] for d in doomed), dt.timezone.utc)
            print(f"{'':<32}  {dict(kinds)}  newest={newest:%Y-%m-%d %H:%M} UTC")
            plan.append((name, pk_field, doomed))
            grand_total += len(doomed)

    print("-" * 68)
    print(f"total to delete: {grand_total}")

    if not grand_total:
        print("\nv1 already matches the archive.")
        return 0

    if not args.apply:
        print("\nDRY RUN - nothing deleted. Re-run with --apply.")
        return 0

    # Six of these are genuine user content that landed in the wrong database,
    # so keep a copy before removing anything.
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_name = f"contamination-removed-{stamp}.ndjson"
    lines = []
    for name, _pk, docs in plan:
        container = database.get_container_client(name)
        for doc in docs:
            try:
                full = container.read_item(item=doc["id"], partition_key=doc.get("pk"))
                lines.append(json.dumps({"_container": name, **full}, ensure_ascii=False))
            except Exception as exc:
                print(f"  could not back up {name}/{doc['id']}: {str(exc)[:80]}")
    archive.upload_blob(
        name=backup_name, data="\n".join(lines).encode("utf-8"), overwrite=True
    )
    readback = archive.get_blob_client(backup_name).download_blob().readall()
    backed_up = len([x for x in readback.decode("utf-8").splitlines() if x.strip()])
    print(f"\nbacked up {backed_up}/{grand_total} docs to {ARCHIVE_CONTAINER}/{backup_name}")
    if backed_up != grand_total:
        print("backup incomplete - refusing to delete.")
        return 1

    print("\ndeleting...")
    deleted = failed = 0
    for name, pk_field, docs in plan:
        container = database.get_container_client(name)
        for doc in docs:
            try:
                container.delete_item(item=doc["id"], partition_key=doc.get("pk"))
                deleted += 1
            except Exception as exc:
                failed += 1
                if failed <= 3:
                    print(f"  failed {name}/{doc['id']}: {str(exc)[:90]}")
        print(f"  {name}: done")

    total_after = 0
    for meta in database.list_containers():
        total_after += list(
            database.get_container_client(meta["id"]).query_items(
                query="SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True
            )
        )[0]

    print(f"\n  deleted        : {deleted}")
    print(f"  failed         : {failed}")
    print(f"  v1 total now   : {total_after}")
    print(f"\nRESULT: {'PASS' if failed == 0 else 'NEEDS ATTENTION'}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
