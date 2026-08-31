from unittest.mock import patch

from base_agents.general_agent import (
    _RESEARCH_CONTEXT_MAX_CHARS,
    _profile_research_instructions,
    _research_context,
)


def test_structured_research_is_injected_for_both_scopes():
    institute = {
        "status": "completed",
        "research_type": "institute",
        "institute_name": "IIT Kharagpur",
        "profile": {
            "name": "Indian Institute of Technology Kharagpur",
            "location": "Kharagpur, West Bengal, India",
        },
        "academic_system": {"grading_system": "10-point CGPA"},
    }
    department = {
        "status": "completed",
        "research_type": "department",
        "department_name": "Physics",
        "profile": {"name": "Department of Physics"},
        "research": {"focus_areas": ["Condensed matter physics"]},
    }

    with (
        patch(
            "azure_services.persistence.cosmos_db.get_institute_research",
            return_value=institute,
        ),
        patch(
            "azure_services.persistence.cosmos_db.get_department_research",
            return_value=department,
        ),
    ):
        context = _profile_research_instructions({
            "college": "IIT Kharagpur",
            "department": "Physics",
        })

    assert "Institute context (IIT Kharagpur)" in context
    assert "Indian Institute of Technology Kharagpur" in context
    assert "Department context (Physics at IIT Kharagpur)" in context
    assert "Department of Physics" in context


def test_legacy_research_is_supported_and_failed_research_is_excluded():
    assert _research_context({"status": "completed", "result": "legacy context"}) == (
        "legacy context"
    )
    assert _research_context({"status": "failed", "result": "do not inject"}) is None


def test_structured_research_context_is_bounded():
    context = _research_context({
        "status": "completed",
        "profile": {"description": "x" * (_RESEARCH_CONTEXT_MAX_CHARS * 2)},
    })

    assert context.endswith("...[truncated]")
    assert len(context) <= _RESEARCH_CONTEXT_MAX_CHARS + len("...[truncated]")