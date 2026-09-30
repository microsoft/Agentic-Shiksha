import json

import pytest

from backend.schemas.learner_memory import CurriculumGraph
from scripts import graph_memory as migration
from test_graph_memory_processing import SCOPE, service_fixture


def test_provision_is_dry_run_by_default(monkeypatch):
    def forbidden(_settings):
        raise AssertionError("Dry-run provisioning must not call Azure")

    monkeypatch.setattr(migration, "provision", forbidden)
    result = migration.execute(migration.parser().parse_args(["provision"]))
    assert result["dry_run"] is True
    assert result["partition_key"] == "/partitionKey"
    assert len(result["cosmos_containers"]) == 2


def test_validate_does_not_need_a_cloud_connection(tmp_path):
    _service, _repository, _extractor, graph = service_fixture()
    path = tmp_path / "graph.json"
    path.write_text(graph.model_dump_json(), encoding="utf-8")
    result = migration.execute(migration.parser().parse_args(["validate", "--input", str(path)]))
    assert result["valid"] is True
    assert result["graph_hash"] == graph.content_hash


def test_legacy_import_writes_only_an_explicit_new_draft_file(tmp_path):
    source = tmp_path / "legacy.json"
    output = tmp_path / "draft.json"
    source.write_text(json.dumps({
        "all_threshold_concepts": ["Paths"],
        "Paths": {
            "description": "Paths and walks",
            "misconceptions": [{"misconception": "Paths may repeat vertices"}],
            "concept_inventory_questions": [],
        },
    }), encoding="utf-8")
    arguments = migration.parser().parse_args([
        "import-curriculum", "--input", str(source), "--output", str(output),
        "--tenant-id", "tenant-test", "--institute-id", "institute-test",
        "--course-id", "offering", "--curriculum-id", "curriculum", "--version", "import-v1",
    ])
    result = migration.execute(arguments)
    assert result["dry_run"] is True
    assert not output.exists()
    arguments.apply = True
    migration.execute(arguments)
    draft = CurriculumGraph.model_validate_json(output.read_text(encoding="utf-8"))
    assert draft.status == "DRAFT"
    assert draft.published_ready is False
    assert draft.policies.teacher_reviewed is False
    original = output.read_bytes()
    with pytest.raises(FileExistsError):
        migration.execute(arguments)
    assert output.read_bytes() == original


def test_old_learned_claims_are_nonqualifying_append_only_evidence():
    service, repository, _extractor, _graph = service_fixture()
    records = [{
        "id": "legacy-profile", "createdAt": "2025-01-01T00:00:00Z",
        "threshold_concepts": {"Walks and paths": {"status": "learned", "misconceptions_addressed": ["Wrong belief M1"]}},
    }]
    receipts = service.import_legacy_evidence(SCOPE, records)
    service.process_event(SCOPE, receipts[0].event_id)
    assert service.get_snapshot(SCOPE).profile.crossed_tcs == []
    duplicate = service.import_legacy_evidence(SCOPE, records)
    assert duplicate[0].event_id == receipts[0].event_id
    evidence = [record["payload"] for record in repository.records.values() if record["record_type"] == "evidence"]
    assert len(evidence) == 1
    assert evidence[0]["source"] == "LEGACY_IMPORT"
    assert evidence[0]["quality"]["catalog_approved"] is False
    assert evidence[0]["occurred_at"].startswith("2025-01-01")
