# EKALAIVA Backend Compliance Plan

Last verified: 2026-07-17

## Purpose

`PLAN.md` is the tracked source of truth for bringing the backend into compliance with `.github/copilot-instructions.md`. It records the active phase, verified progress, acceptance checks, and phase reports. It must never contain credential values or copied `.env` contents.

## Active Work - Deployment Configuration Cleanup

On 2026-09-30, the user approved centralizing deployment-specific settings and
removing resource/database fallbacks. This is local source work only: no live
environment, Azure resource, data, identity, deployment, or Git commit is changed.
Protocol URLs, voice IDs, layouts, schema container names, and ordinary product
constants remain in code.

| Acceptance check | Status | Evidence |
| --- | --- | --- |
| Main service uses validated environment-backed deployment settings | accomplished | Typed settings own resource/database/model/URL/authentication selection; compatibility exports preserve existing callers. |
| Independent admin service has equivalent configuration boundaries | accomplished | Independent flat-import settings and optional evaluator validation; 84 admin tests pass. |
| Model configuration failures are explicit in the client | accomplished | Authoritative server configuration, loading/error/retry behavior and no fabricated model deployments; 17 browser regressions pass. |
| Required/optional settings, secret-safe errors and compatibility verified | accomplished | Main focused suites: 472 tests plus 114 subtests pass, including tool/search/indexing regressions; Python syntax checks and frontend TypeScript/Vite production build pass. |
| Value-free examples, CI fixtures and setup documentation updated | accomplished | Base/production examples, synthetic CI/test values and service documentation updated without reading or changing real environment values. |

These are local verification results, not deployment proof. Existing local and
App Service environments must supply the now-required settings before running
this version. Optional tools reject missing deployment selection when used.
The migrated voice-input token route requires authentication. No live settings,
cloud resources, data, role assignments, or release plans were changed.

## Completed Work - Platform Relocation and Application Foundation

On 2026-09-29, the user explicitly authorized continuing the repository refactor
and moving the main backend and frontend under `Agentic Shiksha Platform/`.
The relocation is local and behavior-preserving. It does not authorize cloud
changes, dependency upgrades, a deployment, or a Git commit.

The current backend step introduces an injected application factory and a
dependency-free public system router with contract tests. The production entry
point remains `backend.main:app`; its complete route/lifespan registry is now
wired through the factory.

| Acceptance check | Status | Evidence |
| --- | --- | --- |
| Relocated service keeps its original entry point | accomplished | `uvicorn backend.main:app` restarted from `Agentic Shiksha Platform/Backend` and `/api/health` returned 200 on port 8000. |
| Application assembly and system routes have explicit ownership | accomplished | `backend/app.py` owns FastAPI assembly; `backend/routers/system.py` owns health/configuration routes; eight isolated factory/contract tests pass. |
| Existing API and router behavior remains registered | accomplished | Full suite: 780 passed, 78 skipped, 149 subtests passed. Offline OpenAPI: 218 operations over 184 paths with unique emitted IDs. |
| Python import and syntax verification | accomplished | Both Python services compiled successfully from their new/current roots. |
| Relocated backend image builds | blocked | Docker Desktop's Linux engine did not respond; no image or deployment was attempted. |

## Completed Work - Harness Extraction

On 2026-09-25, the user approved separating the existing agent harness into its
own folder after an architectural assessment. This authorizes a local,
behavior-preserving extraction into `Agentic Shiksha Platform/Backend/harness/`,
not the broader service
move or a framework migration. Status: `accomplished`.

Preserve the `base_agents.general_agent` import path, shared runtime/tool state,
Foundry call semantics, prompts, HTTP routes, streaming events and learner scope.
Do not combine this extraction with authorization changes, new stopping rules,
remote agent updates, dependency upgrades, deployment, or unrelated refactoring.

