# Agentic Shiksha Refactoring Plan

Date: 2026-09-11  
Status: Phase 1 relocation in progress; Phase 2 foundation started.

## 1. Objective and Scope

Make the repository easier to navigate, test, maintain, and reuse by adopting the
separation of responsibilities demonstrated by
[Microsoft Shiksha-Copilot](https://github.com/microsoft/Shiksha-Copilot).
Keep Agentic Shiksha's existing functionality, security controls, and four
independently deployable services.

The main backend and frontend now live under the parent folder named
**Agentic Shiksha Platform**. Path consumers and verification gates are being
updated before Phase 1 is marked complete.

The user approved Phase 0 on 2026-09-11 and explicitly authorized continuing the
local refactor and moving both services on 2026-09-29. This does not authorize a
deployment or Git commit. Existing uncommitted changes must be preserved.

### Relationship to the Existing Compliance Plan

[Backend/PLAN.md](<Agentic Shiksha Platform/Backend/PLAN.md>) retains the compliance backlog and now points
to Phase 0 of this plan as the active, approved work. Its historical security
statuses are not certified as current or complete by this refactor. Re-verify
relevant prerequisites before each later phase and keep unresolved findings
explicit. Update links when the backend moves.

### Reference Patterns to Adopt

| Shiksha-Copilot pattern | Application here |
| --- | --- |
| [API layers](https://github.com/microsoft/Shiksha-Copilot/tree/main/shiksha-api/app-service): routers, models, services, configuration, prompts | Separate HTTP handling, workflow logic, contracts, configuration, and agent instructions. |
| [Reusable components](https://github.com/microsoft/Shiksha-Copilot/tree/main/components) | Extract independently testable libraries only when there is a real reuse requirement. |
| [Separate ingestion workflow](https://github.com/microsoft/Shiksha-Copilot/tree/main/shiksha-ingestion) | Separate content processing from request handlers without adding a new deployed service by default. |
| Service-specific dependencies and setup guides | Preserve independent builds and document each service's entry point, dependencies, and checks. |

Use these architectural patterns, not a copy of that repository's code, cloud
configuration, SDK versions, or authentication approach.

### Non-goals

- No new microservices, cloud resources, databases, or hosting migration.
- No UI redesign, model replacement, prompt rewrite, or new product features.
- No API URL, cookie, authorization, data-schema, or streaming-protocol changes hidden inside file moves.
- No framework upgrades or broad formatting changes bundled with extractions.
- No generic base classes, dependency-injection framework, or shared package created solely for symmetry.

## 2. Current Starting Points

| Current surface | Refactoring opportunity |
| --- | --- |
| [Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py>) | Application assembly, auth, directory, agents, chat, knowledge processing, assets, and persistence endpoints share one module. |
| [Backend/base_agents/general_agent.py](<Agentic Shiksha Platform/Backend/base_agents/general_agent.py>) | Compatibility alias for the canonical harness runtime. |
| [Backend/azure_services](<Agentic Shiksha Platform/Backend/azure_services>) | Existing integrations are a useful starting point; extract and reuse them rather than implementing a parallel integration layer. |
| [Frontend/src/features/chat/useAgentChat.ts](<Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>) | Transport callbacks, message state, persistence, and generation lifecycle are concentrated in one hook. |
| [Frontend/src](<Agentic Shiksha Platform/Frontend/src>) | Feature folders already exist; extend their ownership rather than replace the application's conventions. |
| [Admin-Dashboard](Admin-Dashboard) | Keep its two services independent. Its Python backend currently uses flat imports, which require a separate packaging migration. |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Working directories, dependency-cache paths, Python paths, and Docker contexts reference the current top-level service locations. |

Treat historical test counts and documentation as hints. Capture a fresh baseline
before moving or extracting code; do not infer a clean typecheck from a successful
frontend bundle build.

## 3. Target Repository Layout

This is the intended end state, not a request to create empty scaffolding. Create
modules when real implementations and their tests move into them.

```text
Agentic-Shiksha/
|-- Agentic Shiksha Platform/
|   |-- Backend/
|   |   |-- backend/
|   |   |   |-- main.py          # Compatibility entry point: backend.main:app
|   |   |   |-- app.py           # Application factory and assembly
|   |   |   |-- core/            # Settings, lifecycle, logging, errors
|   |   |   |-- dependencies/    # Auth and service providers for HTTP handlers
|   |   |   |-- routers/         # Endpoints grouped by domain
|   |   |   |-- schemas/         # Explicit request and response contracts
|   |   |   |-- services/        # Domain workflows and application policy
|   |   |   |-- runtime/         # Agent turns, dispatch, parsing, stream events
|   |   |   |-- integrations/    # Foundry, Cosmos, Blob, Search adapters
|   |   |   `-- protocols/       # Legacy SSE, AG-UI, and A2UI adapters
|   |   |-- agent_tools/         # Tool implementations and schemas
|   |   |-- prompt_store/        # Versioned instructions, preserved verbatim
|   |   |-- pipelines/          # Ingestion and research orchestration
|   |   |-- scripts/            # Maintenance and migration entry points
|   |   |-- tests/
|   |   |-- Dockerfile
|   |   `-- README.md
|   |-- Frontend/
|   |   |-- src/
|   |   |   |-- features/        # Feature-owned UI, hooks, state, API calls
|   |   |   |-- components/      # Domain-independent UI primitives
|   |   |   |-- layouts/
|   |   |   |-- lib/             # Small shared transport and utilities
|   |   |   `-- types/           # Genuinely shared frontend contracts
|   |   |-- Dockerfile
|   |   `-- README.md
|   `-- README.md               # Platform setup and service map
|-- Admin-Dashboard/
|   |-- backend/                # Independent API with the same layer rules
|   `-- frontend/               # Independent feature-organized client
|-- docs/                       # Cross-service architecture and operations
|-- .github/                    # CI, security automation, contributor guidance
|-- refactoring_plan.md
`-- README.md
```

Keep licenses, security policy, contribution guidance, and other community files
at the repository root. Preserve existing dependency manifests until the
explicit packaging phase. The platform folder is a filesystem grouping, not a
Python package or an additional build context.

A future root-level `components/` directory is optional. Add it only after a
specific component has independent tests, a stable interface, and identified
consumers. Shared source outside service directories requires an explicit
packaging and Docker-build design; ordinary service-local `COPY` instructions
cannot access it.

## 4. Module Boundaries

| Module | Owns | Must not own |
| --- | --- | --- |
| Application assembly and core | Startup validation, dependency construction, middleware, shutdown | Business workflows or endpoint implementations |
| Routers and dependencies | HTTP parsing, authorization dependencies, status codes, response mapping | Model loops or direct persistence queries |
| Schemas | Stable wire contracts and validation | SDK clients, environment reads, runtime state |
| Services | Course, chat, identity, learning, research, and asset workflows | HTTP request objects or application-global lookups |
| Runtime | Turn completion, tool sequencing, retries, cancellation, typed internal events | FastAPI imports, HTTP framing, or learner state on shared agent instances |
| Integrations | External SDK calls and persistence operations | HTTP handlers or product-level authorization policy |
| Protocols | Translate internal events into existing client protocols | Tool execution or additional model generation |
| Pipelines | Ingestion and research processing stages | App startup or endpoint registration |
| Frontend features | Feature UI, state transitions, hooks, and domain API clients | Reaching into another feature's private store |

Application assembly wires implementations into services. HTTP handlers call
services; services coordinate runtime, pipelines, tools, and adapters through
explicit dependencies. Lower layers must not import routers, `main`, or the
application factory. Add interfaces only at boundaries that benefit from
substitution or isolation in tests.

Consolidate existing implementations into these owners incrementally. Avoid
leaving both the old and new modules as active competing implementations. Any
temporary compatibility re-export needs known callers and a removal criterion.

## 5. Phased Execution

Status values: `not_started`, `in_progress`, `accomplished`, `blocked`.
Complete and verify one approved phase at a time. Large domain phases require
one domain per reviewable extraction; do not move every endpoint in one patch.

| Phase | Scope | Dependency | Status |
| --- | --- | --- | --- |
| 0 | Approval, baseline, and migration inventory | None | in_progress |
| 1 | Group the platform services | Phase 0 | in_progress |
| 2 | Backend application foundation | Phase 1 | in_progress |
| 3 | Backend domain extraction | Phase 2 | not_started |
| 4 | Agent runtime and protocol separation | Phase 3 chat boundary | not_started |
| 5 | Frontend feature separation | Stable API and stream contracts | not_started |
| 6 | Dashboard and pipeline organization | Established layer conventions | not_started |
| 7 | Packaging, documentation, and proven reuse | Completed extractions | not_started |

### Phase 0: Approval and Baseline

- Reconcile this proposal with the existing compliance plan after approval.
- Inventory tracked files and uncommitted changes without stashing, staging, or discarding the user's work.
- Inventory ignored local configuration and generated data by path only. Never put their contents in the plan or Git.
- Record API routes, methods, order-sensitive routes, operation IDs, request/response schemas, auth failures, and relevant headers.
- Capture chat event ordering, one-answer turn completion, tool retries, cancellation, and message-store synchronization with synthetic fixtures.
- Run current backend and dashboard tests, both frontend builds, and applicable container checks. Record pre-existing failures separately.
- Inventory path consumers: workflows, security scans, dependency automation, Docker, editor configuration, scripts, documentation, and runtime file lookups.

Acceptance: a reproducible baseline exists, phase scope is approved, and security
or configuration blockers are not mislabeled as successful checks.

### Phase 1: Group the Platform Services

Move the existing directories intact, preserving their casing:

| Source | Destination |
| --- | --- |
| `Backend/` | `Agentic Shiksha Platform/Backend/` |
| `Frontend/` | `Agentic Shiksha Platform/Frontend/` |
| `Admin-Dashboard/` | Unchanged |

- Keep the already-created parent folder; do not introduce a second spelling or rename it to a hyphenated alternative.
- Separate these moves and path fixes from source-level refactors and dependency upgrades.
- Preserve uncommitted edits and local configuration. Verify secret files remain ignored at their new paths before staging any moves.
- Update workflow working directories, `PYTHONPATH`, cache paths, build contexts, path filters, and security/dependency automation configuration.
- Update relative links, root service maps, scripts, and editor launch/test settings. Keep instruction files applicable after relocation; use the customization workflow if their behavior changes.
- Audit cross-service relative imports and lookups; the extra parent directory can change `parents[...]` resolution.
- Keep Docker contexts scoped to each service, in-container paths unchanged, and `uvicorn backend.main:app` working.
- Quote paths containing spaces in PowerShell, shell commands, and workflow commands. Test case-sensitive Linux builds as well as Windows paths.

Acceptance: both main services build and run from the new locations; baseline
contracts and tests pass; ignored secrets remain excluded from Git and images;
active tooling has no stale top-level service paths. No cloud resource names,
URLs, identity settings, or container runtime entry points change.

### Phase 2: Backend Application Foundation

- Introduce `create_app()` and explicit lifecycle ownership while preserving the public entry point, middleware order, and startup/shutdown behavior.
- Move one low-risk domain, such as health/configuration, to a router with contract tests before extracting additional domains.
- Centralize settings through the existing `pydantic_settings` approach, preserving environment names and precedence. Missing required configuration must still fail startup.
- Construct expensive clients once per application process and close them at shutdown. Keep service and schema imports free of network activity.
- Provide explicit service/auth dependencies so tests can replace external clients without importing the complete application.
- Preserve the actual health endpoint paths and responses captured in phase 0; do not invent a replacement health API.

Acceptance: application assembly and the extracted domain have clear ownership,
the original startup command works, and route, lifecycle, and missing-setting
checks pass. Do not manufacture empty routers or circular compatibility imports
just to make the entry point shorter.

### Phase 3: Backend Domain Extraction

Extract a router, relevant schemas, and service behavior together, moving existing
integration implementations only when required for that domain:

| Domain group | Responsibilities |
| --- | --- |
| Identity and directory | Sign-in callbacks, sessions, profiles, affiliations, role enforcement |
| Courses and agents | Agent creation, membership, setup, invitations, instructions, starters |
| Chat and learning | Conversation persistence/sharing, chat entry points, progress, assessments |
| Knowledge and assets | Retrieval, indexing, uploads/downloads, generated assets |
| Research and insights | Research entry points, feedback, teacher reporting |

- Preserve path matching order, authorization behavior, response shapes, and error mapping.
- Do not tighten validation in a move-only change. New typed schemas must represent current accepted inputs; intentional contract changes need separate approval.
- Keep session-derived identity authoritative and learner-specific state request-local.
- Reuse existing query/storage helpers. Do not replace SDK logic merely to rename a folder.
- Add import-boundary checks as domains become independent.

Acceptance per domain: focused tests and baseline contract comparisons pass;
routers do not perform direct cloud operations; service tests can use fakes.
Complete this phase only when the entry module contains no domain workflows.

### Phase 4: Agent Runtime and Protocols

- Extract turn state, tool dispatch, output parsing, citation/usage collection, and finalization from the existing agent implementation.
- Make initial and continuation requests use one tested turn executor where their behavior is genuinely identical.
- Preserve the recent duplicate-response fix: completing a reply must not invoke another model response; final tool outputs must remain recorded.
- Continue unfinished artifact plans and failed-tool handling. A multi-tool request is not a duplicate answer merely because it requires multiple model rounds.
- Preserve clarification waits, cancellation, keepalives, generation IDs, event ordering, and terminal error/completion semantics.
- Keep legacy SSE, AG-UI, and A2UI as adapters over the runtime's events.
- Keep prompt text and model configuration unchanged. When prompt files move, verify resolved paths and content equivalence; do not republish agents automatically.

Acceptance: existing stream regressions plus start/continue, artifacts, retries,
history-write failure, cancellation, and concurrent-user tests pass. Tests verify
model-call counts as well as visible message counts.

### Phase 5: Frontend Features

- Retain existing React, routing, Tailwind, Zustand, and visual conventions.
- Split chat into transport adaptation, pure stream/state reduction, generation lifecycle, persistence integration, and presentation hooks.
- Make ownership between local React state and persisted state explicit; preserve the session-expiry error visibility fix.
- Colocate feature-specific API clients, types, hooks, and components. Leave only domain-independent utilities in shared folders.
- Define public feature interfaces and avoid circular feature dependencies or broad barrel exports with side effects.
- Preserve persisted store keys and shape, thread switching, auth behavior, and the current API/protocol contracts. Storage-format changes require migrations and separate tests.

Acceptance: unchanged user-visible behavior, no new type/lint failures relative
to the baseline, production build success, and browser checks for sign-in,
streaming, interrupted requests, reload, and mobile layout.

### Phase 6: Dashboard, Pipelines, and Maintenance

- Apply the same domain/layer conventions to the dashboard without merging its deployment or importing the platform application.
- Migrate the dashboard's flat Python imports in a dedicated step with its own entry-point and image checks.
- Move existing ingestion and research orchestration behind explicit pipeline entry points; keep their operational semantics unchanged.
- Separate maintenance/migration commands from imported runtime code. Update callers and module entry points before removing old paths.
- Use explicit, lightweight package imports. Avoid creating a second ambiguous top-level `utils` package.
- Preserve ignored generated data and local environments. Delete apparently unused code only after checking runtime registration, dynamic imports, scripts, and tests.

Acceptance: all four services still build independently; pipeline and maintenance
entry points are discoverable and importable; verification does not run destructive
migrations or live data processing.

### Phase 7: Packaging, Documentation, and Reuse

- Adopt one approved Python dependency workflow per service with a reproducible lock and separate development dependencies. Do not leave competing hand-maintained dependency sources.
- Preserve the user's `agentic_shiksha_v1` environment as an available local runner; test production compatibility with Python 3.11 until an upgrade is separately approved.
- Add targeted formatting, lint, and import-boundary gates without hiding existing debt or mixing broad cleanup into behavior-sensitive refactors.
- Extend CI coverage to dashboard tests and images; both frontend builds and all four image builds should have explicit ownership.
- Evaluate genuinely shared protocol types, UI primitives, or integration utilities. Extract only when consumers agree on semantics and independent builds remain reproducible.
- Update the root service map, platform guide, existing service READMEs, contribution commands, and cross-service architecture documentation. Avoid duplicating setup instructions across many files.
- Remove temporary compatibility exports once their callers have migrated and the removal is tested.

Acceptance: a clean checkout has documented, reproducible setup and builds;
relative links work; reusable modules have tests and documented public contracts;
no obsolete import shims or duplicated active implementations remain.

## 6. Verification and Release Gates

| Area | Required evidence |
| --- | --- |
| Python tests | Focused tests after each extraction, then the affected full suite using CI placeholder configuration and mocked external services. |
| API compatibility | Compare route methods/paths, ordering, operation IDs, schemas, auth/error cases, and relevant headers against the baseline. |
| Agent behavior | Assert event ordering, finalization, model-call counts, tool-plan completion, retry, cancellation, and per-user isolation. |
| Frontend | Build both clients as affected; distinguish typechecking from bundling; record and avoid increasing pre-existing diagnostics. |
| Browser workflows | Test desktop/mobile chat, thread navigation, persistence, session expiry, tool blocks, and error recovery after frontend extraction. |
| Containers | Build the affected service images with the new paths and original contexts; inspect contents and verify startup. A path-only migration requires both platform images. |
| Security | Verify ignore rules and image exclusions; run existing secret/dependency/CodeQL checks without suppressing new findings. Never weaken auth, TLS, or path containment to unblock a refactor. |
| Documentation | Resolve relative links and verify command working directories; distinguish proposed paths from existing ones. |

Use synthetic data. Unit tests must not consume live model capacity or mutate
cloud resources. A boot check that needs public identity discovery is a separate
check from isolated unit tests. If a gate is unavailable, report it as unverified
rather than marking the phase accomplished.

Deployment is a separate, explicitly approved action after local and CI gates.
Retain the previous image for rollback, use a fresh immutable image reference,
and verify real application behavior rather than only the configured image tag.

## 7. Risks and Controls

| Risk | Control |
| --- | --- |
| Spaces in the new platform path | Quote shell arguments and verify workflows on Linux and Windows. |
| Local secrets becoming tracked during relocation | Inventory by path, verify ignore rules at destination, and inspect staged paths without printing values. |
| Relative prompt/data paths changing | Test resource lookup from the actual service working directory and built image. |
| Circular imports after extraction | Keep assembly at the top; lower modules cannot import the application. Add focused import checks. |
| Moving globals changes startup timing | Preserve lifecycle behavior first; move side effects under explicit startup with dedicated tests. |
| A stricter schema changes accepted requests | Capture baseline inputs; separate validation changes from structural moves. |
| Chat duplication or lost error bubbles returns | Preserve model-call-count and store-synchronization regression coverage. |
| Shared code breaks independent Docker contexts | Package it deliberately or keep it service-local until a build strategy is approved. |
| Cosmetic folder moves leave the same coupling | Require service tests without application imports and enforce module dependency direction. |

## 8. Completion and Rollback

The refactor is complete when the platform services live under their agreed
parent folder, all four services remain independently deployable, HTTP handlers
are separated from workflows/integrations, agent and frontend state ownership is
explicit, and the verification gates pass without functional or security regressions.

Do not judge completion by folder count or an arbitrary file-length target.
Every new module must have a defined responsibility, real consumers, and suitable
tests.

Keep relocation changes separate from internal refactors. After each approved
phase, record its changed paths, checks with actual results, unresolved issues,
and rollback approach here. Stop before the next phase. If commits are later
authorized, use reviewable phase/domain commits; never create commits or rewrite
history automatically. Any rollback must preserve unrelated work and ignored
local configuration. Production rollback, if needed after a separately approved
deployment, restores the previous image without reversing user data.

### Execution Record

- Proposal created: 2026-09-11.
- Phase 0 approved and started: 2026-09-11.
- Local phased refactoring and the service move explicitly authorized: 2026-09-29.
- `Backend/` and `Frontend/` moved intact to `Agentic Shiksha Platform/`; the
  original top-level directories no longer exist. Existing ignored environment
  files moved with their services and remain ignored.
- Active path consumers updated: CI working directories, Python path and caches,
  Docker contexts, Dependabot roots, ignore rules, editor task, cross-service
  links, contributor commands, and service maps. A 27-document relative-link
  check and active CI/Dependabot path check found no missing target.
- Backend foundation started with `backend/app.py`,
  `backend/routers/system.py`, and factory/contract tests. The production
  `backend.main:app` now assembles its existing route registry through the
  factory; health/configuration routes moved without wire-contract changes.
- Frontend chat ownership started by extracting response normalization and
  generation/typing/tool-label policy from `useAgentChat.ts`, with focused
  Playwright coverage.
- Verification: 780 backend tests passed, 78 skipped, and 149 subtests passed;
  19 admin-backend tests passed; both frontend production builds passed; Python
  compilation passed; 7 pure chat-policy and 2 browser lifecycle tests passed.
  The offline API check retained 218 OpenAPI operations across 184 paths with
  unique emitted operation IDs; health, config, docs CSS, and CORS checks passed.
- The relocated backend, frontend, and test preview restarted successfully on
  ports 8000, 5173, and 4192.
- Phase 1 remains `in_progress` because Docker Desktop's Linux engine did not
  respond, so the two relocated container contexts could not be built locally.
  No cloud resources, dependencies, remote agents, deployment, Git staging, or
  commit were changed.