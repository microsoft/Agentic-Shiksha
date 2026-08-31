# Admin-Dashboard/backend

FastAPI analytics server for instructors and administrators. Runs as a **separate service
on port 8050**, not as part of the main backend.

```bash
cp .env.example .env
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8050
python -m pytest tests/ -q
```

| Module | Purpose |
| --- | --- |
| [main.py](main.py) | The FastAPI app and its routes. |
| [cosmos_queries.py](cosmos_queries.py) | Reads learning state from `learning_states_v1` and agent metadata. |
| [token_stats.py](token_stats.py) | Aggregates tokens and rounds per agent from Foundry. Cached for 10 minutes. |
| [groundedness_evaluator.py](groundedness_evaluator.py) | RAGAS-inspired evaluation: faithfulness, answer relevancy, context precision. |
| [research_json.py](research_json.py) | Parses structured research-agent output, with a narrow repair fallback. |
| [research_storage.py](research_storage.py) | Stores structured research results in Blob Storage. |
| [logging_agent_chat.py](logging_agent_chat.py) | Streaming chat for the analytics agent. |
| [logging_agent_tools.py](logging_agent_tools.py) | Function tools available to that agent. |
| [_check_coverage.py](_check_coverage.py) | Ad-hoc script: how many assistant messages carry `tokenUsage`. |

## Scope and access control

This service is **institution-wide**, which is exactly why its authorization matters more
than the main app's. The teacher-scoped equivalent — restricted to a teacher's own courses
— is [Backend/teacher_dashboard/](../../Backend/teacher_dashboard).

> The `/api/directory*` routes here have historically lacked session verification. Confirm
> that every route requiring an identity actually checks one before exposing this service
> beyond localhost. An unauthenticated directory route leaks real names and email
> addresses and can allow role escalation.

Evaluation runs here rather than in the main backend so scoring stays off the chat request
path. Judge prompts live in
[Backend/prompt_store/evaluation/](../../Backend/prompt_store/evaluation), and the model
is set by `AZURE_EVAL_MODEL`.

`research_json.py` repairs malformed model output deliberately: research agents return
JSON that is *usually* valid, and a hard parse failure would discard an expensive run.
Keep the repair narrow — broad repair hides real prompt regressions.
