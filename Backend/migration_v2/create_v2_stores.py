"""
Phase B of the v1 freeze / v2 cutover: stand up the empty v2 stores.

Creates the ``COSMOS_DATABASE_V2`` Cosmos database by mirroring each live v1 container
definition (partition key copied from source, never transcribed), creates the
v2 blob containers, and seeds the bootstrap admin.

The seed is not optional. Login checks invited_users then users and denies on a
miss, with no super-admin bypass, so an empty directory locks everyone out --
including the account needed to invite anyone back.

Read-only against v1. Usage:
    python migration_v2/create_v2_stores.py [--apply]
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

from azure.cosmos import CosmosClient, PartitionKey  # noqa: E402
from azure.cosmos.exceptions import CosmosResourceExistsError  # noqa: E402

from common_azure_auth import get_sync_credential  # noqa: E402

COSMOS_ENDPOINT = os.environ["COSMOS_ENDPOINT"]
V1_DATABASE = "ekalaiva"
V2_DATABASE = os.environ["COSMOS_DATABASE_V2"]
STORAGE_ACCOUNT = os.environ["STORAGE_ACCOUNT_NAME"]

SUPER_ADMIN_EMAIL = os.environ["SUPER_ADMIN_EMAIL"]
SUPER_ADMIN_NAME = "Swapnik V"
SUPER_ADMIN_INSTITUTE = "Microsoft Research"
SUPER_ADMIN_DEPARTMENT = "MSR India"

# Referenced by the code but absent from v1, which is why /api/courses 500s today.
EXTRA_CONTAINERS = {"courses_v2": "/id"}

V2_BLOB_CONTAINERS = [
    "agent-setups-v2",
    "course-curriculum-v2",
    "institute-research-v2",
    "feedback-attachments-v2",
    "course-material-v2",
    "agent-images-v2",
    "generated-images-v2",
    "common-image-container-v2",
]


def cosmos_client() -> CosmosClient:
    return CosmosClient(url=COSMOS_ENDPOINT, credential=get_sync_credential())


def create_cosmos(apply: bool) -> None:
    client = cosmos_client()
    source = client.get_database_client(V1_DATABASE)

    definitions = {}
    for meta in sorted(source.list_containers(), key=lambda c: c["id"]):
        paths = meta["partitionKey"]["paths"]
        definitions[meta["id"]] = paths[0]
    for name, path in EXTRA_CONTAINERS.items():
        definitions.setdefault(name, path)

    print(f"=== Cosmos: {V1_DATABASE} -> {V2_DATABASE} ===")
    for name, path in definitions.items():
        origin = "from v1" if name not in EXTRA_CONTAINERS else "new (missing in v1)"
        print(f"    {name:<34} pk={path:<16} {origin}")

    if not apply:
        print("\n  dry run - nothing created. Re-run with --apply.")
        return

    # Creating databases/containers is a control-plane operation. The app's
    # principal only holds Cosmos data-plane RBAC, so anything missing here has
    # to be created through ARM (see create_v2_cosmos.ps1).
    try:
        target = client.get_database_client(V2_DATABASE)
        existing = {c["id"] for c in target.list_containers()}
    except Exception as exc:
        print(f"\n  cannot read {V2_DATABASE}: {exc}")
        print("  create it with ARM first: migration_v2/create_v2_cosmos.ps1")
        raise SystemExit(1)

    missing = [n for n in definitions if n not in existing]
    if missing:
        print(f"\n  MISSING from {V2_DATABASE}: {', '.join(sorted(missing))}")
        print("  create them with ARM first: migration_v2/create_v2_cosmos.ps1")
        raise SystemExit(1)
    print(f"\n  all {len(definitions)} containers present in {V2_DATABASE}")


def create_blobs(apply: bool) -> None:
    from azure.storage.blob import BlobServiceClient

    service = BlobServiceClient(
        account_url=f"https://{STORAGE_ACCOUNT}.blob.core.windows.net",
        credential=get_sync_credential(),
    )
    existing = {c.name for c in service.list_containers()}

    print(f"\n=== Blob containers on {STORAGE_ACCOUNT} ===")
    for name in V2_BLOB_CONTAINERS:
        if name in existing:
            print(f"    exists  {name}")
            continue
        if not apply:
            print(f"    would create {name}")
            continue
        service.create_container(name)
        print(f"    created {name}")


def seed_admin(apply: bool) -> None:
    print(f"\n=== Bootstrap admin: {SUPER_ADMIN_EMAIL} ===")
    if not apply:
        print("    would seed into invited_users_v1 (dry run)")
        return

    container = (
        cosmos_client().get_database_client(V2_DATABASE).get_container_client("invited_users_v1")
    )
    email = SUPER_ADMIN_EMAIL.lower().strip()
    existing = list(
        container.query_items(
            query="SELECT * FROM c WHERE c.email = @e",
            parameters=[{"name": "@e", "value": email}],
            enable_cross_partition_query=True,
        )
    )
    if existing:
        print(f"    already present (id={existing[0]['id']}, role={existing[0].get('role')})")
        return

    now = datetime.utcnow().isoformat() + "Z"
    doc = {
        "id": f"dir-{uuid.uuid4().hex[:8]}",
        "email": email,
        "name": SUPER_ADMIN_NAME,
        "role": "admin",
        "status": "invited",
        "institute": SUPER_ADMIN_INSTITUTE,
        "department": SUPER_ADMIN_DEPARTMENT,
        "affiliations": [
            {
                "institute": SUPER_ADMIN_INSTITUTE,
                "department": SUPER_ADMIN_DEPARTMENT,
                "role": "admin",
            }
        ],
        "activeAffiliation": 0,
        "createdAt": now,
        "updatedAt": now,
    }
    container.upsert_item(body=doc)

    readback = list(
        container.query_items(
            query="SELECT * FROM c WHERE c.email = @e",
            parameters=[{"name": "@e", "value": email}],
            enable_cross_partition_query=True,
        )
    )
    print(f"    seeded and read back: {bool(readback)} (role={readback[0].get('role') if readback else '?'})")


def verify() -> None:
    client = cosmos_client()
    print("\n=== Verification ===")
    v1 = client.get_database_client(V1_DATABASE)
    v1_counts = {}
    for meta in sorted(v1.list_containers(), key=lambda c: c["id"]):
        n = list(
            v1.get_container_client(meta["id"]).query_items(
                query="SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True
            )
        )[0]
        v1_counts[meta["id"]] = n

    try:
        v2 = client.get_database_client(V2_DATABASE)
        containers = sorted(c["id"] for c in v2.list_containers())
    except Exception as exc:
        print(f"    v2 database not readable: {exc}")
        return

    print(f"    {'container':<34} {'v1':>7} {'v2':>7}")
    for name in sorted(set(v1_counts) | set(containers)):
        n2 = "-"
        if name in containers:
            n2 = list(
                v2.get_container_client(name).query_items(
                    query="SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True
                )
            )[0]
        print(f"    {name:<34} {v1_counts.get(name, '-'):>7} {n2:>7}")
    print(f"\n    v1 total unchanged: {sum(v1_counts.values())}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually create resources")
    args = parser.parse_args()

    create_cosmos(args.apply)
    create_blobs(args.apply)
    seed_admin(args.apply)
    if args.apply:
        verify()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
