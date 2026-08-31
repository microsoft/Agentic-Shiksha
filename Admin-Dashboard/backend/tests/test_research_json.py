import json

import pytest

from research_json import parse_research_json


def test_parses_fenced_json_and_trailing_comma():
    result = parse_research_json('```json\n{"research_type":"department",}\n```')

    assert result == {"research_type": "department"}


def test_repairs_unescaped_narrative_quotes():
    result = parse_research_json(
        '{"profile":{"description":"The lab is known as "Quantum Hub" on campus"}}'
    )

    assert result["profile"]["description"] == 'The lab is known as "Quantum Hub" on campus'


def test_rejects_non_json_refusal():
    with pytest.raises(json.JSONDecodeError):
        parse_research_json("I'm sorry, but I cannot assist with that request.")