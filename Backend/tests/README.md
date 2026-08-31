# tests

Pytest suite for the backend.

```bash
cd Backend
PYTHONPATH=. python -m pytest tests/ -q
```

The suite reports **two independent counts**, for example `73 passed, 85 subtests
passed`. The second is not a subset of the first.

Several modules import the Azure configuration chain, so the variables marked
`[REQUIRED]` in [../.env.example](../.env.example) must be set. Placeholder values are
sufficient — **no test makes a live Azure call**. The `env` block in
[../../.github/workflows/ci.yml](../../.github/workflows/ci.yml) is a known-good set.

## What is covered

| Test | Guards |
| --- | --- |
| [test_tool_definitions.py](test_tool_definitions.py) | Contract tests for the tool definition registry — the strongest guardrail against tool/definition drift. |
| [test_progress_inference.py](test_progress_inference.py) | Server-side topic-progress inference. |
| [test_concept_inventory_mapping.py](test_concept_inventory_mapping.py) | Concept-inventory to threshold-concept mapping. |
| [test_quiz_first_attempts.py](test_quiz_first_attempts.py) | First-attempt quiz scoring. |
| [test_plain_text_emission.py](test_plain_text_emission.py) | Assistant prose survives turns that also call tools. |
| [test_general_agent_web_search.py](test_general_agent_web_search.py) | Automatic live web grounding in `GeneralAgent`. |
| [test_research_context_injection.py](test_research_context_injection.py) | Research context reaches the agent. |
| [test_teacher_insights_evidence.py](test_teacher_insights_evidence.py) | Teacher-scoped, multi-source learning evidence. |
| [test_teacher_activity_analytics.py](test_teacher_activity_analytics.py) | Teacher learning-activity analytics. |
| [test_teacher_token_analytics.py](test_teacher_token_analytics.py) | Privacy-preserving teacher token analytics. |
| [test_teacher_scope_cache.py](test_teacher_scope_cache.py) | Course-ownership scoping cache. |
| [test_secret_configuration.py](test_secret_configuration.py) | Missing secrets fail startup instead of defaulting. |
| [test_cosmos_client_singleton.py](test_cosmos_client_singleton.py) | One Cosmos client, not one per request. |
| [test_agent_list_singleflight.py](test_agent_list_singleflight.py) | Concurrent agent-list calls collapse into one upstream request. |
| [test_course_curriculum_cache.py](test_course_curriculum_cache.py) | Bounded curriculum cache behaviour. |
| [test_chat_initial_load.py](test_chat_initial_load.py) | Initial chat message window. |
| [test_tikz_retry_guard.py](test_tikz_retry_guard.py) | TikZ regeneration retry bound. |

## Conventions

- Tests must not require network access or real Azure credentials.
- Use example data — `user@example.com`, never a real address or student record.
- Several of these are **regression tests written against a specific past bug**. If one
  starts failing, read its docstring before changing the assertion; it usually documents
  the failure it exists to prevent.
