# Admin-Dashboard/backend

Institution-wide analytics and administration, running as a **separate FastAPI
service on port 8050**. It reads the main application's Cosmos/Blob resources
directly; it is not a proxy for the main API and is not teacher-scoped.

See the [repository installation guide](../../INSTALL.md),
[admin workflows](../README.md) and [frontend setup](../frontend/README.md).

| Module | Purpose |
| --- | --- |
| [main.py](main.py) | Compatible production `main:app` and development script entry; delegates assembly only. |
| [admin_backend/app.py](admin_backend/app.py) | `create_app(services=None)`, service construction, CORS, startup validation and evaluator lifecycle. |
| [routers](admin_backend/routers) / [schemas](admin_backend/schemas) | Domain HTTP handlers and existing request contracts; paths, ordering and full OpenAPI are preserved. |
| [services](admin_backend/services) | Directory/teacher workflows, quota calculation, evaluation batching/loop, research jobs and attachment policy. |
| [core/settings.py](admin_backend/core/settings.py) | Independent typed settings, backend-root-anchored dotenv bootstrap, cached domains and startup validation. |
| [integrations/cosmos_queries.py](admin_backend/integrations/cosmos_queries.py) | Progress/usage queries, directory/affiliation changes, teacher/owner changes and quota configuration. |
| [core/dashboard_cache.py](admin_backend/core/dashboard_cache.py) | Per-process 30-second cache, bounded to 128 results; concurrent reads share a load and edits invalidate results. |
| [integrations/token_stats.py](admin_backend/integrations/token_stats.py) | Legacy Foundry response aggregation for `/overview/tokens`, cached for 600 seconds. |
| [integrations/groundedness_evaluator.py](admin_backend/integrations/groundedness_evaluator.py) | Existing RAGAS-inspired SDK implementation and judge prompts. |
| [services/research_json.py](admin_backend/services/research_json.py) | Structured research-agent output parsing, with the existing narrow repair fallback. |
| [integrations/research_storage.py](admin_backend/integrations/research_storage.py) | Existing research storage/cache and `institute-research-v2` Blob layout. |
| [integrations/research_agent.py](admin_backend/integrations/research_agent.py) | Independent research credential and Foundry response adapter. |
| [integrations/logging_agent_chat.py](admin_backend/integrations/logging_agent_chat.py) | Foundry conversations/responses and tool dispatch; HTTP SSE mapping belongs to the chat router. |
| [integrations/logging_agent_tools.py](admin_backend/integrations/logging_agent_tools.py) | Four unchanged read-only Cosmos analytics tools. |
| [core/log_safe.py](admin_backend/core/log_safe.py) | Removes CR/LF from selected log values; not a general PII-redaction layer. |
| [tests](tests/README.md) | Isolated parser, query, attribution and cache regressions. |
| [scripts/check_coverage.py](admin_backend/scripts/check_coverage.py) | Explicit **live Cosmos read** of assistant-message token metadata, not a test; inert on import. |

## Setup

TA placement is read from explicit course `institute`/`institution` and `department`
fields. Creator and teacher affiliations are not course assignments; an incomplete
pair is unassigned. Course metadata lists are read fresh so a placement saved by the
main API is available on the next reload. The admin editor uses the main API's
authenticated, revision-checked `/api/agents/{agent_id}/placement` endpoints;
placement changes do not modify membership arrays or grant student access.

The [Dockerfile](Dockerfile) uses `python:3.11-slim`, making Python **3.11.x**
the documented service baseline. There is no admin `requires-python` manifest
declaring a broader supported range or a pinned patch release. Keep this
environment separate from the main backend: the services have independent
dependency lists and different constraints.
Clean installation is also verified on local **Python 3.13.5**. With that
environment activated, use `python` in place of `py -3.11` below.

