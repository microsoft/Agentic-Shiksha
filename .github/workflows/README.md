# .github/workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [ci.yml](ci.yml) | Push and PR to `main`, manual | Backend pytest on Python 3.11, frontend `vite build`, and both container image builds. |
| [codeql.yml](codeql.yml) | Push, PR, schedule | CodeQL static analysis. |

## The `env` block in ci.yml

[azure_services/config.py](../../Backend/azure_services/config.py),
[backend/main.py](../../Backend/backend/main.py) and
[auth.py](../../Backend/auth.py) resolve every required variable at **import time** and
raise if one is missing, so the test suite cannot even be *collected* without them. The
`env` block supplies placeholders — `https://example...`, all-zero GUIDs — and **no test
makes a live Azure call**.

That block is also the most reliable inventory of what the application requires to start.
When you add a new import-time required variable, add it there and mark it `[REQUIRED]`
in [Backend/.env.example](../../Backend/.env.example), or CI breaks for everyone.

## Other notes

- The frontend job builds against `.env.production.example`, since the real
  `.env.production` is not committed.
- Container builds use each service directory as the build context, so `.dockerignore`
  keeps `.env` out of the image.
- Workflows declare `permissions: contents: read`; widen that only for a job that
  genuinely needs it.
