# tests

Pytest suite for the Admin Dashboard backend.

```bash
cd Admin-Dashboard/backend
python -m pytest tests/ -q
```

| Test | Guards |
| --- | --- |
| [test_research_json.py](test_research_json.py) | Structured research output parses, and the repair fallback stays narrow. |

`research_json.py` repairs malformed model output. These tests pin how far that repair
goes: it should rescue a run that emitted *nearly* valid JSON, and it should still fail on
output that is genuinely wrong. A repair that swallows everything hides prompt
regressions instead of surfacing them.

As in the main backend, tests must not require network access or real Azure credentials,
and must use example data rather than real user records.
