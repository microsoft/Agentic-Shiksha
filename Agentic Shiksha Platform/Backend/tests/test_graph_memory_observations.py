from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock
import json

import pytest
from pydantic import ValidationError

from backend.schemas.learner_memory import CurriculumGraph, CurriculumNode, Evidence, MemoryScope
from learner_memory.observations import (
    FoundryObservationExtractor,
    ProposedJudgment,
    ProposedObservationSet,
    proposals_to_observations,
)


NOW = datetime(2026, 1, 10, tzinfo=timezone.utc)


def inputs():
    scope = MemoryScope(
        tenant_id="tenant-a", institute_id="institute-a", course_id="course-a",
        student_id="student-a", curriculum_id="graphs", curriculum_version="v1",
    )
    graph = CurriculumGraph(
        tenant_id="tenant-a", curriculum_id="graphs", version="v1",
        institute_ids=("institute-a",), course_name="Graphs",
        nodes=(
            CurriculumNode(type="TC", id="TC7", name="Paths"),
            CurriculumNode(type="MISCONCEPTION", id="M1", name="Path and walk confusion"),
        ),
    )
    evidence = Evidence(
        evidence_id="E1", event_id="EV1", scope=scope, source="LEARNER_CHAT",
        occurred_at=NOW, answer="A walk can repeat a vertex.",
    )
    return scope, graph, evidence


def judgment(**changes):
    return ProposedJudgment(**{
        "evidence_id": "E1", "claim": "Distinguishes a walk in this explanation.",
        "quote": "A walk can repeat a vertex.", "supports": [], "contradicts": ["M1"],
        "reasoning_result": "AMBIGUOUS", "confidence": 0.8, "rubric_dimensions": [],
        "concept_result": "AMBIGUOUS", "transfer_result": "INSUFFICIENT_EVIDENCE",
        **changes,
    })


def test_interpretation_schema_cannot_contain_state_mutations():
    with pytest.raises(ValidationError):
        ProposedJudgment.model_validate({**judgment().model_dump(), "threshold_state": "CROSSED"})


def test_unknown_evidence_and_invented_quotes_are_rejected():
    _scope, graph, evidence = inputs()
    for bad in (judgment(evidence_id="other-student-evidence"), judgment(quote="Invented explanation")):
        with pytest.raises(ValueError):
            proposals_to_observations(ProposedObservationSet(judgments=[bad]), [evidence], graph, NOW, model_version="test")


def test_unknown_misconception_cannot_enter_the_shared_graph():
    _scope, graph, evidence = inputs()
    with pytest.raises(ValueError, match="unknown misconception"):
        proposals_to_observations(
            ProposedObservationSet(judgments=[judgment(contradicts=["M-UNKNOWN"])]),
            [evidence], graph, NOW, model_version="test",
        )
    assert {node.id for node in graph.nodes} == {"TC7", "M1"}


def test_conversation_cannot_be_reported_as_a_qualifying_transfer():
    _scope, graph, evidence = inputs()
    for changes in ({"concept_result": "PASS"}, {"transfer_result": "PASS"}):
        with pytest.raises(ValueError):
            proposals_to_observations(
                ProposedObservationSet(judgments=[judgment(**changes)]), [evidence], graph, NOW, model_version="test",
            )


def test_extractor_uses_structured_output_no_tools_and_no_learner_identity():
    scope, graph, evidence = inputs()
    client = Mock()
    client.responses.parse.return_value = SimpleNamespace(
        status="completed", output_parsed=ProposedObservationSet(judgments=[judgment()]), model="test-deployment",
    )
    result = FoundryObservationExtractor("test-deployment", lambda: client).extract([evidence], graph, NOW)
    arguments = client.responses.parse.call_args.kwargs
    assert arguments["tools"] == []
    assert arguments["tool_choice"] == "none"
    assert arguments["store"] is False
    payload = json.loads(arguments["input"][1]["content"])
    assert "UNTRUSTED_LEARNER_EVIDENCE" in payload
    assert scope.student_id not in arguments["input"][1]["content"]
    assert result.observations[0].confidence_calibrated is False
    assert result.observations[0].source_evidence == ["E1"]


def test_incomplete_extraction_is_not_success():
    _scope, graph, evidence = inputs()
    client = Mock()
    client.responses.parse.return_value = SimpleNamespace(status="incomplete", output_parsed=None)
    with pytest.raises(ValueError, match="complete validated"):
        FoundryObservationExtractor("test", lambda: client).extract([evidence], graph, NOW)


def test_neutral_teaching_exposure_does_not_call_model():
    _scope, graph, evidence = inputs()
    evidence.source = "TEACHING_EXPOSURE"
    client = Mock()
    result = FoundryObservationExtractor("test", lambda: client).extract([evidence], graph, NOW)
    assert result.observations == []
    client.responses.parse.assert_not_called()
