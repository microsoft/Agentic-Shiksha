# Installation

Install and run Agentic Shiksha from the current source tree. This guide separates
dependency installation from Azure provisioning, live integration tests and
deployment. For changes affecting an existing checkout, read
[RELEASE_NOTES.md](RELEASE_NOTES.md).

## Choose the services you need

| Service | Working directory from repository root | Local endpoint |
| --- | --- | --- |
| Main API | `Agentic Shiksha Platform\Backend` | `http://localhost:8000` |
| Main web app, including teacher dashboard | `Agentic Shiksha Platform\Frontend` | `http://localhost:5173` |
| Admin API | `Admin-Dashboard\backend` | `http://localhost:8050` |
| Admin web app | `Admin-Dashboard\frontend` | `http://localhost:5174` |

Start the main API and web app for teaching/course workflows. The admin services
are independent and optional for that local UI. The embedded teacher dashboard
uses the **main API**, not port 8050.

Each service has its own manifest and build context. There is no root `npm install`
or combined Python requirements file. The platform folder name contains spaces:
quote it in shell commands, editor tasks and external automation.

## Requirements

- Git and a local clone/check-out of this repository.
- Python **3.13.5** for the main API's Docker/local runtime; its CI also tests
  Python 3.11 compatibility. The independent admin API retains its Python 3.11
  Docker baseline. Use separate virtual environments for main and admin APIs;
  do not merge their requirements.
- Node.js **22.12+ in the Node 22 line** and npm for both web apps. The main
  lockfile's Vite engine is `^20.19.0 || >=22.12.0`; Node 18 is too old. The CI
  uses Node 22.
- An installed browser for Playwright tests: Microsoft Edge on Windows or the
  Playwright Chromium installation described below.
- Docker with Linux-container support only if using the optional container path.
- Operator-provisioned Microsoft Foundry, Azure AI Search, Cosmos DB, Blob Storage
  and the feature-specific services used by your deployment.

Dependency installation does **not** create cloud resources, model deployments,
OAuth registrations, users or course agents. Arrange these with your operator.
Identity-based Azure access and user-facing OAuth/session authentication are
different: neither configuration is a substitute for the other.

For only the outstanding Foundry and App Service inventory rows, use the
[resource setup READMEs](docs/resources/README.md). They reuse completed
dependencies and do not replace this application-installation guide.

The commands below use **PowerShell**. Run each service in its own terminal,
starting at the repository root. Select your Python 3.13.5 interpreter (or
activate the existing Conda environment) before using `python` for the main API.
The admin examples use `py -3.11`, the Windows Python launcher. Calling each
virtual environment's executable directly avoids activation-policy issues.

## Configuration safety

- Copy example files only during first-time setup; do not overwrite an existing
  private `.env`.
- Replace placeholders using your own authorized environment. A filled example
  with dummy values may allow test imports but cannot run the live service.
- Never commit credentials, private configuration, learner records or tokens.
  Do not paste `.env` contents into issues or build logs.
- `VITE_` values are **public, build-time** browser settings. OAuth client secrets,
  session-signing secrets and service credentials belong only on the server.
- Use one hostname consistently for local login, such as `localhost`. Switching
  between it and `127.0.0.1` changes browser origins/cookie behavior.
- Configure OAuth callback URLs and CORS for the chosen local ports. Do not disable
  authentication, TLS verification or origin checks to work around a setup error.

## Main backend

The [backend guide](<Agentic Shiksha Platform/Backend/README.md>) documents environment
groups, optional native tools and the distinction between isolated tests and live
operations. Begin with its [.env.example](<Agentic Shiksha Platform/Backend/.env.example>).

