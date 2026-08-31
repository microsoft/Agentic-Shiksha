# teacher_dashboard

Teacher-scoped analytics over student learning progress. Merged into the main backend and
served under `/api/teacher-dashboard`, so it shares the app's process, session cookie and
Cosmos client.

Not to be confused with [Admin-Dashboard/](../../Admin-Dashboard), which is a separate
service on its own port for institution-wide administration.

| Module | Purpose |
| --- | --- |
| [routes.py](routes.py) | The API surface mounted into the main app. |
| [teacher_auth.py](teacher_auth.py) | Resolves identity from the session JWT issued by [../auth.py](../auth.py). |
| [teacher_scope.py](teacher_scope.py) | Restricts every query to the courses the calling teacher owns. |
| [cosmos_queries.py](cosmos_queries.py) | Reads learning-state documents and agent metadata from Cosmos. |
| [token_stats.py](token_stats.py) | Persists and aggregates token usage. |
| [logging_agent_chat.py](logging_agent_chat.py) | Streaming chat for the analytics agent. |
| [logging_agent_tools.py](logging_agent_tools.py) | Read-only function tools the analytics agent may call. |
| [INSIGHTS_EVIDENCE.md](INSIGHTS_EVIDENCE.md) | How an insight traces back to the evidence behind it. |

## Access control

Two independent checks, and both matter:

1. `teacher_auth.py` verifies the session token with the **same `JWT_SECRET`** as
   [../auth.py](../auth.py). If the two ever diverge, every teacher request fails to
   authenticate.
2. `teacher_scope.py` narrows results to owned courses. A teacher must not be able to read
   another teacher's cohort, so scoping is applied in the query rather than filtered
   afterwards.

Token analytics are aggregated rather than per-student-identifiable — see
[test_teacher_token_analytics.py](../tests/test_teacher_token_analytics.py) for the
contract that enforces this.

## Token accounting

Live chat streams write immutable response-level usage events immediately. A single
startup reconciliation then reads only what is newer than the stored watermark, so it is
incremental and will not re-import history on every restart.