| Acceptance check | Status | Evidence |
| --- | --- | --- |
| Existing focused behavior baseline | accomplished | 53 tests and 54 subtests passed with CI placeholder settings before runtime edits. |
| Canonical harness and legacy import share one implementation/cache | accomplished | Module/class/factory/cache identity and shared monkeypatch regression passes. |
| Extracted runtime and pure turn-policy checks | accomplished | 54 focused tests and 54 subtests passed; legacy logger category preserved. |
| Regression gates and existing API import/route preservation | accomplished | 525 backend tests and 146 subtests; 17 dashboard tests; Python compilation and frontend build passed. Offline API health and all 218 route paths/methods preserved. |
| Ownership/import documentation and final phase report | accomplished | Harness README, affected backend ownership docs and repository context references updated. Phase report below. |

### Harness Extraction Report - 2026-09-25

- Canonical implementation: [harness/runtime.py](harness/runtime.py). The runtime was
	moved intact; its logger retains the previous category for compatibility.
- [base_agents/general_agent.py](base_agents/general_agent.py) is a 15-line module alias,
	not a second implementation. Existing imports and tool patches share the same cache
	and module objects. The API now imports the canonical harness directly.
- Added the compatibility regression to
	[tests/test_plain_text_emission.py](tests/test_plain_text_emission.py). Verified both
	legacy-first and canonical-first import paths through the focused and full test runs.
- Main backend: 525 passed and 146 subtests passed; dashboard backend: 17 passed.
	The focused pre-move baseline was 53 tests/54 subtests; after adding compatibility
	coverage it is 54 tests/54 subtests. Existing warnings remain.
- Main frontend typecheck/production build and both backend Python compilation checks
	passed. The offline ASGI health check returned 200; the 218-route path/method
	fingerprint remained `ea08f78926d67eac4f495d95cd7ce893df5573188edeed47126ad001e54b0281`.
- Verification used the existing Python 3.13.5 development environment and synthetic CI
	settings with dotenv disabled. External HTTP was blocked for full backend checks;
	OAuth discovery was mocked. Live services and lifespan workers were not exercised.
