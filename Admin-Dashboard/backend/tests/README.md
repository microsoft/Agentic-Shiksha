# tests

Isolated pytest regressions for the Admin Dashboard backend. Tests use synthetic
records, mocked Cosmos handles, in-memory caches and offline HTTP transports.
They do **not** read real `.env` files, acquire Azure tokens or run evaluation.
`conftest.py` supplies synthetic deployment identifiers before collection and
disables dotenv. Settings tests also start `main.py` through an offline ASGI
client with evaluation disabled; the lifecycle test enables only an injected
inert coroutine, never the production evaluator. Precedence tests create and remove synthetic
dotenv files under this test directory, never in a system temporary directory.

See [backend setup](../README.md#setup) for the full service environment and
[repository installation](../../../INSTALL.md) for all applications.

| Test | Guards |
| --- | --- |
| [test_research_json.py](test_research_json.py) | Fenced/trailing-comma JSON, narrative quote repair, and refusal of non-JSON prose. |
| [test_foundry_requests.py](test_foundry_requests.py) | Current `agent_reference` wire payloads for new/continued chat, streamed tool follow-ups and final tool-result submission. |
| [test_dashboard_performance.py](test_dashboard_performance.py) | Bounded profile batching, paired creator/teacher course affiliations, explicit course affiliation precedence, persisted usage events, legacy fallback without double counting, date filtering, student attribution, staff exclusion, cache expiry, single-flight loads, and edit invalidation. |
| [test_settings.py](test_settings.py) | Missing/blank resources, database and model deployments; independent cached domains; typed overrides; distinct project endpoints; optional evaluation and startup failures; explicit CORS; secret-safe errors; dotenv precedence and disabled loading. |
| [test_app_contract.py](test_app_contract.py) | Exact baseline full-OpenAPI and ordered-route hashes, injected app isolation/overrides, lifecycle cancellation, quota bounds/costs, directory statuses, attachment restrictions/headers, SSE ordering/redaction, evaluation and research routing. |
| [test_admin_services.py](test_admin_services.py) | Directory affiliation writes, teacher validation, evaluation batch/cycle limits and failures, instance-local caches, fake research state transitions, original prompt-expression hashes and Foundry research request shape. |
| [test_package_boundaries.py](test_package_boundaries.py) | Layer direction, no ambiguous/platform imports or module proxies, Python 3.11 syntax, factory/production-entry import from another directory, and import-safe maintenance. |

## Dependency preparation

Use a separate admin Python **3.11** environment, not the main backend's venv.
Pytest is a development prerequisite and is not listed in
[requirements.txt](../requirements.txt). If the full service dependencies are
already installed, only add pytest to that environment:

```powershell
# From the repository root
Set-Location '.\Admin-Dashboard\backend'
.\.venv\Scripts\python.exe -m pip install pytest
```

Alternatively, a fresh checkout can prepare only the dependencies needed by
these tests; no Azure configuration or running services are needed:

```powershell
# From the repository root; choose this instead of the full service setup
Set-Location '.\Admin-Dashboard\backend'
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install pytest 'fastapi==0.120.0' 'pydantic==2.12.3' 'pydantic-settings==2.15.0' 'python-dotenv==1.2.3' 'azure-cosmos==4.14.5' 'azure-identity==1.25.1' 'json-repair==0.61.7' 'azure-ai-projects==2.4.0' 'openai==2.54.0'
```

The Azure packages are import dependencies, not live clients in these tests.
Preparing dependencies may require registry access; **test execution** is offline.
This reduced environment is not sufficient to run the application.

## Run offline

Run from `Admin-Dashboard\backend`, so the `admin_backend` package is importable. The
query module validates its Cosmos domain at import time even though the tests
replace initialization and container access. The shared test bootstrap supplies
all core placeholder settings, including `COSMOS_DATABASE` and agent names.
Disable unrelated pytest plugin autoload and restore the shell afterwards:

```powershell
$previousDotenvDisabled = $env:PYTHON_DOTENV_DISABLED
$previousPluginAutoload = $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD
try {
    $env:PYTHON_DOTENV_DISABLED = '1'
    $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
    .\.venv\Scripts\python.exe -m pytest .\tests -q
} finally {
    $env:PYTHON_DOTENV_DISABLED = $previousDotenvDisabled
    $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = $previousPluginAutoload
}
```

For parser-only work, select `.\tests\test_research_json.py` instead of `.\tests`;
that test module does not use deployment resources. Query/cache changes belong
with `test_dashboard_performance.py`; configuration changes belong with
`test_settings.py`.

The parser tests deliberately pin a limited repair contract: rescue nearly
valid JSON without accepting arbitrary prose. Query tests guard bounded,
parameterized profile reads, response-event attribution, legacy fallback,
date ranges and cache invalidation rather than measuring live Azure performance.
The Foundry request tests use the real OpenAI SDK with a mocked HTTP endpoint
that returns 400 for deprecated `agent` request bodies; no model is invoked.

## What these tests do not validate

These are not endpoint-authorization, live credential, Blob/Foundry integration,
browser-cookie, model-quality or production-load tests. A green result does not
make the admin service safe to expose publicly.

Do not substitute [_check_coverage.py](../_check_coverage.py), UI directory edits,
research, or evaluation calls for this suite. Those are connected operations;
several write shared data or incur model usage. Keep new fixtures synthetic and
mock service boundaries before calling query functions.

## Structural refactor evidence

Before this extraction, the focused settings/Foundry suite passed **63 tests**
and the full admin suite passed **84 tests**, with synthetic configuration,
dotenv disabled and external network blocked. The baseline captured **47 ordered
routes** (43 application endpoints plus the four framework documentation routes)
and the complete OpenAPI document. The persistent contract test pins both
canonical JSON SHA-256 values, not merely the endpoint count. Do not update those
hashes to make a structural refactor pass; compare the full documents first.

The original research prompt expressions have separate source-AST hashes;
schemas and model/agent selection are not part of this change. Existing
untyped dictionary bodies intentionally stay untyped in OpenAPI rather than
silently tightening validation. Existing evaluation route precedence, including
the dynamic route ahead of `/groundedness/all`, is pinned rather than repaired.

Pure service tests construct repositories and responders directly. HTTP tests
pass an [AdminServices](../admin_backend/services/container.py) bundle to
[create_app](../admin_backend/app.py); they do not patch the entry-point globals.
The package import smoke test runs a fresh interpreter, rejects flat/platform
module names and blocks sockets. Python 3.11 grammar checks are not a substitute
for the separately coordinated Python 3.11 CI/image runtime tests.
