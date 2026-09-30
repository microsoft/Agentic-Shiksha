"""Explicit, dry-run-first graph-memory administration; never imported by the app."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument(
        "operation",
        choices=["validate", "provision", "register-scope", "import-curriculum", "import-evidence", "publish", "recompute", "verify"],
    )
    result.add_argument("--input", type=Path, help="Explicit JSON graph, scope registry, learner scope, or legacy curriculum")
    result.add_argument("--output", type=Path, help="New local draft file; existing files are never overwritten")
    result.add_argument("--tenant-id")
    result.add_argument("--institute-id")
    result.add_argument("--course-id")
    result.add_argument("--curriculum-id")
    result.add_argument("--version")
    result.add_argument("--apply", action="store_true", help="Authorize the selected writes/remote reads; omitted means dry run")
    return result


def _input(arguments) -> dict:
    if arguments.input is None:
        raise ValueError("--input is required")
    if arguments.input.stat().st_size > 2_000_000:
        raise ValueError("Migration input exceeds the configured file limit")
    content = json.loads(arguments.input.read_text(encoding="utf-8"))
    if not isinstance(content, dict):
        raise ValueError("Migration input must be a JSON object")
    return content


def provision(settings) -> dict:
    from azure.core.exceptions import ResourceExistsError
    from azure.cosmos import PartitionKey
    from azure_services.persistence.cosmos_db import COSMOS_DATABASE, _get_blob_service_client, get_cosmos_client

    database = get_cosmos_client().get_database_client(COSMOS_DATABASE)
    for name in (settings.graph_container_name, settings.learner_container_name):
        container = database.create_container_if_not_exists(
            id=name, partition_key=PartitionKey(path="/partitionKey"), default_ttl=-1,
        )
        properties = container.read()
        if properties.get("partitionKey", {}).get("paths") != ["/partitionKey"]:
            raise ValueError("An existing target container has an incompatible partition key")
        if properties.get("defaultTtl") not in {None, -1}:
            raise ValueError("An existing target container has destructive automatic expiration")
    blobs = _get_blob_service_client().get_container_client(settings.evidence_container_name)
    try:
        blobs.create_container()
    except ResourceExistsError:
        pass
    if blobs.get_container_properties().get("public_access"):
        raise ValueError("Evidence container already exists with public access; correct it before activation")
    return {"status": "provisioned", "containers": 2, "private_evidence_container": True}


def execute(arguments) -> dict:
    from backend.schemas.learner_memory import CurriculumGraph, MemoryScope
    from learner_memory.settings import get_memory_settings

    settings = get_memory_settings()
    if arguments.operation == "provision":
        if not arguments.apply:
            return {
                "dry_run": True, "operation": "provision",
                "cosmos_containers": [settings.graph_container_name, settings.learner_container_name],
                "partition_key": "/partitionKey", "ttl": "never",
                "private_blob_container": settings.evidence_container_name,
            }
        return provision(settings)

    payload = _input(arguments)
    if arguments.operation in {"validate", "publish"}:
        from learner_memory.curriculum import validate_graph

        graph = CurriculumGraph.model_validate(payload)
        validate_graph(graph)
        if arguments.operation == "validate" or not arguments.apply:
            return {
                "valid": True, "dry_run": not arguments.apply,
                "graph_hash": graph.content_hash, "nodes": len(graph.nodes), "edges": len(graph.edges),
                "status": graph.status.value,
            }
        from learner_memory.service import get_service

        published = get_service().publish_graph(graph)
        return {"status": "published", "graph_hash": published.content_hash, "version": published.version}

    if arguments.operation == "import-curriculum":
        from learner_memory.curriculum import import_legacy_curriculum

        if not all((arguments.tenant_id, arguments.institute_id, arguments.course_id, arguments.curriculum_id, arguments.version)):
            raise ValueError("Legacy import needs explicit tenant, institute, course, curriculum and version IDs")
        graph = import_legacy_curriculum(
            payload, tenant_id=arguments.tenant_id, institute_id=arguments.institute_id,
            course_id=arguments.course_id, curriculum_id=arguments.curriculum_id, version=arguments.version,
        )
        if arguments.output and arguments.apply:
            with arguments.output.open("x", encoding="utf-8") as output:
                output.write(graph.model_dump_json(indent=2))
                output.write("\n")
        return {
            "dry_run": not arguments.apply, "status": "draft_requires_review",
            "nodes": len(graph.nodes), "edges": len(graph.edges),
            "source_hash": graph.provenance.source_content_hash,
            "output_written": bool(arguments.output and arguments.apply),
            "learner_states_imported": 0,
        }

    if arguments.operation == "register-scope":
        required = {"tenant_id", "institute_id", "administrator_ids"}
        if set(payload) != required or not isinstance(payload["administrator_ids"], list) or not payload["administrator_ids"]:
            raise ValueError("Scope input requires tenant_id, institute_id and nonempty administrator_ids only")
        if not arguments.apply:
            return {"dry_run": True, "operation": "register-scope", "administrator_count": len(payload["administrator_ids"])}
        from learner_memory.service import get_service

        get_service().register_scope(**payload)
        return {"status": "scope_registered", "administrator_count": len(payload["administrator_ids"])}

    if arguments.operation == "import-evidence":
        scope = MemoryScope.model_validate(payload.get("scope"))
        records = payload.get("records")
        if not isinstance(records, list) or not records or any(not isinstance(record, dict) for record in records):
            raise ValueError("Evidence import requires a scope and a nonempty list of exported records")
        if not arguments.apply:
            return {"dry_run": True, "operation": "import-evidence", "records": len(records), "qualifying": False}
        from learner_memory.service import get_service

        receipts = get_service().import_legacy_evidence(scope, records)
        return {"status": "accepted", "receipts": len(receipts), "qualifying": False}

    scope = MemoryScope.model_validate(payload)
    if not arguments.apply:
        return {"dry_run": True, "operation": arguments.operation, "scope_ref": scope.partition_key}
    from learner_memory.service import get_service

    service = get_service()
    if arguments.operation == "verify":
        graph = service.get_graph(scope)
        snapshot = service.get_snapshot(scope)
        return {
            "status": "verified", "graph_hash": graph.content_hash,
            "snapshot_version": snapshot.snapshot_version, "pending_events": service.pending_count(scope),
        }
    receipt = service.recompute(scope)
    return {"status": receipt.status.value, "event_id": receipt.event_id, "note": "Queued; the durable worker performs replay."}


def main(argv: list[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    try:
        result = execute(arguments)
    except (ValueError, OSError) as error:
        print(json.dumps({"status": "rejected", "error_type": type(error).__name__}), file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
