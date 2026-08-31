"""
Remove Phase 1 token-usage telemetry that was back-filled into the v2 database.

The startup reconciliation is watermark-based and incremental, so it only
back-fills when no watermark exists -- which happened once, when v2 was new.
Everything written since is genuine Phase 2 cost data.

``--before`` is therefore mandatory: without it this would delete live
telemetry. As of 2026-08-16 the v2 database held 989 records, all Phase 2, so
running this with a cutover date is expected to delete nothing.

Usage:
    python migration_v2/purge_v2_token_usage.py --before 2026-08-03            # dry run
    python migration_v2/purge_v2_token_usage.py --before 2026-08-03 --apply
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

from azure.cosmos import CosmosClient  # noqa: E402

from common_azure_auth import get_sync_credential  # noqa: E402

V2_DATABASE = os.environ["COSMOS_DATABASE_V2"]
CONTAINER = "chat_messages_v1"
PREFIX = "__token_usage__:"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--before",
        required=True,
        help="only purge records created before this UTC date, e.g. 2026-08-03",
    )
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    import datetime as dt

    boundary = dt.datetime.fromisoformat(args.before).replace(tzinfo=dt.timezone.utc)

    client = CosmosClient(
        url=os.environ["COSMOS_ENDPOINT"],
        credential=get_sync_credential(),
    )
    container = client.get_database_client(V2_DATABASE).get_container_client(CONTAINER)

    total = list(
        container.query_items(
            query="SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True
        )
    )[0]

    tagged = list(
        container.query_items(
            query="SELECT c.id, c.userId, c.createdAt FROM c WHERE STARTSWITH(c.userId, @p)",
            parameters=[{"name": "@p", "value": PREFIX}],
            enable_cross_partition_query=True,
        )
    )

    def created(doc):
        try:
            return dt.datetime.fromisoformat(str(doc.get("createdAt")).replace("Z", "+00:00"))
        except Exception:
            return None

    rows = [d for d in tagged if (c := created(d)) and c < boundary]

    print(f"{CONTAINER} in {V2_DATABASE}: {total} documents")
    print(f"  token-usage records : {len(tagged)}")
    print(f"  real chat messages  : {total - len(tagged)}")
    print(f"  created before {boundary:%Y-%m-%d}: {len(rows)}  <- purge candidates")
    print(f"  created on/after      : {len(tagged) - len(rows)}  <- live telemetry, kept")
    by_agent = Counter(r["userId"].split(PREFIX, 1)[-1] for r in rows)
    for agent, n in by_agent.most_common(6):
        print(f"      {agent:<48} {n}")

    if not rows:
        print("\n  nothing to purge.")
        return 0

    if not args.apply:
        print("\n  DRY RUN - nothing deleted. Re-run with --apply.")
        return 0

    deleted = failed = 0
    for row in rows:
        try:
            container.delete_item(item=row["id"], partition_key=row["userId"])
            deleted += 1
        except Exception:
            failed += 1

    after = list(
        container.query_items(
            query="SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True
        )
    )[0]
    remaining = len(tagged) - deleted

    print(f"\n  deleted            : {deleted}")
    print(f"  failed             : {failed}")
    print(f"  container total now: {after}")
    print(f"  token records left : {remaining}  (live Phase 2 telemetry)")
    print(f"\nRESULT: {'PASS' if failed == 0 else 'NEEDS ATTENTION'}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