[requirements.txt](requirements.txt) pins the service's runtime dependencies,
with no prerelease pins. Projects uses stable `2.4.0`, the latest stable compatible
with the pinned OpenAI 2.x client; Projects `2.5.0` and later require OpenAI 3.x.
Search uses stable `12.0.0`: this service uses document search, not the main API's
preview knowledge-base output modes. OpenAI is
explicit because Foundry's `get_openai_client()` requires it. Azure Core, Pydantic
and Starlette are also declared directly rather than relying on other packages to
install the APIs imported by this service. `pydantic-settings` is a direct runtime
dependency for this service's independent configuration boundary. These are runtime pins, not a complete
transitive lockfile, and they do not include pytest.

Chat, research and tool-result follow-ups send Foundry's current
`agent_reference` request property, never the deprecated `agent` property.
Historical response readers still accept either field so older token records
remain readable.

From the repository root in PowerShell, for a new service environment:

```powershell
Set-Location '.\Admin-Dashboard\backend'
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
.\.venv\Scripts\python.exe -m pip check
if (-not (Test-Path '.\.env')) { Copy-Item '.\.env.example' '.\.env' }
```

Populate the required settings below using approved development resources.
Copying the value-free example alone is insufficient.
[core/settings.py](admin_backend/core/settings.py) loads only dotenv files in
the backend root, not inside the package, independent of the working directory.
Process environment takes precedence over the optional `.env` file. The bootstrap
retains injected variables and also makes locally loaded identity
variables available to the Azure SDK without declaring secrets in source.

Launch from `Admin-Dashboard\backend` so `main:app` and the dedicated
`admin_backend` package resolve to this independent service. It never imports
the platform application, its settings, or `common_azure_auth`. Domains are
validated and cached on first use, with all core
domains checked at service startup and evaluation checked when enabled.
Configuration failures identify variable names without exposing their values.
Restart after changing configuration; module-level consumers retain their
configuration snapshot. Typed settings constructors also accept explicit field
overrides for isolated callers and tests, ahead of environment values.

```powershell
$env:EVAL_ENABLED = 'false'
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8050
```

In another terminal, `Invoke-RestMethod 'http://localhost:8050/api/dashboard/health'`
checks process liveness only. Swagger and the schema are at
`/api/dashboard/docs` and `/api/dashboard/openapi.json`. A healthy response
does **not** confirm Azure credentials, permissions, containers or models.

The explicit Uvicorn command controls its port. `DASHBOARD_PORT` is read only by
the `python main.py` entry point, which also enables reload and binds
`0.0.0.0`. The Dockerfile independently fixes Uvicorn to port 8050.

For parser/query tests without a runnable service, use the smaller environment
described in [tests/README.md](tests/README.md) instead of starting `main:app`.

## Package and injection boundaries

