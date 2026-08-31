# Copilot Instructions - EKALAIVA Backend (Python / FastAPI / Azure)

Single-service Python 3.11 FastAPI backend on Azure (AI Foundry agents, Cosmos DB, Blob, AI Search). Follow every rule below. Flag any rule you must break and why.

## Ground rules for you (the agent)

- Treat repo memory files as hints only. Re-verify any security, metric, or line-count claim against the working tree (`git ls-files`, grep) before reporting it.
- Never guess file locations - search first.
- When generating code, include the matching test in the same output.
- Ask which router/domain if placement is ambiguous - never add to `backend/main.py`.
- `PLAN.md` is the tracked source of truth for the compliance refactor. Read it before acting, execute only its active phase, and update each item to `accomplished`, `in_progress`, or `not_started` only after verifying the working tree.
- Complete one `PLAN.md` phase per session or PR. Stop after its acceptance checks, record the phase report, and report files changed, checks run, and unresolved work before starting another phase.
- Never put credentials, tokens, connection strings, or copied `.env` values in `PLAN.md`.

## Security (non-negotiable)

- `.env` must never be tracked. `.env.example` (value-free) is the contract. If you find a tracked secret file: stop, tell me, do not copy its values anywhere.
- No credential fallbacks in code. No hardcoded client secrets, JWT secrets, endpoints, or resource IDs. App must fail at startup if a required secret is missing - never fall back to a predictable default.
- Every endpoint that reads or writes user/org data requires auth via shared dependencies: `get_current_active_user()` / `require_roles(...)`. These verify JWT -> re-fetch user from Cosmos -> require `status == "active"` -> enforce role. Missing/invalid auth is 401/403 - NEVER a bypass, NEVER treated as admin. No "Dashboard mode" exceptions.
- Use `SecretStr` for secrets in settings. Never log secret values.
- CORS origins come from settings, never inline, never `*` with credentials.

## Structure

- `backend/main.py` is frozen for new routes. New endpoints go in `routers/<domain>.py` (auth, agents, chat, directory, knowledge, ...), request/response models in `schemas/<domain>.py`, shared deps in `dependencies/`. App assembled via `create_app()` keeping the existing `lifespan`.
- When touching an existing `main.py` endpoint, migrate it to its router in the same PR if the change is non-trivial.
- `__init__.py` stays thin: re-exports + `__all__` only. Heavy imports (torch, transformers, large SDKs) lazy-load inside the class that needs them.

## Config

- All environment access through `pydantic_settings.BaseSettings` models (Azure, auth, storage, models, CORS). No new `os.getenv` calls anywhere.
- Settings validated at startup; enabled feature + missing secret = crash with a clear message.

## API boundaries

- Every route: typed Pydantic request model and `response_model=`. No `Dict[str, Any]` payloads on external endpoints.
- Write-request models: `model_config = ConfigDict(extra="forbid")`.
- `Field(default_factory=list)` - never mutable defaults.
- `model_validate()` when ingesting Cosmos records, webhook payloads, or LLM JSON output. Define the Pydantic schema before generating structured output; validate the response against it.
- Pydantic is for boundaries. Internal temporaries may be dataclasses/plain types.

## Reliability

- Tenacity on transient failures only (429, timeouts, 5xx), exponential backoff, respect `Retry-After`. NEVER retry non-idempotent creates/writes. Account for Azure SDK built-in retry before stacking your own.
- Expensive clients (`AIProjectClient`, `SearchClient`, `BlobServiceClient`) come from a singleton registry built at startup and cleaned up in `lifespan` - never constructed per request. Cosmos client already follows this; match it.
- Long-running jobs (agent creation, deep research): persist a job record in Cosmos - `{id, status: PENDING|RUNNING|COMPLETED|FAILED, attempts, progress, output_ref}` - with idempotency keys and resume support. No fire-and-forget daemon threads or bare BackgroundTasks for work that must survive restart. Status via SSE or webhook PLUS a pollable status endpoint.

## Logging

- `logging.getLogger(__name__)` in all modules. `print()` forbidden in library/service code (CLI/migration scripts exempt). Include correlation/job IDs in job-related logs.

## Prompts

- Prompts live in `prompt_store/` as versioned files, never inline strings in Python. Markdown is fine - do not convert to YAML. Move any remaining inline system prompts into the store. Each prompt states its scope restriction explicitly.

## Abstractions

- ABC + `@abstractmethod` only for genuinely interchangeable implementations with required contracts. Optional lifecycle hooks (e.g. `before_chat`/`after_chat`) stay as overridable no-ops - do not make them abstract.

## Packaging

- Target: `pyproject.toml` + `uv.lock` (or Poetry), dev group with pytest + ruff, pinned Python 3.11. Until migrated, keep `requirements.txt` fully pinned. Do not start a disruptive `src/` re-layout without being asked.

## Testing & CI

- Every bugfix ships a regression test. New auth/config/persistence logic ships unit tests. Organize tests by behavior, not one-file-per-class.
- Priority test areas: auth/authz (including disabled users and missing-token paths), settings validation, job state transitions + idempotency, structured-output validation, Cosmos boundaries.
- CI on every PR: ruff (format+lint), pytest, gitleaks, CodeQL. No merge on red.

## Docs

- Root README = model card: overview, Mermaid architecture, intended use, out-of-scope, limitations, setup. Per-module READMEs carry copy-paste run commands. Documented endpoints must match actual routes - update docs in the same PR that changes behavior.