```powershell
Set-Location -LiteralPath '.\Agentic Shiksha Platform\Backend'
python -m venv .venv
& '.\.venv\Scripts\python.exe' -m pip install --upgrade pip
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Fill in the required server configuration before startup:

| Group | Settings to review |
| --- | --- |
| Session and sign-in | `JWT_SECRET`, `SUPER_ADMIN_EMAIL`, `AZURE_AUTH_CLIENT_ID` or `VITE_AZURE_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and provider callback/secret settings in the example |
| Infrastructure | `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_AI_PROJECT_ENDPOINT`, `AZURE_FOUNDRY_ENDPOINT`, `PROJECT_RESOURCE_ID`, `STORAGE_ACCOUNT_NAME`, `COSMOS_ENDPOINT`, deliberate `COSMOS_DATABASE` |
| Search | `AZURE_AI_SEARCH_SERVICE_NAME`, `AZURE_AI_SEARCH_ENDPOINT`, `AZURE_AI_SEARCH_CONNECTION_ID`, `AZURE_AI_SEARCH_API_VERSION`, `AZURE_AI_SEARCH_BLOB_CONTAINER`, and all five `COMMON_*` resource names |
| Models | `AZURE_OPENAI_CHAT_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `AZURE_EVAL_MODEL` and the configured endpoints |
| Integrations | Bing connection IDs, `DOCUMENT_INTELLIGENCE_ENDPOINT`, the `DEEP_RESEARCH_*` settings and any enabled speech/evaluation features |

The [example](<Agentic Shiksha Platform/Backend/.env.example>) and
[configuration module](<Agentic Shiksha Platform/Backend/azure_services/config.py>)
are the detailed references. `AZURE_AI_SEARCH_CONNECTION_ID` is required in source
even though its example entry lacks a `[REQUIRED]` marker. Google client ID/secret
are also import-time requirements even if Microsoft sign-in is the intended
provider. Do not assume a shorter environment overlay supplies the full configuration.

Run from this service directory so the package and local configuration can be resolved:

```powershell
$env:PYTHONPATH = (Get-Location).Path
& '.\.venv\Scripts\python.exe' -m uvicorn backend.main:app --reload --host localhost --port 8000
```

The root `main.py` is a compatibility entry; `backend.main:app` is the service
entry point. This is not the same module as the admin API's `main:app`.

The main service resolves process environment first, then its optional `.env`,
without overwriting already-set values. This file is rooted at the service directory.

Main CORS includes `FRONTEND_URL`, comma-separated `CORS_ALLOWED_ORIGINS` and the
supported local frontend origins. The `session` cookie is HttpOnly, Secure and
SameSite=None; provider callback URLs must agree with the chosen frontend/backend
addresses. If a browser rejects Secure cookies for your local HTTP setup, use
local HTTPS rather than weakening production cookie settings.

### Optional native dependencies

The [main Dockerfile](<Agentic Shiksha Platform/Backend/Dockerfile>) installs the
native baseline alongside Python packages:

| Feature | Native dependency |
| --- | --- |
| PDF conversion/rendering | Poppler utilities, found on PATH or through `POPPLER_PATH` |
| TeX/TikZ diagrams | TeX Live including `pdflatex`, plus PDF conversion support |
| Circuit simulation | `ngspice` on PATH |

These programs are not installed merely by `pip install -r requirements.txt`.
Use the container baseline or install the appropriate trusted platform packages.
See the backend guide for feature settings and validation; do not globally disable
certificate verification or substitute a success response for a missing executable.

After startup, check liveness in a second terminal:

```powershell
Invoke-RestMethod -Method Get -Uri 'http://localhost:8000/api/health'
```

`/api/healthz` adds metadata; `/docs` exposes the current OpenAPI routes. These are
not cloud-readiness checks. App startup runs cloud-backed lifespans/workers, so
do not launch the service with the synthetic environment used for unit tests.

Keep experimental [Graph Memory](docs/memory/overview.md) disabled during routine
installation. Current source includes worker and HTTP integration as well as
contracts/settings; follow that guide for readiness and resource prerequisites.
Source presence does not imply an enabled feature or a required migration.

## Main frontend

From repository root in another terminal:

```powershell
Set-Location -LiteralPath '.\Agentic Shiksha Platform\Frontend'
npm ci
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Set these public values in `.env`:

