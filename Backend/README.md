# Backend

FastAPI service for Agentic Shiksha. Entry point is [backend/main.py](backend/main.py),
served as `uvicorn backend.main:app`.

```bash
cp .env.example .env          # fill in your own Azure resources
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.main:app --reload
PYTHONPATH=. python -m pytest tests/ -q
```

## Layout

| Path | Purpose |
| --- | --- |
| [backend/](backend) | HTTP layer — routes, streaming, AG-UI protocol. |
| [agent_tools/](agent_tools) | Tools the agents can call. `custom/` run here, `hosted/` run in Foundry. |
| [azure_services/](azure_services) | Azure integrations: agents, persistence, storage, search, evaluation. |
| [base_agents/](base_agents) | Generic, course-independent agent runtimes. |
| [custom_agents/](custom_agents) | Course-specific teaching agent runtime. |
| [prompt_store/](prompt_store) | Agent instructions as markdown. Only `core_agent_prompts/` is loaded at runtime. |
| [teacher_dashboard/](teacher_dashboard) | Teacher-scoped analytics, mounted under `/api/teacher-dashboard`. |
| [utils/](utils) | Shared helpers — prompt assembly, TikZ rendering, document conversion. |
| [migration_v2/](migration_v2) | One-off scripts for the v1→v2 data cutover. Not imported by the app. |
| [tests/](tests) | Pytest suite. |
| [user_data/](user_data) | Local runtime cache. Git-ignored; Blob Storage is the source of truth. |

## Configuration

Copy `.env.example` to `.env`. The 31 variables marked `[REQUIRED]` are resolved at
**import time** — by [azure_services/config.py](azure_services/config.py),
[backend/main.py](backend/main.py) and [auth.py](auth.py) — so a missing one fails
startup immediately rather than surfacing later as a confusing runtime error.

Environment-specific files layer on top: `.env.<APP_ENV>` is loaded first and wins, then
`.env` fills the gaps. Real environment variables take precedence over both, so the same
container image works across environments.

> Leave blank values bare. `KEY=  # note` parses as the literal string `# note`, because
> python-dotenv only strips a trailing comment when a value precedes it.

## Authentication

Azure services are reached with Microsoft Entra ID — managed identity when deployed,
`az login` credentials locally. No service keys are required.

User sessions are separate: [auth.py](auth.py) issues an HS256 JWT signed with
`JWT_SECRET`, and [google_auth.py](google_auth.py) provides Google OAuth via the
authorization-code flow with PKCE, mirroring the Entra path.

## Notes

- Agent instructions and tool schemas are baked into a Foundry agent version at creation.
  Editing `prompt_store/` or a `definition.json` only affects **newly created** agents;
  existing ones must be re-provisioned.
- `.dockerignore` keeps `.env` out of the image — supply configuration at runtime.