- No new diagnostics in the harness, legacy alias or regression test. Existing
	[backend/main.py](backend/main.py#L5327) and
	[backend/main.py](backend/main.py#L8896) undefined-name diagnostics were left untouched;
	the API file's only extraction change is its runtime import.
- No prompt/model/tool behavior change, dependency upgrade, remote agent mutation,
	Docker rebuild, deployment, Git commit or broader refactor was performed.

## Previous Approval - Refactoring Baseline

On 2026-09-11, the user approved starting Phase 0 (approval, baseline, and
migration inventory) of [the repository refactoring plan](../../refactoring_plan.md).
That broader plan remains at its recorded baseline stage; later phases are not
authorized by this limited harness extraction.
No service moves, runtime refactors, cloud changes, commits, or deployments are
authorized by this phase.

The compliance tables below are retained as historical backlog, last verified
on the date above. They are not newly verified findings or completed security
work. Relevant security prerequisites must be checked before later refactoring
phases; the baseline report must distinguish existing failures from regressions.

## Rules of engagement

- Execute one phase per session or pull request.
- Stop after each phase and report files changed, checks run, and anything that could not be completed.
- Do not begin the next phase until the current phase has passed its acceptance checks and its report is recorded here.
- Preserve runtime behavior unless the active phase explicitly requires a behavior change.
- Re-verify every claim against the working tree before changing a status.
- Stop and ask before destructive or ambiguous work.
- After every phase, verify that the app boots and existing endpoints remain registered.

## Status values

- `accomplished`: verified against the current working tree.
- `in_progress`: work has started but one or more requirements or checks remain.
- `not_started`: no verified implementation work has begun.

## Phase overview

| Phase | Scope | Status |
|---|---|---|
| 0 | Secret hygiene | in_progress |
| 1 | Auth enforcement | not_started |
| 2 | Settings | not_started |
| 3 | Split the monolith | not_started |
| 4 | Boundaries and reliability | not_started |
| 5 | Tests and CI | not_started |
| 6 | Documentation | not_started |

## Phase 0 - Secret hygiene

Humans rotate credentials. This phase changes repository files only and does not rewrite Git history or modify cloud configuration.

| Requirement | Status | Evidence or remaining work |
|---|---|---|
| Add `.gitignore` coverage for `.env`, Python caches, local environments, and build output | accomplished | Verified `.env` is ignored. |
| Remove `.env` from the Git index while preserving the local file | accomplished | `git rm --cached .env` completed; local file still exists. |
| Create a value-free `.env.example` with the current configuration keys | accomplished | Blank-assignment and source-key checks passed. |
| Inventory hardcoded secret fallbacks and secret literals | in_progress | Redacted scan found a credential-like literal in `backend/main.py`; JWT fallback is present in `auth.py`. |
| Replace secret fallbacks with required-at-startup lookups | not_started | Must remove literals without copying them into patches or reports. |
| Create `SECRETS_TO_ROTATE.md` without secret values | not_started | Must identify each provider credential and the reason for rotation. |

### Phase 0 acceptance checks

| Check | Status |
|---|---|
| `git ls-files -- .env` returns no path | accomplished |
| Redacted secret scan and targeted source grep are clean | not_started |
| App boots with the populated local `.env` | not_started |
| App refuses to boot when `JWT_SECRET` is unset | not_started |
| Existing route registration remains intact | not_started |

### Phase 0 report

Status: `in_progress`

Files changed, checks run, and blockers will be recorded when the phase finishes.

## Phase 1 - Auth enforcement

| Requirement | Status |
|---|---|
| Create shared `get_current_user()`, `get_current_active_user()`, and `require_roles(...)` dependencies | not_started |
| Produce `AUTH_AUDIT.md` with the public allowlist and every route's current and required auth | not_started |
| Remove every missing/invalid-auth bypass, including Dashboard admin branches | not_started |
| Require active-user authentication on every non-public route | not_started |
| Verify zero routes grant access when authentication is absent | not_started |

## Phase 2 - Settings

| Requirement | Status |
|---|---|
| Add grouped `pydantic_settings.BaseSettings` models and cached `get_settings()` | not_started |
| Migrate all Python `os.getenv` and `os.environ` access to settings | not_started |
| Move endpoints, resource IDs, deployments, super-admin identity, and CORS origins to settings | not_started |
| Validate enabled-feature requirements at startup | not_started |
| Verify no environment reads remain outside `settings.py` | not_started |

## Phase 3 - Split the monolith

| Requirement | Status |
|---|---|
| Capture the pre-refactor OpenAPI and route-count baselines | not_started |
| Add `backend/app.py`, domain routers, schemas, and dependencies skeletons | not_started |
| Move one route domain per commit without logic changes | not_started |
| Reduce `backend/main.py` to a shim under 100 lines | not_started |
| Verify route counts and OpenAPI paths remain identical | not_started |

## Phase 4 - Boundaries and reliability

| Requirement | Status |
|---|---|
| Add typed request and response models to every route | not_started |
| Forbid extra write fields, remove mutable defaults, and validate boundary data | not_started |
| Add a lifespan-managed singleton Azure client registry | not_started |
| Add bounded transient-only retries without retrying non-idempotent writes | not_started |
| Persist resumable, idempotent agent-creation and deep-research jobs in Cosmos | not_started |
| Replace service/library `print()` calls and add job correlation IDs | not_started |
| Verify persisted jobs survive a simulated restart | not_started |

## Phase 5 - Tests and CI

| Requirement | Status |
|---|---|
| Add pytest and HTTPX fixtures with auth and Cosmos overrides | not_started |
| Add full-route auth, disabled-user, and role-mismatch tests | not_started |
| Add settings, job transition/idempotency, and structured-output tests | not_started |
| Add `pyproject.toml` with Ruff and development dependencies | not_started |
| Add PR CI for Ruff, pytest, Gitleaks, and CodeQL plus weekly CodeQL | not_started |
| Reach at least 80% coverage on auth dependencies, settings, and job storage | not_started |

## Phase 6 - Documentation

| Requirement | Status |
|---|---|
| Build the root README model card with an accurate Mermaid architecture | not_started |
| Document intended use, out-of-scope use, limitations, and `.env.example` setup | not_started |
| Synchronize `backend/README.md` endpoints with OpenAPI | not_started |
| Add `SECURITY.md` reporting guidance | not_started |
| Verify documented endpoint paths equal OpenAPI paths | not_started |