```dotenv
VITE_API_BASE_URL=http://localhost:8000
VITE_API_URL=http://localhost:8000
VITE_USE_AGUI=false
```

The first origin drives the main API; the second drives authentication. Keep them
aligned. `VITE_USE_AGUI=true` selects AG-UI instead of the default SSE adapter.
The older `VITE_AZURE_*` fields in the example are historical frontend MSAL settings;
the active [authentication hook](<Agentic Shiksha Platform/Frontend/src/lib/useAuth.ts>)
uses backend-mediated sign-in. Configure OAuth on the backend/provider.

```powershell
npm run dev -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173`. The main Vite configuration has no API proxy, so
the backend must permit this origin and issue cookies appropriate to the local
scheme. Restart Vite after changing environment files.

See the [frontend README](<Agentic Shiksha Platform/Frontend/README.md>) for routes,
feature guides and the distinction between course and admin dashboards.

## Admin backend

**Access boundary:** the standalone admin API currently lacks route-level session/
role enforcement. Keep it behind an independently authenticated private access
boundary; do not expose it directly to the public internet. CORS and a browser
login do not authorize these endpoints. Main-API assignment operations have their
own separate authorization requirements.

From repository root:

```powershell
Set-Location -LiteralPath '.\Admin-Dashboard\backend'
py -3.11 -m venv .venv
& '.\.venv\Scripts\python.exe' -m pip install --upgrade pip
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Configure `COSMOS_ENDPOINT`, `PROJECT_ENDPOINT` and `STORAGE_ACCOUNT_NAME` before
importing the app. Chat/evaluation also require `AZURE_AI_PROJECT_ENDPOINT`, and
evaluation requires `AZURE_AI_SEARCH_ENDPOINT`. The two project endpoint variables
are **not aliases**. Keep `EVAL_ENABLED=false` unless intentionally configuring
evaluation; allow the local admin frontend through `ALLOWED_ORIGINS`. Set
`COSMOS_DATABASE` deliberately. The copied admin example does not contain every
required shared setting; use the [admin configuration table](Admin-Dashboard/backend/README.md).

The admin service uses its own dotenv discovery. Launch it from this directory
with its own environment:

```powershell
& '.\.venv\Scripts\python.exe' -m uvicorn main:app --reload --host localhost --port 8050
```

`DASHBOARD_PORT` controls direct `main.py` execution, not an independently invoked
Uvicorn command. The explicit `--port` above is authoritative. See
[admin backend setup](Admin-Dashboard/backend/README.md) for configuration details.

In a second terminal, process liveness can be checked without scheduling an
evaluation or directory operation:

```powershell
Invoke-RestMethod -Method Get -Uri 'http://localhost:8050/api/dashboard/health'
```

This response does not verify Azure connectivity.

## Admin frontend

From repository root in another terminal:

```powershell
Set-Location -LiteralPath '.\Admin-Dashboard\frontend'
npm ci
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Set these public browser settings in `.env`:

```dotenv
VITE_DASHBOARD_API_URL=http://localhost:8050
VITE_API_BASE_URL=http://localhost:8000
VITE_STUDENT_ASSIGNMENTS_ENABLED=false
```

- `VITE_DASHBOARD_API_URL` is the admin API **origin**, without `/api` or a trailing slash.
- `VITE_API_BASE_URL` targets the main permission/assignment API. It does not
  configure the authentication proxy.
- Only exact `VITE_STUDENT_ASSIGNMENTS_ENABLED=true` enables the assignment UI.
  Main-API authorization is still required. The legacy `VITE_SUPER_ADMIN_EMAIL`
  is cosmetic and grants no access.
- Admin source does not consume `VITE_API_URL`. Its relative `/auth/*` requests
  use a fixed development proxy to `http://localhost:8000`, so start the configured
  main API for login. Analytics requests go directly to port 8050.

