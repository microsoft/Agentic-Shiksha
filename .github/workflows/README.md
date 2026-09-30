# .github/workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [ci.yml](ci.yml) | Push and PR to `main`, manual | Main-backend pytest on Python 3.11 and 3.13.5, main-frontend `vite build` on Node 22, and the two main container builds. |
| [codeql.yml](codeql.yml) | Push, PR, schedule | CodeQL static analysis. |

## The `env` block in ci.yml

[azure_services/config.py](<../../Agentic Shiksha Platform/Backend/azure_services/config.py>),
[backend/main.py](<../../Agentic Shiksha Platform/Backend/backend/main.py>) and
[auth.py](<../../Agentic Shiksha Platform/Backend/auth.py>) resolve required variables at **import time** and
raise if one is missing, so the test suite cannot even be *collected* without them. The
`env` block supplies placeholders such as `https://example...` and all-zero GUIDs.
These allow import-time configuration to be resolved; they are not a working Azure
environment. Use the [backend test guide](<../../Agentic Shiksha Platform/Backend/tests/README.md>)
to distinguish isolated tests from scripts that use external services.

That block is also the most reliable inventory of what the application requires to start.
When you add a new import-time required variable, add it there and mark it `[REQUIRED]`
in [Backend/.env.example](<../../Agentic Shiksha Platform/Backend/.env.example>), or CI
breaks for everyone.

## Other notes

- The frontend job supplies a CI-safe `VITE_API_BASE_URL` build value; deployment
  pipelines must supply their own public production URL.
- This job invokes Vite directly, not `npm run build`; the local TypeScript check
  and browser tests in [INSTALL.md](../../INSTALL.md#verification) remain necessary.
- Admin service checks are documented separately; do not infer coverage for them
  from the main-service workflow.
- Container builds use each service directory as the build context, so `.dockerignore`
  keeps `.env` out of the image.
- Workflows declare `permissions: contents: read`; widen that only for a job that
  genuinely needs it.