The production entry remains **`main:app`**, from this service's build context
and working directory. The actual factory is **`admin_backend.app:create_app`**
(also usable with Uvicorn's `--factory`). Importing the factory does not create
the production service bundle, import the optional evaluator, start jobs, or
connect to Azure. Startup still validates required settings, including when a
test supplies fake services; evaluation settings remain conditional on the loop.

[AdminServices](admin_backend/services/container.py) is an explicit, typed bundle:
the query repository, domain services, chat iterator and token loader.
Tests can call `create_app(fake_services)` or override
[get_services](admin_backend/dependencies.py) with FastAPI's dependency overrides.
Services accept their repositories/responders directly and do not import
FastAPI, the application, or SDK adapters. The factory is the composition point.
Existing persistence adapters retain their process-local caches and lazy client
initialization; evaluator thread/session caches belong to each service instance.

All Python callers and tests now use `admin_backend.*` imports. There are no
flat-module re-export shims. The sole compatible application entry,
[main.py](main.py), remains for existing Uvicorn, Docker and operator callers.
Remove it only after those callers are migrated to the factory and independent
image/startup checks pass; removal is not needed for this refactor.
The maintenance entry is now
`python -m admin_backend.scripts.check_coverage`, from this directory. Run it
only when a live cross-partition Cosmos read is explicitly intended.

This is the dashboard portion of phase 6, not completion of the platform
pipeline or maintenance refactors. Dependency manifests, lockfiles, Docker/CI
adaptation and image validation are coordinated separately. No image build or
live-resource validation is implied by the offline test suite.

## Configuration

[.env.example](.env.example) is the complete, value-free deployment contract for
this service. Required resource names, database names and endpoints reject
missing or whitespace-only values. There are no deployment-name fallbacks.
Keep secrets in runtime environment injection or an approved secret manager;
never copy real `.env` values, credentials or student records into the repository.

| Setting | Requirement/default | Consumer |
| --- | --- | --- |
| `COSMOS_ENDPOINT` | Required HTTPS endpoint; no fallback | Cosmos queries |
| `COSMOS_DATABASE` | Required database identifier; no fallback | Cosmos queries |
| `PROJECT_ENDPOINT` | Required HTTPS project endpoint | Institute/department research |
| `STORAGE_ACCOUNT_NAME` | Required storage account identifier | Research storage and feedback-attachment proxy |
| `INSTITUTE_RESEARCH_AGENT_NAME` | Required pre-existing agent identifier | Research |
| `AZURE_AI_PROJECT_ENDPOINT` | Required HTTPS project endpoint | Chat, legacy Foundry totals and evaluation; distinct from `PROJECT_ENDPOINT` |
| `LOGGING_AGENT_NAME` | Required pre-existing agent identifier | Logging chat; replaces the former hardcoded name |
| `AZURE_AI_SEARCH_ENDPOINT` | Required for enabled/manual evaluation only | Evaluator retrieval |
| `COMMON_INDEX_NAME` | Required for enabled/manual evaluation only | Evaluator search index |
| `AZURE_EVAL_MODEL` | Required for enabled/manual evaluation only | Explicit model **deployment** identifier in the configured project |
| `EVAL_ENABLED` | `false` | Opt-in periodic evaluation; standard boolean values accepted |
| `EVAL_INTERVAL_SECONDS`, `EVAL_LOOKBACK_HOURS`, `EVAL_BATCH_LIMIT` | `5`, `24`, `50` | Periodic evaluator scheduling and batch limits |
| `AZURE_CLI_TIMEOUT` | `60` | Standalone research credential fallback timeout |
| `ALLOWED_ORIGINS` | Required comma-separated HTTP(S) origins, without wildcard, credentials or paths | Credentialed CORS; no localhost fallback |
| `DASHBOARD_PORT` | `8050` | Direct `main.py` launch only |

`PROJECT_ENDPOINT` and `AZURE_AI_PROJECT_ENDPOINT` are **distinct names**;
there is no automatic alias. Set both to the intended project endpoint when
using both research and chat/evaluation. The existing environment names remain
the aliases for explicit typed fields such as `research_project_endpoint`,
`foundry_project_endpoint` and evaluator `model_deployment`.
Leave optional numeric settings unset to use their defaults rather than setting
empty strings. With `EVAL_ENABLED=false`, absent or blank evaluation-only fields
do not block startup. Manual evaluation still requires valid evaluation settings
and fails rather than selecting a model or index. Protocol URLs, storage layout
and schema container names remain ordinary code constants.

The query layer uses `DefaultAzureCredential`, with its existing Azure CLI
credential fallback. Research and research storage always use their own
`DefaultAzureCredential` with the configured CLI timeout, matching the previous
standalone deployment path. They never probe for platform authentication
modules. The main backend must not be placed on this service's `PYTHONPATH`.
Approved identity/data-plane access is needed
for the requested Cosmos, Blob, Foundry and Search operations; possession of
endpoint URLs alone is insufficient.

Cosmos handles target `users_v1`, `agents_v1`, `learning_states_v1`,
`chat_threads_v1`, `chat_messages_v1`, `invited_users_v1`, `feedback_v1` and
`groundedness_evaluations_v1`. The service expects these resources; starting it
is not a database-provisioning or schema-migration procedure.

## Scope and access control

The [routes](admin_backend/routers) currently have **no session-validation or administrator
dependency**. This includes directory reads/writes, profile reads, analytics and
quota operations. Directory responses contain names and email addresses.
`PyJWT` appearing in requirements does not mean the routes validate JWTs.

Keep the service private behind an independently enforced access boundary.
CORS is a browser policy, not authorization. The frontend's cookie flags and
cosmetic admin controls do not make this a safe public endpoint.

The [main teacher-dashboard package](<../../Agentic Shiksha Platform/Backend/teacher_dashboard/README.md>)
has a separate, scoped access model. Likewise, student roster updates use the
**main API**, not this service; see [the admin assignment workflow](../README.md#student-access-per-ta-admin).

## Connected operations and safety

- Analytics reads consume Cosmos RUs and can return personal data. The current
  course/period/student usage views use persisted response events, with a legacy
  message fallback. The 600-second Foundry totals endpoint is separate; see
  [freshness and attribution](../README.md#performance-and-freshness).
- Directory invitations, user/role/affiliation edits, removals, institution and
  department changes, teacher assignment and ownership transfer **write shared
  Cosmos documents**. They are not setup or smoke-test steps.
- `PUT /api/dashboard/image-quota` changes the shared weekly allowance applied
  per student/course; it does not merely change a local display.
- Enabling the periodic evaluator invokes Search/model services and stores
  evaluation documents. Manual evaluation operations can also invoke models
  with the loop disabled. Judge prompts are inline in
  [groundedness_evaluator.py](admin_backend/integrations/groundedness_evaluator.py); this implementation does
  not read the main backend's evaluation prompt-store files.
- Research creates Foundry conversations/responses and writes status/results
  to Blob Storage. Its storage helper may create `institute-research-v2`;
  cancellation/deletion also changes saved state. Research prompts are inline
  in [services/research.py](admin_backend/services/research.py), preserved without
  text changes. [research_json.py](admin_backend/services/research_json.py) repairs
  near-JSON output, but refuses an empty or non-object result; broadening repair
  can hide prompt regressions. BackgroundTasks remain process-local, and the
  cancellation endpoint only saves a marker; it does not stop an in-flight call.
- The logging agent's four local tools are read-only queries, but chatting
  still creates remote conversation/response state and incurs model usage.
- [check_coverage.py](admin_backend/scripts/check_coverage.py) performs a cross-partition live read of assistant messages.
  It is neither an offline test nor a migration. Do not run it as part of install.

## Containers and upgrades

Use the [shared ACR/App Service commands](../../docs/deployment.md#azure-cli-container-and-app-service-commands)
with service key `admin-backend`; the build context remains
`Admin-Dashboard\backend` and the container listens on 8050. Registry/plan and
other infrastructure creation live in the
[single Azure resource reference](<../../Agentic Shiksha Platform/Backend/azure_services/README.md#azure-resource-creation-commands>).
Do not duplicate those resource or managed-identity commands here, and establish
the private admin access boundary before supplying live runtime settings.

The Docker build installs this directory's `requirements.txt`, exposes 8050 and
runs `main:app`. Its configurable `PIP_INDEX_URL` build argument defaults to a
corporate package mirror; choose an approved reachable registry for your
environment. [.dockerignore](.dockerignore) excludes local environments and real
`.env` files; runtime configuration must be supplied separately.
This Dockerfile declares no Poppler, TeX or ngspice system installation; those
native-tool requirements belong to the main backend's document/diagram/circuit
features, not the isolated admin test suite.

Review requirement changes in this service independently of the main backend.
Re-resolve/install its requirements in its own environment, run the isolated
tests, and retain the previous dependency resolution/image for rollback.
Coordinate backend/frontend changes that alter course affiliations or usage
payloads. No migration or destructive maintenance script is required merely to
upgrade these dashboard components.