```powershell
npm run dev -- --host localhost --port 5174 --strictPort
```

Open `http://localhost:5174`. See the [admin frontend guide](Admin-Dashboard/frontend/README.md)
for configuration details. Production Nginx does not provide the development
`/auth` proxy; an operator must supply the intended authenticated routing boundary.

## Verification

### Main frontend

From `Agentic Shiksha Platform\Frontend`:

```powershell
npm run build
npm run lint
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npx playwright test share-ta.spec.ts learner-profile.spec.ts
```

`npm run build` includes TypeScript (`tsc -b`) and Vite. The CI frontend job invokes
Vite directly, which is not equivalent to this complete local check.

If Edge is not installed, use Playwright Chromium instead:

```powershell
npx playwright install chromium
if (Test-Path Env:\PLAYWRIGHT_CHANNEL) {
    Remove-Item Env:\PLAYWRIGHT_CHANNEL
}
npx playwright test share-ta.spec.ts learner-profile.spec.ts
```

The [Playwright configuration](<Agentic Shiksha Platform/Frontend/playwright.config.ts>)
starts a local server with synthetic test APIs on port 4175 by default. To avoid
colliding with another run, set `PLAYWRIGHT_PORT` to an unused port and
`PLAYWRIGHT_OUTPUT_DIR` to a separate test-output directory. Do not run a broad test
suite against production to check an installation.

Use focused selectors for the changed feature:

```powershell
npx playwright test chat-persistence.spec.ts --grep 'answer depth'
npx playwright test slides.spec.ts companion-animations.spec.ts
```

### Backend and admin tests

Use the scoped commands and configuration described in the
[main backend test guide](<Agentic Shiksha Platform/Backend/tests/README.md>),
[admin backend test guide](Admin-Dashboard/backend/tests/README.md) and
[admin frontend guide](Admin-Dashboard/frontend/README.md).

Some modules require import-time environment values even for isolated tests.
CI placeholders are not credentials. Review fixtures and external calls before
using an integration/diagnostic script; do not assume every script in a service
directory is an offline test. Record the command and environment with any result;
this documentation edit does not claim a new application test run.

For main-backend tests, install the test runner separately and then follow the
complete synthetic environment block in its test README:

```powershell
# From Agentic Shiksha Platform\Backend
& '.\.venv\Scripts\python.exe' -m pip install pytest pytest-subtests
# Apply the documented synthetic test environment before running pytest.
$env:PYTHON_DOTENV_DISABLED = '1'
& '.\.venv\Scripts\python.exe' -m pytest tests -q
```

`PYTHON_DOTENV_DISABLED=1` alone is not sufficient: the placeholder environment
block supplies the import-time variables. Run this in a dedicated test terminal,
not the live API terminal. Numerical circuit tests can skip if ngspice is absent.
Each Python service pins its runtime dependencies in its own `requirements.txt`;
these manifests are not complete transitive lockfiles. Run
`.\.venv\Scripts\python.exe -m pip check` after installing each service.

### Admin frontend

From `Admin-Dashboard\frontend`, type-check separately because its build script
runs Vite only:

```powershell
npx --no-install tsc -p .\tsconfig.json --noEmit
npm run build
node --experimental-strip-types --test .\dashboardRequestCache.test.ts
$env:PLAYWRIGHT_CHANNEL = 'msedge'
$env:PLAYWRIGHT_STUDENT_ASSIGNMENTS_ENABLED = 'true'
npm run test:overview
npm run test:student-assignments
```

There is no generic admin `lint` or `test` npm script. The browser configuration
starts an isolated Vite server on port 4184 and intercepts API calls, including
the test main-API origin on port 4185. These tests do not need a live backend.
To exercise the disabled assignment state as well, set
`PLAYWRIGHT_STUDENT_ASSIGNMENTS_ENABLED=false` and use `npx --no-install playwright test`.
Restore any shell overrides when finished.

### Isolated admin backend tests

