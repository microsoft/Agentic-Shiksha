# EKALAIVA Backend Compliance Plan

Last verified: 2026-07-17

## Purpose

`PLAN.md` is the tracked source of truth for bringing the backend into compliance with `.github/copilot-instructions.md`. It records the active phase, verified progress, acceptance checks, and phase reports. It must never contain credential values or copied `.env` contents.

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