For a test-only environment without installing the entire application, use the
minimal dependencies from the [test guide](Admin-Dashboard/backend/tests/README.md):

```powershell
# From Admin-Dashboard\backend; this environment is only for the isolated tests.
py -3.11 -m venv '.\tests\.venv'
& '.\tests\.venv\Scripts\python.exe' -m pip install pytest azure-cosmos==4.14.5 azure-identity==1.25.1 json-repair==0.61.7
$previousEndpoint = $env:COSMOS_ENDPOINT
$previousPlugins = $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD
try {
    $env:COSMOS_ENDPOINT = 'https://example.documents.azure.com:443/'
    $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
    & '.\tests\.venv\Scripts\python.exe' -m pytest .\tests -q
} finally {
    $env:COSMOS_ENDPOINT = $previousEndpoint
    $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = $previousPlugins
}
```

These tests replace Cosmos access and do not import the full admin app or load
dotenv. This minimal environment cannot run the complete service. Keep generated
virtual environments out of Git.

## Local container builds

The per-service Dockerfiles are the runtime/build dependency references. For the
main frontend, pass real public browser/API origins as build arguments. The
Dockerfile derives the Nginx CSP from `VITE_API_BASE_URL`; the browser URL must be
reachable from the user's browser.

From repository root:

```powershell
docker build -t agentic-shiksha-backend:local '.\Agentic Shiksha Platform\Backend'
docker build -t agentic-shiksha-frontend:local '.\Agentic Shiksha Platform\Frontend'
docker build -t agentic-shiksha-admin-backend:local '.\Admin-Dashboard\backend'
docker build -t agentic-shiksha-admin-frontend:local '.\Admin-Dashboard\frontend'
```

Build only the services you need after their configuration is ready. These commands
do not push images or deploy anything. Supply backend secrets at runtime through
your approved secret/configuration mechanism. A host Azure CLI login is not
automatically a credential inside a container.

Frontend containers serve static output through Nginx on port 80. Their public
settings are fixed at build time. See each service README for container-specific
configuration; do not use a repository-root build context or bake `.env` secrets
into an image.

The main API container defaults to port 8080 through `PORT`, unlike the explicit
8000 used for local development above. The admin API container uses 8050.
The admin frontend declares main-API/assignment build arguments, not an admin
API-origin argument; configure its public origins following the service guide
rather than passing an unsupported `VITE_DASHBOARD_API_URL` build argument.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `ModuleNotFoundError` for the service | Correct service working directory, its own Python environment, and main `backend.main:app` versus admin `main:app` |
| Missing required environment variable | Copy the correct example once and fill required values; keep placeholders out of live setup |
| `EBADENGINE` or Vite startup failure | Use the Node version required by the lockfile; Node 18 is not sufficient |
| `npm ci` rejects the lockfile | Ensure package manifest and lockfile come from the same revision; do not delete the lockfile as a workaround |
| Authentication loops or API calls go to the wrong origin | Align `VITE_API_BASE_URL`, `VITE_API_URL`, backend frontend-origin settings, registered OAuth redirects and local hostname |
| Azure 401/403 | Confirm the authorized identity and service/data-plane permissions; successful user login does not grant Azure service access |
| Missing speech, diagrams or simulator behavior | Check the feature-specific backend settings and native executables; they are not all pip-only dependencies |
| Frontend container cannot call its API | Rebuild with the required public `VITE_API_BASE_URL` build argument; never use production secrets as frontend variables |
| CSP blocks API calls after a URL change | Rebuild the SPA/Nginx configuration with the matching backend origin |
| Port already in use | Use an unused port and update matching origins/redirects; do not terminate unrelated processes |
| Old paths fail after an upgrade | Update scripts/editor working directories for `Agentic Shiksha Platform` and recreate moved virtual environments if necessary |

When requesting help, follow [SUPPORT.md](SUPPORT.md) with redacted details.
Do not share `.env` files, tokens or learner content.
