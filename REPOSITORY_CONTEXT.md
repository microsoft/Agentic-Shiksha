# Agentic Shiksha: Repository Context

Snapshot date: 2026-09-24. Scope: the current working tree, including uncommitted work.

Maintenance update (2026-09-25): the TA runtime now lives in
[Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py>), and the main API imports it
directly. The legacy [Agentic Shiksha Platform/Backend/base\_agents/general\_agent.py](<Agentic Shiksha Platform/Backend/base_agents/general_agent.py>)
path remains a module alias sharing all runtime/tool/cache state. Implementation links
below follow the new location; the original analysis otherwise remains a dated snapshot.
Post-extraction verification passed 525 backend tests plus 146 subtests, 17 dashboard
tests, Python compilation, the frontend typecheck/build, and an offline API health/218-route
preservation check. This update is local source only, not a new Docker or live deployment.

Maintenance update (2026-09-29): Flashcards and their agent tool have been retired
from the local source. Supported-tool and rendering inventories below reflect the
removal. Legacy calls and new asset writes are rejected; saved blocks and assets
remain stored but are not displayed. This does not delete data, update existing
remote agent definitions, or deploy either application service.

Maintenance update (2026-09-29): the main services now live under
[Agentic Shiksha Platform](<Agentic Shiksha Platform>). The FastAPI service retains
`backend.main:app` while assembly lives in
[backend/app.py](<Agentic Shiksha Platform/Backend/backend/app.py>) and the public
health/configuration routes live in
[routers/system.py](<Agentic Shiksha Platform/Backend/backend/routers/system.py>).
Pure chat response and generation-lifecycle policy moved out of `useAgentChat.ts`.
Local tests, builds, compilation, route/OpenAPI checks, and the three restored dev
servers passed. Container builds remain unverified because the local Docker Linux
engine was unavailable. No cloud resource, dependency, remote-agent definition,
deployment, staging operation, or commit changed.

This is an implementation-based handoff, not a roadmap or a live-environment audit.
Evidence includes route/tool AST inventories, source and schema reads, prompt composition,
frontend call sites, Python symbol references, dependency manifests, Docker/CI configs,
and the explicitly labelled verification from the preceding work in this conversation.
It excludes credentials, real learner records, dependencies' source and binary course
materials. Code presence does not establish deployment or operational health. Older
README/plan comments are not treated as authoritative when implementation disagrees.

## 1. Product

Agentic Shiksha is a research teaching-and-learning platform built around course Teaching
Assistants, curriculum-grounded learning, structured learning artifacts, and learner progress.
The implementation also includes separate operational/analytics services.

It is not just a chat wrapper. Teachers configure course descriptions, textbooks, files,
prerequisites and starters; the platform creates a named Foundry TA, builds searchable
course material, generates a modular curriculum and threshold concepts, and records
learner activity and first-attempt concept assessments. See `CreateView.handleCreateAgent`
in [Agentic Shiksha Platform/Frontend/src/features/create/CreateView.tsx](<Agentic Shiksha Platform/Frontend/src/features/create/CreateView.tsx>)
and `advance_creation` / `run_curriculum_research` in
[Agentic Shiksha Platform/Backend/utils/course\_creation.py](<Agentic Shiksha Platform/Backend/utils/course_creation.py>).

### Users and journeys

- **Students:** an administrator invites/assigns them; they sign in, complete onboarding,
	choose an assigned TA, converse, open generated artifacts, answer concept inventories,
	inspect course progress and run educational circuits.
- **Teachers / co-teachers:** create/edit TAs and materials, inspect/generate/version a
	curriculum, manage supported course settings, and use a teacher-scoped dashboard for
	roster activity, misconceptions, evidence and AI-assisted insights.
- **Administrators / superadministrators:** directory/institute/department management,
	explicit student assignment, teacher assignment/ownership administration, cross-course
	usage and evaluation. Main and standalone admin APIs do not currently enforce these
	roles consistently; see Security Findings below.
- **Public viewers:** open a tokenized read-only chat share. A share link and a TA join
	code are different capabilities; neither is a substitute for student assignment.

### Implemented versus qualified

Implemented surfaces include OAuth/onboarding, TA creation, resumable material jobs,
course chat, rich artifacts, first-attempt quizzes, threshold-concept progress,
curriculum editing/history/translation, public shares, explicit rosters, teacher/admin
analytics, generated images, slides/PPTX export, and a bounded ngspice circuit editor.

Do not infer a production-complete product from those surfaces. It is labelled a
research project, several old APIs remain reachable, course creation may complete
before materials/curriculum, and advanced model behavior depends on external named
Foundry definitions. The root README advertises lifelong personal "Lumens", while the
current route/type inventory principally implements course TAs and a **Course Companion
form assistant**. Those are not evidence of a separate full lifelong-companion backend.

## 2. Repository Structure

| Service | Implementation | Container entry |
| --- | --- | --- |
| Main application frontend | [Agentic Shiksha Platform/Frontend/package.json](<Agentic Shiksha Platform/Frontend/package.json>) | Nginx serving a Vite build: [Agentic Shiksha Platform/Frontend/Dockerfile](<Agentic Shiksha Platform/Frontend/Dockerfile>) |
| Main application backend | [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py>) | `uvicorn backend.main:app`: [Agentic Shiksha Platform/Backend/Dockerfile](<Agentic Shiksha Platform/Backend/Dockerfile>) |
| Admin dashboard frontend | [Admin-Dashboard/frontend/package.json](Admin-Dashboard/frontend/package.json) | Nginx serving a separate Vite build: [Admin-Dashboard/frontend/Dockerfile](Admin-Dashboard/frontend/Dockerfile) |
| Admin dashboard backend | [Admin-Dashboard/backend/main.py](Admin-Dashboard/backend/main.py) | `uvicorn main:app`, port 8050: [Admin-Dashboard/backend/Dockerfile](Admin-Dashboard/backend/Dockerfile) |

The root README's `Dashboard/` path is stale; the actual directory is `Admin-Dashboard/`.

| Directory / file | Responsibility and why it matters |
| --- | --- |
| [Agentic Shiksha Platform/Frontend/src/main.tsx](<Agentic Shiksha Platform/Frontend/src/main.tsx>), [Agentic Shiksha Platform/Frontend/src/router.tsx](<Agentic Shiksha Platform/Frontend/src/router.tsx>) | Browser entry and actual route registration |
| [Agentic Shiksha Platform/Frontend/src/layouts/MainLayout.tsx](<Agentic Shiksha Platform/Frontend/src/layouts/MainLayout.tsx>) | Protected shell, selected TA, app context and builder state |
| [Agentic Shiksha Platform/Frontend/src/pages](<Agentic Shiksha Platform/Frontend/src/pages>) | Route screens; `ChatView` also owns many modals and artifact-pane states |
| [Agentic Shiksha Platform/Frontend/src/features/chat](<Agentic Shiksha Platform/Frontend/src/features/chat>) | Streaming hook and trusted educational block renderers |
| [Agentic Shiksha Platform/Frontend/src/features/create](<Agentic Shiksha Platform/Frontend/src/features/create>), [Agentic Shiksha Platform/Frontend/src/features/edit](<Agentic Shiksha Platform/Frontend/src/features/edit>) | Teacher setup, companion form patching, materials and TA lifecycle UI |
| [Agentic Shiksha Platform/Frontend/src/lib](<Agentic Shiksha Platform/Frontend/src/lib>) | Stores, API transports, sync/pagination, shared models, parsers, identity and local logging |
| [Agentic Shiksha Platform/Frontend/src/features/dashboard](<Agentic Shiksha Platform/Frontend/src/features/dashboard>) | Embedded teacher dashboard, independent of the admin SPA |
| [Agentic Shiksha Platform/Frontend/src/components/assets](<Agentic Shiksha Platform/Frontend/src/components/assets>), [Agentic Shiksha Platform/Frontend/src/components/ui](<Agentic Shiksha Platform/Frontend/src/components/ui>) | Artifact reuse and Radix-based UI primitives |
| [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py>) | Main FastAPI composition plus legacy routes, creation/research helpers and auth callbacks |
| [Agentic Shiksha Platform/Backend/backend/routers](<Agentic Shiksha Platform/Backend/backend/routers>), [Agentic Shiksha Platform/Backend/backend/schemas](<Agentic Shiksha Platform/Backend/backend/schemas>), [Agentic Shiksha Platform/Backend/backend/dependencies](<Agentic Shiksha Platform/Backend/backend/dependencies>) | Newer typed feature APIs, request/result contracts and access dependencies |
| [Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py>) | Central TA conversation/tool loop; an important high-risk orchestration module |
| [Agentic Shiksha Platform/Backend/base\_agents/agent\_manager.py](<Agentic Shiksha Platform/Backend/base_agents/agent_manager.py>) | Shared lifecycle manager used by legacy course creation; not the main streaming orchestrator |
| [Agentic Shiksha Platform/Backend/agent\_tools/custom](<Agentic Shiksha Platform/Backend/agent_tools/custom>), [Agentic Shiksha Platform/Backend/agent\_tools/hosted](<Agentic Shiksha Platform/Backend/agent_tools/hosted>) | Local function-tool handlers/schemas versus Foundry-hosted tool construction |
| [Agentic Shiksha Platform/Backend/agent\_tools/a2ui](<Agentic Shiksha Platform/Backend/agent_tools/a2ui>), [Agentic Shiksha Platform/Backend/backend/agui.py](<Agentic Shiksha Platform/Backend/backend/agui.py>) | Trusted widget catalog, A2UI payload conversion and AG-UI event translation |
| [Agentic Shiksha Platform/Backend/prompt\_store](<Agentic Shiksha Platform/Backend/prompt_store>) | Core course prompt modules, helper prompts and reference/older prompt versions; loading must be checked per caller |
| [Agentic Shiksha Platform/Backend/azure\_services](<Agentic Shiksha Platform/Backend/azure_services>) | Foundry, Cosmos, Blob, Search, memory and Content Safety integrations |
| [Agentic Shiksha Platform/Backend/utils/material\_jobs.py](<Agentic Shiksha Platform/Backend/utils/material_jobs.py>), [Agentic Shiksha Platform/Backend/utils/course\_creation.py](<Agentic Shiksha Platform/Backend/utils/course_creation.py>) | Durable processing state, leases, current creation and curriculum worker |
| [Agentic Shiksha Platform/Backend/utils/circuit\_simulation.py](<Agentic Shiksha Platform/Backend/utils/circuit_simulation.py>), [Agentic Shiksha Platform/Backend/utils/circuit\_devices.py](<Agentic Shiksha Platform/Backend/utils/circuit_devices.py>), [Agentic Shiksha Platform/Backend/utils/circuit\_measurements.py](<Agentic Shiksha Platform/Backend/utils/circuit_measurements.py>) | Bounded deterministic simulator, device models and instruments |
| [Agentic Shiksha Platform/Backend/teacher\_dashboard](<Agentic Shiksha Platform/Backend/teacher_dashboard>) | Main-service teacher-scoped queries, evidence, analytics agent and token reconciliation |
| [Admin-Dashboard](Admin-Dashboard) | Separate React/FastAPI admin apps, their own dependencies, auth/query drift and build artifacts |
| [Agentic Shiksha Platform/Backend/tests](<Agentic Shiksha Platform/Backend/tests>), [Agentic Shiksha Platform/Frontend/chat-persistence.spec.ts](<Agentic Shiksha Platform/Frontend/chat-persistence.spec.ts>), [Agentic Shiksha Platform/Frontend/share-ta.spec.ts](<Agentic Shiksha Platform/Frontend/share-ta.spec.ts>), [Agentic Shiksha Platform/Frontend/slides.spec.ts](<Agentic Shiksha Platform/Frontend/slides.spec.ts>) | Behavioral regressions and mocked browser integration; do not assume all are executed by CI |
| [Agentic Shiksha Platform/Backend/scripts](<Agentic Shiksha Platform/Backend/scripts>) | Manual graph-memory administration utilities, not normal request processing. Legacy v1-to-v2 cutover scripts have been archived outside the source tree. |
| [.github/workflows](.github/workflows), [.github/dependabot.yml](.github/dependabot.yml) | Actual automation versus aspirational compliance requirements |
| [Agentic Shiksha Platform/Backend/PLAN.md](<Agentic Shiksha Platform/Backend/PLAN.md>), [refactoring\_plan.md](refactoring_plan.md), [ENGINEERING\_ASSESSMENT.md](ENGINEERING_ASSESSMENT.md) | Historical plans/assessments; verify each assertion against current code before treating it as state |

`CITS Electrician/` contains course/question-bank/study-material directories, not a fifth
application. `Agentic Shiksha Platform/` was empty at inspection. Local `user_data`,
`.azure`, environment files, binaries, dependency trees, build outputs and browser-test
artifacts were not treated as product source or copied into this report.

## 3. Frontend Architecture

### Framework and routes

The main frontend is React 19/TypeScript, React Router 7, Zustand 5, Tailwind **3**, and
`vite` aliased to `rolldown-vite@7.2.2`, not a Next.js application. Radix primitives,
Lucide icons, Framer Motion, Markdown/KaTeX/Mermaid rendering and Azure Speech support
are declared in [Agentic Shiksha Platform/Frontend/package.json](<Agentic Shiksha Platform/Frontend/package.json>).

[Agentic Shiksha Platform/Frontend/src/router.tsx](<Agentic Shiksha Platform/Frontend/src/router.tsx>) defines the real navigation contract:

| Routes | Screen / boundary |
| --- | --- |
| `/auth`, `/auth/callback`, `/signout` | Backend OAuth round trip and session cleanup |
| `/onboarding` | Authenticated profile setup outside the normal sidebar |
| `/home`, `/course/:courseName`, `/chat/:courseName/:threadId` | `ChatView`; a course can be selected before a local conversation exists |
| `/library` | `LibraryView`, TA discovery/management |
| `/create`, `/edit/:courseName` | `CreateView` and `EditView` |
| `/assets` | `AssetsView`, persisted generated artifacts |
| `/dashboard`, `/dashboard/:section` | Embedded `TeacherDashboard`, client capability-gated |
| `/shared/:shareToken` | Public `SharedChatView`, outside `AuthGuard` |
| `/join/:code` | `JoinAgentPage`, preserves pending link across authentication |
| `/settings`, `/learn`, `/help` | Account/preferences and product information |
| `/companion-animations` | Companion appearance/animation surface |
| `/companion-appearance` | Redirects to `/create`, not an independent deployed companion screen |

The separate dashboard has its own router:
[Admin-Dashboard/frontend/src/App.tsx](Admin-Dashboard/frontend/src/App.tsx).
`/overview`, `/analytics`, `/user-directory`, and `/feedback` all mount `DashboardView`;
this is a different application from the embedded teacher dashboard.

Admin import source update (2026-09-28): **Add New User -> Import from CSV** has
independent College/Institution, Department and TA dropdowns directly above the
upload control. All three are required for CSV import and are filtered in order.
The file contains only `name,email,role`; the single-user form does not supply
the import's destination or role. Student and teacher rows add membership;
admin rows are directory-only. See the
[admin workflow](Admin-Dashboard/README.md#adding-users-with-a-courseta).

### State, identity and persistence

- [Agentic Shiksha Platform/Frontend/src/lib/chatStore.ts](<Agentic Shiksha Platform/Frontend/src/lib/chatStore.ts>): Zustand store for
	projects, local threads, messages, active course/thread, learner profile preferences,
	and profile-injection hashes. The persisted browser cache is not the database.
- [Agentic Shiksha Platform/Frontend/src/lib/userStore.ts](<Agentic Shiksha Platform/Frontend/src/lib/userStore.ts>): client identity/role
	cache. Do not treat client roles or IDs as authorization evidence.
- [Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts](<Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts>): translates local
	messages to API records, fingerprints full serialized messages (not only counts),
	debounces sync at 1 second, and supplies `flushConversationForSharing` with a 20-second
	save barrier. Its `toApiMessage` moves blocks, sources, research and token usage into
	metadata; `fromApiMessage` reconstructs them. This is independent of the Foundry
	conversation history used for inference.
- [Agentic Shiksha Platform/Frontend/src/lib/useAuth.ts](<Agentic Shiksha Platform/Frontend/src/lib/useAuth.ts>): redirects to backend
	Microsoft/Google OAuth; probes `/auth/me` with credentials. The session token is an
	HttpOnly cookie. `storeAuthToken` and `getAuthToken` are compatibility stubs, not an
	active localStorage-token scheme. Module-level sync flags and persisted identity
	require care when debugging logout, account switching or stale sessions.
- [Agentic Shiksha Platform/Frontend/src/components/auth/AuthGuard.tsx](<Agentic Shiksha Platform/Frontend/src/components/auth/AuthGuard.tsx>):
	authentication/onboarding gate; `BYPASS_AUTH` exists but is currently `false`.
	Its allowance for an unloaded `userStatus` is a UI behavior, not server authorization.

### Rendering and models

[Agentic Shiksha Platform/Frontend/src/lib/types.ts](<Agentic Shiksha Platform/Frontend/src/lib/types.ts>) defines distinct `ChatMsg`
(UI), `ChatMessage` (local persisted), `ChatThread`, `ChatContext`, `Project`, `Asset`,
`ResearchData`, and `ChatSource` representations. `AgentKind` is currently only `course`.
`ChatContext.sessionUuid` is used for the Foundry conversation ID; the material session
UUID in course setup is a different identifier with a different isolation purpose.

Renderable `ContentBlock` variants are text, document, quiz, challenge, TikZ image,
generated image, circuit, slides, clarification, suggested queries and tool activity.
The legacy flashcard discriminator is retained only to preserve historical records.
`UnifiedChatContainer` forwards blocks and callbacks to the chat surface and composer;
`ChatBubble` selects their renderers. Adding a block requires coordinating serialization,
stream decoding, save/reload, sharing and asset rendering, not merely adding a component.
See [Agentic Shiksha Platform/Frontend/src/components/chat/UnifiedChatContainer.tsx](<Agentic Shiksha Platform/Frontend/src/components/chat/UnifiedChatContainer.tsx>),
[Agentic Shiksha Platform/Frontend/src/features/chat/ChatBubble.tsx](<Agentic Shiksha Platform/Frontend/src/features/chat/ChatBubble.tsx>), and
[Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts](<Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>).

The latter supports legacy SSE and an opt-in AG-UI adapter, generation/abort guards,
structured-block accumulation, retry groups, attachments and research state. This is
not a WebSocket application. Circuit drafts now publish a transient, user/agent/thread-
scoped `circuitChatContext`; the outgoing question includes current topology and fresh
compact readings, while the visible user message does not contain the hidden snapshot.
Unsaved or failed states do not label old readings as current. This context is cleared
when the editable pane closes. See [Agentic Shiksha Platform/Frontend/src/lib/circuit.ts](<Agentic Shiksha Platform/Frontend/src/lib/circuit.ts>)
and [Agentic Shiksha Platform/Frontend/src/features/chat/CircuitBlock.tsx](<Agentic Shiksha Platform/Frontend/src/features/chat/CircuitBlock.tsx>).

### APIs, documents and realtime details

[Agentic Shiksha Platform/Frontend/src/lib/api.ts](<Agentic Shiksha Platform/Frontend/src/lib/api.ts>) supplies `request`, `requestForm`,
`streamAgentChat`, materials/creation polling, agent settings and educational endpoints;
both request helpers include cookies. [Agentic Shiksha Platform/Frontend/src/lib/chatApi.ts](<Agentic Shiksha Platform/Frontend/src/lib/chatApi.ts>)
is a separate persistence/assets/profile/assessment client. The embedded teacher dashboard
has [Agentic Shiksha Platform/Frontend/src/features/dashboard/lib/dashboardApi.ts](<Agentic Shiksha Platform/Frontend/src/features/dashboard/lib/dashboardApi.ts>);
the standalone SPA has its own API and dashboard clients. These are manually maintained
contracts, not generated OpenAPI clients.

`VITE_API_BASE_URL` controls the main API client, while `useAuth` reads `VITE_API_URL`.
Those aliases must agree. Standalone admin requests intentionally distinguish the main
backend (assignments/session) from `VITE_DASHBOARD_API_URL` (analytics).

`useAgentChat` decodes structured callbacks into a local transcript and later the store.
[Agentic Shiksha Platform/Frontend/src/lib/agui.ts](<Agentic Shiksha Platform/Frontend/src/lib/agui.ts>) implements SSE/AG-UI parsing and
A2UI surface/model updates; [Agentic Shiksha Platform/Frontend/src/lib/aguiAdapter.ts](<Agentic Shiksha Platform/Frontend/src/lib/aguiAdapter.ts>)
reconstructs the legacy callbacks. `VITE_USE_AGUI=true` opts in; off is the code default.
No separate reactive server push channel automatically updates all clients when another
user edits a course. Polling, local invalidation and navigation reloads carry those updates.

`AssetContent` reuses the live educational renderers for saved data, with read-only gates.
Documents use `DocumentWithSectionRail`; Markdown parsing includes raw HTML parsing
**followed by sanitization**, and Mermaid uses strict security mode, so raw HTML support
alone is not evidence of unsanitized rendering. Uploaded images have immediate local
previews, base64 model inputs and background Blob persistence; generated images persist
URLs rather than megabytes of base64 in Cosmos. Slides have a separate validated
`SlideDeck` model; circuit `CircuitSpec`/`CircuitResult` have matching handwritten
TypeScript/Pydantic representations.

[Agentic Shiksha Platform/Frontend/src/pages/LibraryMedia.tsx](<Agentic Shiksha Platform/Frontend/src/pages/LibraryMedia.tsx>) builds the
media grid from `messagesByThreadId`. A cache/hydration-limited history means this grid
is not guaranteed to enumerate every historical image in storage. Large-history retrieval
is handled separately by [Agentic Shiksha Platform/Frontend/src/lib/useMessagePagination.ts](<Agentic Shiksha Platform/Frontend/src/lib/useMessagePagination.ts>).

## 4. UX and Interaction Architecture

### Navigation and workspaces

`MainLayout` owns the protected shell, selected TA and creation form context. The browser
URL selects a course/conversation; the Zustand active thread and Foundry conversation ID
must be synchronized with it. `ChatView` coordinates TA actions, history drawer, draft
composer, sharing, syllabus modal, material information and the right-hand artifact pane.
See [Agentic Shiksha Platform/Frontend/src/layouts/MainLayout.tsx](<Agentic Shiksha Platform/Frontend/src/layouts/MainLayout.tsx>) and
[Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx](<Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>).

- **Create TA:** one setup form, optional Course Companion, file-preflight confirmation,
	asynchronous material/creation status, resumable creation job, then management-code
	reveal and navigation to a new course conversation. Successful TA creation explicitly
	distinguishes "materials ready" from "materials still processing".
- **Learn:** conversation starters or a free-form question; streamed prose/tool activity;
	artifact cards open a workspace rather than replacing the conversation. Selection-based
	Ask TA and syllabus topic actions compose contextual questions.
- **Curriculum:** modules/concepts/history views, progress state, teacher edit/commit,
	translation and retry for incomplete generation. A syllabus-only partial result is not
	the same thing as a complete threshold-concept curriculum.
- **Assessment:** concept-inventory cards, answer selection, explanations and feedback;
	first submissions are distinguished from later practice. Correct answers are present
	in browser block data, so these are formative learning tools, not secure examinations.
- **Simulation:** learners request a simulation in chat; `add_circuit` returns an
	interactive Open card, not a standalone TA-menu shortcut. Circuit Lab has the fixed-size schematic and dock tabs (Components,
	Simulation, Meters, Waveforms, Readings), Run/Pause, scoped draft, CSV/SVG, zoom and
	fullscreen. Circuit Lab opens directly, without a trainer mode. Historical
	trainer-only assets are hidden; valid saved circuit envelopes remain viewable.
- **Presentation/document:** dedicated pane, download and fullscreen; documents also
	have copy. Slides have thumbnail/navigation/notes/source controls and a native
	PPTX export API, without a clipboard Copy button.
- **Teacher insights:** data selection and evidence-oriented analytics, plus a scoped
	assistant. Admin directory/research functions live in the separate dashboard.

Reusable primitives are in [Agentic Shiksha Platform/Frontend/src/components/ui](<Agentic Shiksha Platform/Frontend/src/components/ui>)
and the common chat/asset layers. Important specialized primitives include
[Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx](<Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx>),
[Agentic Shiksha Platform/Frontend/src/components/assets/AssetFullscreenButton.tsx](<Agentic Shiksha Platform/Frontend/src/components/assets/AssetFullscreenButton.tsx>),
[Agentic Shiksha Platform/Frontend/src/features/chat/AskTASelection.tsx](<Agentic Shiksha Platform/Frontend/src/features/chat/AskTASelection.tsx>),
[Agentic Shiksha Platform/Frontend/src/features/create/MaterialWorkflow.tsx](<Agentic Shiksha Platform/Frontend/src/features/create/MaterialWorkflow.tsx>),
and [Agentic Shiksha Platform/Frontend/src/features/create/FormAssistant.tsx](<Agentic Shiksha Platform/Frontend/src/features/create/FormAssistant.tsx>).

### Interaction limitations

Navigation state, server status and editor-local state have different lifetimes. A closed
circuit pane stops sending its live context; a transient animation is not a new solver
measurement. Several legacy "course/exam/learning" names and dormant builder callbacks
remain even though the main product now creates one `course` TA. Teacher and admin
dashboards duplicate chat/Markdown/control code instead of sharing one design/runtime
package. `isMyAgent` temporarily permits an unknown creator ID in `ChatView`, so initial
client affordances are not reliable authorization decisions. These are specific reasons
to keep server checks authoritative and derive UI state from explicit workflow status.

## 5. Backend Architecture

### Composition and execution

The main service is FastAPI assembled at module import in
[Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py>), with `lifespan`, many inline routes,
and included routers under [Agentic Shiksha Platform/Backend/backend/routers](<Agentic Shiksha Platform/Backend/backend/routers>).
It has **not** completed the requested `create_app()`/typed-service refactor described
in repository instructions. Environment loading and construction of OAuth helpers occur
at import time; newer router lifespans own selected clients and workers.

The older SDK surface is adapted by compatibility wrappers, while `GeneralAgent`
uses named, versioned Foundry agents and OpenAI Conversations/Responses. Most cloud SDK
access is synchronous. Async handlers commonly use `asyncio.to_thread`; streaming
responses consume synchronous generators and use a daemon producer/queue to emit
15-second SSE keepalives. Main startup raises AnyIO's sync-thread limit (default 160)
and starts token reconciliation. This improves concurrency but is not a distributed
queue, global rate limiter or cancellation guarantee.

### Main endpoint families

| Surface | Representative endpoints | Actual owner |
| --- | --- | --- |
| Auth / startup | `/auth/login`, `/auth/callback`, Google equivalents, `/auth/me`, `/auth/logout`; `/api/health`, `/api/healthz`, `/api/config`, `/api/speech/token` | `main.py`, [Agentic Shiksha Platform/Backend/auth.py](<Agentic Shiksha Platform/Backend/auth.py>), [Agentic Shiksha Platform/Backend/google\_auth.py](<Agentic Shiksha Platform/Backend/google_auth.py>) |
| TA discovery / access | `GET /api/azure/agents/list`; `/api/agents/{agent_id}/students`, `/members`; `POST /api/agents/connect-by-code` | [Agentic Shiksha Platform/Backend/backend/routers/agent\_membership.py](<Agentic Shiksha Platform/Backend/backend/routers/agent_membership.py>) |
| Current creation | `POST /api/agents/create-async`; `GET /api/agents/creation-jobs/{job_id}`; `/retry` | [Agentic Shiksha Platform/Backend/backend/routers/course\_creation.py](<Agentic Shiksha Platform/Backend/backend/routers/course_creation.py>) |
| Form assistant | `POST /api/course-form/assist` | [Agentic Shiksha Platform/Backend/backend/routers/course\_form\_assistant.py](<Agentic Shiksha Platform/Backend/backend/routers/course_form_assistant.py>) |
| Materials | `POST /api/knowledge/preflight`, `/drafts`, `/build`; `/knowledge/jobs/{job_id}` plus `/process` and `/events`; `/agents/{agent_name}/course-materials`, `/file`; `/knowledge/update-index`, `/index-status` | [Agentic Shiksha Platform/Backend/backend/routers/course\_materials.py](<Agentic Shiksha Platform/Backend/backend/routers/course_materials.py>) |
| Curriculum | `/api/agents/{agent_name}/course-curriculum`, `/retry`, legacy retry aliases; update, `/versions`, `/diff` | Current read/job router plus legacy editing/history in `main.py` |
| Translation | GET/POST `/api/agents/{agent_name}/course-curriculum/translations`; GET `/{language}/{style}` | [Agentic Shiksha Platform/Backend/backend/routers/curriculum\_translation.py](<Agentic Shiksha Platform/Backend/backend/routers/curriculum_translation.py>) |
| Model chat | `/api/agents/{agent_id}/chat/start`, `/continue`, `/stream`, `/agui`; `/api/clarify/{clarify_id}` | `agent_chat_*`, `_open_agent_stream` and protocol adapters in `main.py` |
| Suggestions / titles | `/api/agents/{agent_name}/chat/suggestions`; `/api/chat/generate-title` | [Agentic Shiksha Platform/Backend/backend/routers/chat\_suggestions.py](<Agentic Shiksha Platform/Backend/backend/routers/chat_suggestions.py>), `main.py` |
| Transcript persistence | `/api/chat/threads/{user_id}`, `/thread/{thread_id}`, `/message`, `/sync`, `/load/{user_id}` | Legacy `main.py` handlers and `cosmos_db.py`; not the same as model conversation APIs |
| Sharing | POST/DELETE `/api/chat/thread/{thread_id}/share`; public GET `/api/shared/{share_token}` | [Agentic Shiksha Platform/Backend/backend/routers/chat\_sharing.py](<Agentic Shiksha Platform/Backend/backend/routers/chat_sharing.py>), public serializer in `main.py` |
| Assessment/progress | `/api/quiz-assets`, `/quiz-attempts/first`, `/quiz-attempts/{quiz_id}/first`, `/feedback`; `/agents/{agent_name}/progress/{user_id}`, `/reset-progress/{user_id}` | `main.py` and Cosmos progress/assessment helpers |
| Assets / media | `/api/assets` CRUD/public list; agent-image upload/read/delete; `/api/blob/*`; PDF/document extraction; user feedback attachment | `main.py`, Blob manager, asset persistence helpers |
| Circuit simulation | `/api/agents/{agent_name}/circuit/simulate`, `/circuit/tool` | [Agentic Shiksha Platform/Backend/backend/routers/circuit.py](<Agentic Shiksha Platform/Backend/backend/routers/circuit.py>) |
| Slides | `/api/agents/{agent_name}/slides/tool`, `/slides/export` | [Agentic Shiksha Platform/Backend/backend/routers/slides.py](<Agentic Shiksha Platform/Backend/backend/routers/slides.py>) |
| Teacher analytics | `/api/teacher-dashboard/*` | [Agentic Shiksha Platform/Backend/teacher\_dashboard/routes.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/routes.py>) |
| Legacy/configuration | `/api/cca/*`, `/caca/*`, `/agents/create-direct`, `/agents/create-course`, `/api/courses*`, numerous per-session/unified/KB/MCP index-management APIs | `main.py`; coexist with current routers, not the principal create-screen path |

The standalone API in [Admin-Dashboard/backend/main.py](Admin-Dashboard/backend/main.py)
provides `/api/dashboard/*` for course/student/token overview, ownership/teacher management,
image quota, evaluation and logging-agent chat; it also exposes directory/profile APIs
and institute/department research. It reads shared storage directly rather than calling
the main API for every analytics operation. The admin frontend's student-assignment flow
does call the **main** API, so two backend origins are intentional.

### Background work

`materials_lifespan` starts `material_jobs.run_worker` and
`course_creation.run_curriculum_worker`. Jobs live in `courses_v2`, use deterministic IDs,
ETags, five-minute leases renewed every 30 seconds, checkpoints, bounded retries and
pollable state. Material workers poll every five seconds (up to four candidate IDs);
curriculum workers poll every ten seconds and claim one job. Work still runs **inside
the web application process**, but durable state permits another instance to claim an
expired lease. No Service Bus/Celery worker is evidenced here.

In contrast, progress updates, legacy creation/research, startup token reconciliation,
and optional standalone evaluation/research contain process-local/background work with
different guarantees. Do not generalize the durable-job guarantees to those paths.

### Authentication and authorization

`EntraAuth` uses MSAL PKCE and in-memory pending OAuth flows; Google has a parallel
server-side flow. The backend creates a seven-day HS256 application JWT, stored as
`session` with HttpOnly, Secure, SameSite=None; bearer fallback remains. Directory
membership gates login, and invited accounts become active after onboarding.

`get_current_active_user` re-reads Cosmos and validates active role/status;
`require_agent_access` / `require_agent_editor` then enforce course access. Students
need explicit assignments; department membership is not enough. Teachers need ownership
or co-teacher assignment; admin/superadmin have broader access. See
[Agentic Shiksha Platform/Backend/backend/dependencies/auth.py](<Agentic Shiksha Platform/Backend/backend/dependencies/auth.py>),
[Agentic Shiksha Platform/Backend/backend/dependencies/agent\_access.py](<Agentic Shiksha Platform/Backend/backend/dependencies/agent_access.py>).
These dependencies are present on newer materials/creation/circuit/slide/course routes
and the current agent chat routes, **not on all legacy endpoints**.

## 6. Agent and AI Architecture

### What actually orchestrates the agents

There is no LangGraph, AutoGen, Semantic Kernel or A2A orchestration graph in the inspected
runtime. The application itself coordinates Foundry agent references, direct model calls,
tool dispatch and workers. Agent definitions are named/versioned `PromptAgentDefinition`
objects; most conversational calls use `AIProjectClient.get_openai_client()` and
Conversations/Responses. **Deep-research streaming is an exception:** it uses the older
AgentsClient threads/runs API. A2UI is a UI-description protocol, not agent-to-agent RPC.

### Agent and model component inventory

In this table, **remote definition** means the code invokes a pre-existing named agent;
the deployed system prompt, attached tools and exact model must be inspected in Foundry
before assuming that a local reference prompt matches it.

| Component | Purpose; input -> output | Prompt/model and call site | Tools, retrieval, state, lifecycle and failure behavior |
| --- | --- | --- | --- |
| **Course TA**, normally `course-<name>` | Teach against a course; question/profile/images/current circuit -> prose, artifacts, citations, tool effects | `GeneralAgent.start_chat_stream` / `continue_chat_stream`, [Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py#L1213>). Course specification + five core prompt files combined by [Agentic Shiksha Platform/Backend/utils/prompt\_unifier.py](<Agentic Shiksha Platform/Backend/utils/prompt_unifier.py>). Creation defaults to `AZURE_AI_AGENT_MODEL_DEPLOYMENT` (`gpt-5.2-chat`), but actual calls use the remote agent definition. | New TAs get the 13 function tools below, common filtered Search, requested memory and optional custom Bing. Named agent version is persistent; each learning conversation gets a Foundry conversation ID. Runtime objects are cached by endpoint/name/material session, **not user**; user ID must remain a method argument. Tool errors cancel relevant UI blocks; final successful tool outputs are recorded without generating another response. |
| **CACA**, `course-agent-creation-agent` | Course brief -> strict `CourseSpecification` description/instructions; also legacy creation, regeneration and syllabus reframing | `generate_specification` in [Agentic Shiksha Platform/Backend/utils/course_creation.py](<Agentic Shiksha Platform/Backend/utils/course_creation.py#L108>), request template [Agentic Shiksha Platform/Backend/prompt\_store/tools/course\_creation\_request\_v1.md](<Agentic Shiksha Platform/Backend/prompt_store/tools/course_creation_request_v1.md>); remote system definition, reference [Agentic Shiksha Platform/Backend/prompt\_store/caca\_prompt.md](<Agentic Shiksha Platform/Backend/prompt_store/caca_prompt.md>). | Current creation call uses `store=False`, no conversation and no local tool dispatch. Invalid JSON/schema fails the saved job. Older `call_meta_agent_for_prompt` and `/caca/*` retain different parsing/history behavior. Model/tool configuration comes from the remote definition; comments about particular models are not proof. |
| **CCA**, `course-conversational-agent` | Legacy/edit-builder conversational brief refinement -> text/JSON | `cca_start`, `cca_step` in [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L1963>); local reference [Agentic Shiksha Platform/Backend/prompt\_store/agent\_prompt.md](<Agentic Shiksha Platform/Backend/prompt_store/agent_prompt.md>), remote actual instructions. | Separate Foundry conversation; CCA agent name can be supplied on the legacy request. This is not the current `CreateView` form assistant. Local handlers call Responses, not `GeneralAgent`'s full tool executor. |
| **Temporary course preview**, `temp-course-agent` | Preview an editable teaching prompt before publishing | `updateTempPreviewAgent` targets `TEMP_COURSE_AGENT_ID` in [Agentic Shiksha Platform/Frontend/src/lib/api.ts](<Agentic Shiksha Platform/Frontend/src/lib/api.ts#L486>) and [Agentic Shiksha Platform/Frontend/src/lib/config.ts](<Agentic Shiksha Platform/Frontend/src/lib/config.ts>). | One named shared preview identity, not a per-user created TA. Treat cross-user preview isolation and modern access-dependency compatibility as unverified; the name remains in config and internal-agent filtering. |
| **Course Companion**, `form-fill-assistant`, version `4` | Teacher form + bounded history + attachments -> message + permitted field patch | [Agentic Shiksha Platform/Backend/backend/routers/course\_form\_assistant.py](<Agentic Shiksha Platform/Backend/backend/routers/course_form_assistant.py>), [Agentic Shiksha Platform/Backend/prompt\_store/agents/form\_fill\_assistant\_v3.md](<Agentic Shiksha Platform/Backend/prompt_store/agents/form_fill_assistant_v3.md>). Local `agent_definition()` describes `gpt-5`, low reasoning, strict JSON schema, no tools; inference references the already-created version 4. | Teacher/admin-only, 90-second timeout, no SDK retries, `store=False`. `form_agent_input` prepares attachments; `validate_form_result` enforces allowable fields. Browser owns user-scoped companion history, change highlights and guarded undo; it does not let the model mutate files, IDs or sessions. Failure returns 503 and leaves the form unchanged. |
| **Syllabus reformatter (curriculum stage 0)** | Teacher description/textbook brief -> modular syllabus with prerequisite links | `_background_textbook_research` calls CACA; inline request text in [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L5811>). | New model conversation per attempt. Short context (<200 characters) switches to generation rather than faithful reformatting. Retries once on invalid initial JSON, then deterministic module-name merging. Local raw checkpoints plus partial/current curriculum persistence. |
| **Textbook researcher**, default `textbook-research-agent` | Reframed syllabus + prescribed books -> chapter references and enrichment | Same pipeline; name from `TEXTBOOK_RESEARCH_AGENT_NAME`; reference [Agentic Shiksha Platform/Backend/prompt\_store/research\_agents/textbook\_research\_agent.md](<Agentic Shiksha Platform/Backend/prompt_store/research_agents/textbook_research_agent.md>). Remote actual model/tools; comments describe o3 + web search. | Runs module batches through the shared bounded research executor; retries selected upstream failures and splits failed batches. Results are passed as JSON to threshold analysis, not through an agent messaging bus. |
| **Threshold researcher**, default `threshold-concept-research-agent` | Enriched syllabus -> threshold concepts, misconceptions and inventory items; also semantic dedup | `_background_textbook_research` / `_background_threshold_concept_research`; reference [Agentic Shiksha Platform/Backend/prompt\_store/research\_agents/threshold\_concept\_research\_agent.md](<Agentic Shiksha Platform/Backend/prompt_store/research_agents/threshold_concept_research_agent.md>). Comments describe o3-pro, remote definition decides. | Parallel bounded batches, selected 408/429 retries and partial progress; deterministic exact-name dedup then an extra semantic consolidation call; maps concepts to `module_id`. Durable job wrapper verifies final completeness. Threshold-only retry still needs local syllabus checkpoint text. |
| **Automatic live-web helper** | Question -> bounded web evidence/citations for TA synthesis | `GeneralAgent._get_live_web_context`, [Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py#L803>); [Agentic Shiksha Platform/Backend/prompt\_store/research\_agents/automatic\_web\_search\_request.md](<Agentic Shiksha Platform/Backend/prompt_store/research_agents/automatic_web_search_request.md>) and context prompt; direct `gpt-4.1`. | Forces `web_search_preview`; no evidence if no actual web-search call or on failure. **Normal SSE and AG-UI endpoints currently set `web_search_enabled=False`**, so helper presence does not prove the UI toggle activates this path. |
| **Deep-research agent** | Research query, optional prior research thread -> clarification/activity/cited report | `/api/deep-research` and `/stream` in [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L8144>). Remote `DEEP_RESEARCH_AGENT_ID`, separate configured project; defaults describe `o3-deep-research` with `gpt-4o` base. Reference [Agentic Shiksha Platform/Backend/prompt\_store/research\_agents/deep\_research\_default.md](<Agentic Shiksha Platform/Backend/prompt_store/research_agents/deep_research_default.md>). | Nonstreaming path uses Responses; streaming uses AgentsClient threads/runs with 2-second polling and 30-minute ceiling. Browser receives research state/MCQ clarification. Remote hosted research/Bing tools do the research; a process-local thread/queue relays it. Client abort is not evidence of durable upstream cancellation. |
| **Teacher analytics**, default `teacher-analytics-agent` | Teacher question + authorized student/course evidence -> narrative insights with resolvable evidence refs | [Agentic Shiksha Platform/Backend/teacher\_dashboard/routes.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/routes.py>), [Agentic Shiksha Platform/Backend/teacher\_dashboard/logging\_agent\_chat.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_chat.py>). Remote model/system prompt; extra grounding/scope context is assembled by the route. | Five read-only tools including `get_learning_evidence`, plus `add_message`. Server scope overrides model-selected IDs; selected-student mode forbids class-wide overview. Conversation scope fingerprint changes force a new conversation. Fingerprints are process-local; final-output loop still makes an extra nonstreaming model call. |
| **Admin logging agent**, `logging-agent` | Cross-course/student analytics question -> prose from Cosmos facts | [Admin-Dashboard/backend/logging\_agent\_chat.py](Admin-Dashboard/backend/logging_agent_chat.py). Remote model/system prompt. | Four read-only analytics tools plus `add_message`; separate streaming loop and direct query layer. Unlike teacher insights, local dispatch is not wrapped in the teacher scope contract. The enclosing API lacks equivalent global auth enforcement. |
| **Institute/department researcher**, default `institute-research-agent` | Organization names/instructions -> structured research JSON for personalization | `_background_institute_research` / `_background_department_research` in [Admin-Dashboard/backend/main.py](Admin-Dashboard/backend/main.py#L1199); reference [Agentic Shiksha Platform/Backend/prompt\_store/research\_agents/institute\_research\_agent.md](<Agentic Shiksha Platform/Backend/prompt_store/research_agents/institute_research_agent.md>). Runtime prompts include inline request text; model/tools remote. | Same named agent serves both scopes. Background work stores status/results through [Admin-Dashboard/backend/research\_storage.py](Admin-Dashboard/backend/research_storage.py); JSON repair lives in `research_json.py`. TA profile injection can subsequently read completed organization context. |
| **Syllabus translator** | Canonical syllabus strings + language/style/custom instructions -> exact string mapping | [Agentic Shiksha Platform/Backend/backend/routers/curriculum_translation.py](<Agentic Shiksha Platform/Backend/backend/routers/curriculum_translation.py#L86>), [Agentic Shiksha Platform/Backend/prompt\_store/tools/syllabus\_translation\_v4.md](<Agentic Shiksha Platform/Backend/prompt_store/tools/syllabus_translation_v4.md>); direct configured `CHAT_MODEL`, not a separate named agent. | No tools; strict `TranslationBatch` schema; <=80 strings/10k chars per batch, 180-second whole-request budget. Blob cache keys include source hash/language/style/instructions/user scope; stale source hashes are 409. Concurrent creation uses a storage lock; no silent partial translation. |
| **Next-query helper** | Course/question/answer -> exactly three suggested learner questions | `generate_next_queries`, [Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py#L2465>), [Agentic Shiksha Platform/Backend/prompt\_store/tools/course\_followups\_v1.md](<Agentic Shiksha Platform/Backend/prompt_store/tools/course_followups_v1.md>); `gpt-4.1-mini`. | No tools/history, strict schema, 8-second timeout, no retries, `store=False`. Greetings use deterministic course questions; failures produce no invented successful result. Separate from `suggest_next_queries` tool output. |
| **Conversation title helper** | First question + bounded answer -> short title | `generate_title`, [Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py#L2499>), [Agentic Shiksha Platform/Backend/prompt\_store/agents/conversation\_title.md](<Agentic Shiksha Platform/Backend/prompt_store/agents/conversation_title.md>); `gpt-4.1-mini`. | No tools or conversation required; trims to 50 characters. Failure uses first words of the question. A deterministic title would often be an acceptable cheaper alternative. |
| **Conversation-starter generator** | Existing course setup -> starters | `generate_conversation_starters` in [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L7749>). Calls the course agent, not the title helper. | On-demand generated suggestions; preserve existing teacher-entered starters and distinguish from per-turn next-query generation. |
| **Image model** | TA-provided prompt/title/quality -> PNG + Blob URL/content block | [Agentic Shiksha Platform/Backend/agent\_tools/custom/generate\_image/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/generate_image/__init__.py>); direct Images API, `AZURE_IMAGE_MODEL` default `gpt-image-2-1`. No local system prompt beyond tool schema/TA instructions. | Fixed 1536x1024, low/medium, 180-second timeout, weekly per-user/course quota. Uses refreshed Entra bearer token and Blob delegation SAS. Quota errors currently fail open; upload failure can leave a viewable but nonpersistent image. No inter-agent conversation. |
| **Legacy TikZ generator / discriminator / polisher** | Description -> TeX diagram; rendered image -> criterion scores; selected diagram -> refinement | [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_tikz\_diagram/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_tikz_diagram/__init__.py>). Three direct chat-completion roles default to `gpt-5.4`, configurable separately. Prompts: `tikz_generator_system.md`, `tikz_discriminator_system.md`, `tikz_generator_polish.md`, retry prefix in [Agentic Shiksha Platform/Backend/prompt\_store/tools](<Agentic Shiksha Platform/Backend/prompt_store/tools>). | Application runs sanitized TeX compilation, image rendering, geometry checks and bounded critique/rewrite loops. Retained for older TAs, not attached to new TAs. `_ensure_agents_created` contains named-agent/Bing setup code but has **no callers in Pylance references**, so do not draw that provisioner as the active inference path. |
| **Vision Markdown transcriber (legacy/utility)** | PDF page images -> transcription Markdown | `PdfToMarkdownPreprocessor`, [Agentic Shiksha Platform/Backend/utils/markdown\_converter.py](<Agentic Shiksha Platform/Backend/utils/markdown_converter.py>); LiteLLM with configured deployment, [Agentic Shiksha Platform/Backend/prompt\_store/tools/markdown\_transcriber\_system.md](<Agentic Shiksha Platform/Backend/prompt_store/tools/markdown_transcriber_system.md>) and batch prompt. | Application renders pages with Poppler/pdf2image and batches model input. It is not the normal durable-material ingestion pipeline. No agent collaboration or independent memory. |
| **RAG judges: groundedness, relevancy, precision** | Question/answer/retrieved context -> scores/reasons | [Admin-Dashboard/backend/groundedness\_evaluator.py](Admin-Dashboard/backend/groundedness_evaluator.py); direct `EVAL_MODEL` default `gpt-5.2-chat`, inline prompts; optional Azure Evaluation SDK groundedness path. Local evaluation Markdown files are references, not evidence that this module loads them. | No tools or learning-memory updates. Re-retrieves context later, optionally periodically (`EVAL_ENABLED=false` default), stores evaluation records. JSON-object output is parsed; this is a model-judge estimate, not factual proof or original-context replay. |
| **Prior-progress claim guardrail** | Selected tutor statements + actual learning state -> groundedness verdict | [Agentic Shiksha Platform/Backend/azure\_services/content\_guardrail.py](<Agentic Shiksha Platform/Backend/azure_services/content_guardrail.py>), `check_progress_claims`; Content Safety preview API, no local named model. | Deterministic regex selects claims; optional remote detector checks them. Missing endpoint/failure is `checked=False`; main stream post-checks/logs, not a complete real-time content safety filter. |
| **Hosted memory extraction/search** | Conversation activity -> persistent summaries/profile memories -> recall | [Agentic Shiksha Platform/Backend/azure\_services/tools/memory/memory\_store\_manager.py](<Agentic Shiksha Platform/Backend/azure_services/tools/memory/memory_store_manager.py>), hosted memory builder. Defaults `gpt-4.1` and `text-embedding-3-large`. | One store per TA, template `{{$userId}}`, 300-second update delay. Actual hosted extraction/runtime scope resolution is a Foundry concern; the repo does not prove end-to-end learner isolation under service credentials. |

Reference-only prompts such as
[Agentic Shiksha Platform/Backend/prompt\_store/research\_agents/economic\_research\_agent.md](<Agentic Shiksha Platform/Backend/prompt_store/research_agents/economic_research_agent.md>)
and `web_search_assistant.md` do not establish another active application agent without
a caller. Likewise, `BaseAgentManager` is a shared lifecycle helper,
not an additional cooperating learning agent.

### Prompt composition, publication and contradictions

`unify_agent_prompts` loads `agent_behavior`, `pedagogical_framework`, `tool_handling`,
`knowledge_grounding`, and `safety_guardrails` in a fixed template plus course-specific
instructions/context. These are published into an agent version during creation or
explicit regeneration. Editing a Markdown file does **not** hot-reload the instructions
of every existing remote TA. `GeneralAgent` invokes the remote definition.

The constitution targets threshold crossings through contextual challenges, misconceptions
and concept inventories. It prohibits fabricated prior progress and competitive grading.
However, the shared pedagogical file includes a hardcoded algorithms identity, 12-concept
CLRS map, fixed learner environment/language/interests, and a `crossed` tool call that
does not match the tool's `learned`/`in_progress` enum. The tool-handling file also contains
an example ending in `add_message` despite prohibiting that sequence. These are functional
prompt bugs, not merely documentation style. Sources:
[Agentic Shiksha Platform/Backend/prompt\_store/core\_agent\_prompts/agent\_behavior.md](<Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/agent_behavior.md>),
[Agentic Shiksha Platform/Backend/prompt\_store/core\_agent\_prompts/pedagogical\_framework.md](<Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/pedagogical_framework.md>),
[Agentic Shiksha Platform/Backend/prompt\_store/core\_agent\_prompts/tool\_handling.md](<Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/tool_handling.md>).

### Actual agent flows

```text
Learner -> ChatView/useAgentChat -> POST chat/stream OR chat/agui
				-> active-account + course-assignment dependency
				-> GeneralAgent (cached service object; per-call learner ID)
						 + optional profile/research context
						 + explicit course passage retrieval for document-oriented requests
				-> Foundry course TA Responses stream
						 + hosted Search / Memory / optional custom Bing (Foundry executes)
						 + function_call -> local dispatcher -> deterministic tool or helper model
						 + function_call_output -> same TA's next Responses round
				-> prose/artifact/citation/usage events -> protocol adapter -> UI
				-> browser transcript sync -> Cosmos       [separate persistence path]
				-> server progress/usage recording         [separate side effects]

Teacher -> CreateView -> persisted material/creation job
				-> CACA specification + memory-store preparation (parallel)
				-> unified prompt + tools -> create owned Foundry TA version
				-> agent metadata + setup Blob -> ready TA
				-> curriculum job -> CACA syllabus
						 -> textbook researcher batches
						 -> threshold researcher batches + consolidation
						 -> curriculum JSON + Git-version Blob -> syllabus/progress UI

Teacher -> authorized evidence selection -> teacher analytics agent
				-> execute_scoped_tool -> Cosmos evidence/catalog -> same analytics agent
				-> narrative + resolved evidence references -> teacher dashboard
```

## 7. Tool Architecture

### Definition and dispatch contract

Most local function tools use a JSON schema at
`Agentic Shiksha Platform/Backend/agent_tools/custom/<tool>/definition.json` plus a `CustomTool` implementation
with `execute(arguments, **context)` and `output(result, arguments)`. Schemas are loaded
by [Agentic Shiksha Platform/Backend/utils/tool\_definitions.py](<Agentic Shiksha Platform/Backend/utils/tool_definitions.py>), registered as
Foundry `FunctionTool(strict=False)` by `AgentToolBuilder`, and dispatched explicitly
in `GeneralAgent._dispatch_tool_call`. Context such as user ID/course comes from the
backend call, not tool arguments. Validation quality varies by tool; the registry's
`strict=False` means the JSON schema alone is not sufficient validation.

### Function tools in the repository

**TA** below means attached by `_FUNCTION_TOOL_SOURCES` to newly created TAs. A legacy
remote TA may have a different schema/version; inspect it before relying on a feature.

| Function | Required/important schema inputs | Result / effect | Allowed callers and source |
| --- | --- | --- | --- |
| `add_message` | `content` | Message block; streaming text can start before completion | TA; also analytics special handling. [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_message/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_message/definition.json>) |
| `add_document` | `title`, `content`; `doc_type` | Markdown/document block, subsequently saved/displayed by UI | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_document/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_document/definition.json>), [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_document/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_document/__init__.py>) |
| `add_quiz` | `assessment_type`, `title`, `questions`; optional `threshold_concept`; answers/misconception mapping in item schemas | Validated practice/concept-inventory block; resolves concept bank entries | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_quiz/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_quiz/definition.json>), [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_quiz/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_quiz/__init__.py>) |
| `add_challenge` | `title`, `description`, `difficulty`, `solution`; `hints`, `challenge_type` | Guided challenge block | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_challenge/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_challenge/definition.json>) |
| `add_circuit` | `title` plus circuit `components`/`analysis` | Validated ngspice result displayed in Circuit Lab | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_circuit/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_circuit/definition.json>), [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_circuit/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_circuit/__init__.py>), [Agentic Shiksha Platform/Backend/utils/circuit\_simulation.py](<Agentic Shiksha Platform/Backend/utils/circuit_simulation.py>) |
| `add_slides` | `title`, `slides`; subtitle/theme/layouts/notes/sources | Bounded slide-deck block; export is a separate explicit HTTP action | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_slides/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_slides/definition.json>), [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_slides/handler.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_slides/handler.py>) |
| `generate_image` | `prompt`, `title`, `quality`; optional caption | Direct image-model call + quota consumption + Blob upload + generated-image block | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/generate\_image/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/generate_image/definition.json>), [Agentic Shiksha Platform/Backend/agent\_tools/custom/generate\_image/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/generate_image/__init__.py>) |
| `get_threshold_concepts` | No user-controlled IDs | Current course curriculum and learner progress; initializes learning state when appropriate | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/get\_threshold\_concepts/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/get_threshold_concepts/definition.json>), [Agentic Shiksha Platform/Backend/agent\_tools/custom/get\_threshold\_concepts/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/get_threshold_concepts/__init__.py>) |
| `update_topic_progress` | `topic`, `status`; summary/concept/misconceptions | Canonicalized progress update in learner/course state | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/update\_topic\_progress/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/update_topic_progress/definition.json>); dispatcher currently acknowledges a background write early |
| `declare_plan` | `tools[]` | Validates a supported sequence; orchestration forces subsequent function choices | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/declare\_plan/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/declare_plan/definition.json>), [Agentic Shiksha Platform/Backend/agent\_tools/custom/declare\_plan/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/declare_plan/__init__.py>) |
| `ask_clarification` | 1-3 `questions`, exactly four distinct options each; optional context | Emits paged question card, waits up to 60 seconds for `/api/clarify/{id}`, then supplies answers to the same TA turn | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/ask\_clarification/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/ask_clarification/definition.json>), [Agentic Shiksha Platform/Backend/utils/clarification\_registry.py](<Agentic Shiksha Platform/Backend/utils/clarification_registry.py>). Timeout yields an explicit no-answer instruction |
| `suggest_next_queries` | Exactly three `queries` | Suggested-query block | TA. [Agentic Shiksha Platform/Backend/agent\_tools/custom/suggest\_next\_queries/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/suggest_next_queries/definition.json>) |
| `add_tikz_diagram` | `description`, `title`; caption/feedback_rounds | Legacy multi-call diagram generator/renderer/critic | Retained runtime for old TAs, **not attached to new ones**. [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_tikz\_diagram/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_tikz_diagram/definition.json>) |
| `list_agents` | None | Agent metadata summary | Analytics. [Agentic Shiksha Platform/Backend/agent\_tools/custom/logging\_agent\_tools/list\_agents.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/logging_agent_tools/list_agents.json>); duplicate teacher/admin local definitions |
| `list_all_students` | Optional `agent_id` | Student progress roster | Analytics. [Agentic Shiksha Platform/Backend/agent\_tools/custom/logging\_agent\_tools/list\_all\_students.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/logging_agent_tools/list_all_students.json>) |
| `get_student_progress` | `user_id`, `agent_id` | Detailed student/course progress | Analytics. [Agentic Shiksha Platform/Backend/agent\_tools/custom/logging\_agent\_tools/get\_student\_progress.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/logging_agent_tools/get_student_progress.json>); teacher wrapper checks server scope |
| `get_agent_overview` | `agent_id` | Course-level statistics | Analytics. [Agentic Shiksha Platform/Backend/agent\_tools/custom/logging\_agent\_tools/get\_agent\_overview.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/logging_agent_tools/get_agent_overview.json>); disabled for selected-student teacher mode |
| `get_learning_evidence` | None; server fixes scope | Inventory first attempts, concept/topic progress, artifacts, bounded chat signals, coverage/catalog | Teacher analytics only; inline schema and `execute_scoped_tool` in [Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_tools.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_tools.py#L46>) |
| `search_knowledge_base` | `query`, optional `num_results` | **Schema-only legacy surface**, not an active handler in the inspected dispatcher | [Agentic Shiksha Platform/Backend/agent\_tools/custom/search\_knowledge\_base/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/search_knowledge_base/definition.json>); do not advertise this as implemented retrieval |

The four analytics tools also have exported `CustomTool` wrappers and a `LOGGING_TOOLS`
dispatcher branch in the main runtime, but the default TA creation list does not attach
them. The teacher dashboard uses its own authorized executor, and the standalone admin
dashboard uses its own direct handlers. These are distinct permission paths.

### Hosted tools and dynamic selection

- `azure_ai_search`: Foundry-hosted filtered index search. Builder requires both an index
	and project connection and fails creation if requested attachment cannot be built.
	See [Agentic Shiksha Platform/Backend/agent\_tools/hosted/azure\_ai\_search/builder.py](<Agentic Shiksha Platform/Backend/agent_tools/hosted/azure_ai_search/builder.py>).
- `memory_search`: Foundry-hosted MemorySearch tool, per-TA store and scope template;
	construction failures are optional/fail-open. See
	[Agentic Shiksha Platform/Backend/agent\_tools/hosted/memory\_search/builder.py](<Agentic Shiksha Platform/Backend/agent_tools/hosted/memory_search/builder.py>).
- Bing grounding/custom search: hosted project-connection tools, the latter constrained
	by a teacher-selected search instance. New course creation turns general web off.
	See [Agentic Shiksha Platform/Backend/agent\_tools/hosted/bing\_grounding/builder.py](<Agentic Shiksha Platform/Backend/agent_tools/hosted/bing_grounding/builder.py>)
	and [Agentic Shiksha Platform/Backend/agent\_tools/hosted/bing\_custom\_search/builder.py](<Agentic Shiksha Platform/Backend/agent_tools/hosted/bing_custom_search/builder.py>).
- `web_search_preview`: direct helper-model forced tool, separate from the Bing builder.
- `DeepResearchTool`: builder in
	[Agentic Shiksha Platform/Backend/agent\_tools/hosted/deep\_research/builder.py](<Agentic Shiksha Platform/Backend/agent_tools/hosted/deep_research/builder.py>),
	used conceptually by a separately provisioned research agent; not added to every TA.
- File-search and MCP builders deliberately raise `NotImplementedError`:
	[Agentic Shiksha Platform/Backend/agent\_tools/hosted/file\_search/builder.py](<Agentic Shiksha Platform/Backend/agent_tools/hosted/file_search/builder.py>),
	[Agentic Shiksha Platform/Backend/agent\_tools/hosted/mcp/builder.py](<Agentic Shiksha Platform/Backend/agent_tools/hosted/mcp/builder.py>).
	Older REST utilities can create Search knowledge sources/bases and MCP-related
	connections, but the current `AgentToolBuilder` does not attach an MCP tool. There is
	no separate local general-purpose MCP server evidenced in this repository.

`declare_plan` is programmatic tool selection: a validated sequence changes the next
Responses request's `tool_choice` to a forced function, then `none` once the plan ends.
Unplanned independent function calls can execute in a per-batch executor of at most six
threads, with output order preserved. The repeated tool loop has no explicit overall
round/cost deadline beyond model/request behavior; per-call timeouts do not bound a turn.

Circuit and slide enable controls read remote status first, then explicitly create a new
agent version using expected-version checks and a Blob lease while preserving other
tools. Already-enabled schemas are not automatically upgraded simply because the local
definition changed. Reference [Agentic Shiksha Platform/Backend/backend/routers/circuit.py](<Agentic Shiksha Platform/Backend/backend/routers/circuit.py#L118>)
and [Agentic Shiksha Platform/Backend/backend/routers/slides.py](<Agentic Shiksha Platform/Backend/backend/routers/slides.py>).

## 8. Knowledge and RAG Pipeline

### Active course-material pipeline

```text
Teacher selects files in CreateView / EditView
	-> POST knowledge/preflight: signature/format/size inspection
	-> createMaterialDraft: owner + request ID -> deterministic job/session
	-> POST knowledge/build: original bytes + metadata -> private Blob original
	-> persisted material worker prepares bounded indexing copies
	-> Blob sessions/<material-session>/<scope>/<prepared-file>
	-> shared Azure AI Search blob datasource + on-demand indexer
	-> DocumentIntelligenceLayoutSkill: OCR/layout -> text sections
	-> AzureOpenAIEmbeddingSkill -> content_embedding
	-> shared HNSW + semantic Search index, session_id/file_category filters
	-> Foundry-hosted AzureAISearchTool OR explicit retrieve_course_passages
	-> bounded evidence + stable citation IDs -> TA Responses input
	-> citation source drawer -> authenticated download of the original file
```

**Preflight/preparation:** [Agentic Shiksha Platform/Backend/utils/material\_uploads.py](<Agentic Shiksha Platform/Backend/utils/material_uploads.py>)
accepts PDF/DOCX/TXT/MD/PNG/JPEG/TIFF/BMP, validates real file content, rejects encrypted
or repaired PDFs, oversized archives and problematic images. Limits: 100 MiB per file,
250 MiB per upload batch, 100 files per upload, 2,000 PDF pages; non-PDF indexing inputs
must be <=16,000,000 bytes. PDFs become <=50-page/16 MB parts (recursively split again
if necessary). Text/Markdown becomes escaped HTML `<pre>` copies in 50,000-character
segments. This current path uses deterministic preprocessing, not vision LLM transcription.

**Original identity:** `inspect_material` hashes bytes and filename; `store_upload`
stores an original at `material-originals/<session>/<scope>/<source-id>/<stored-name>`
with `AzureSearch_Skip=true`. Prepared copies have deterministic names and metadata:
`session`, `kb_scope`, `source_id`, `source_sha256`, `original_filename`,
`processing_generation`, `page_start`, `page_end`. Retries compare hash/ETag identities.
See [Agentic Shiksha Platform/Backend/utils/material\_jobs.py](<Agentic Shiksha Platform/Backend/utils/material_jobs.py>).

**Index contract:** `_create_common_index`, `_create_common_skillset` and
`_create_common_indexer` in
[Agentic Shiksha Platform/Backend/azure_services/tools/search/course_index_manager.py](<Agentic Shiksha Platform/Backend/azure_services/tools/search/course_index_manager.py#L2622>)
define the common pipeline. Fields include `content_id` (key), `text_document_id`,
`document_title`, `content_text`, `content_embedding`, `content_path`, `page_number`,
`chunk_index`, `file_category`, `session_id`, `logical_section`, `content_type`,
`image_document_id`, `image_blob_path`. Existence in the schema does not ensure population:
the current text projections map content/vector/page/title/path/session/category, not
all of the declared logical-section/chunk/image fields.

The Layout skill uses `oneToMany`, **text** output, 2,000-character maximum sections
and 200-character overlap. Embedding model/dimensions come from configuration. HNSW is
cosine (`m=4`, `efConstruction=400`), with an Azure OpenAI query vectorizer and a
`semantic-config` prioritizing document title/content. The current common pipeline is
not the README's Markdown-heading splitter. Azure Search performs hybrid fusion and
semantic reranking when requested; there is no custom application reranking model here.

**Retrieval:** `AgentToolBuilder` attaches the common index with an OData session filter,
`vector_semantic_hybrid`, top 20. For explicit uploaded-material requests detected by
`_COURSE_MATERIALS_REQUEST_PATTERN`, `GeneralAgent._prepare_course_material_request`
loads the actual agent Search configuration and calls
`retrieve_course_passages` in [Agentic Shiksha Platform/Backend/utils/course_materials.py](<Agentic Shiksha Platform/Backend/utils/course_materials.py#L204>).
The latter intersects the agent filter with the expected session and excludes image
records. It requests text vectors (`k=20`) and semantic ranking where configured,
limits to eight passages/12,000 total characters/4,000 per passage, and generates stable
content-hash citation IDs. Evidence is placed in a user data message, preceded by
the developer grounding prompt
[Agentic Shiksha Platform/Backend/prompt\_store/tools/course\_material\_grounding\_context\_v2.md](<Agentic Shiksha Platform/Backend/prompt_store/tools/course_material_grounding_context_v2.md>).
Failure to retrieve/validate here raises a user-visible retrieval failure rather than
pretending ungrounded output came from documents. Normal questions may instead rely on
the hosted Search tool chosen by the model; the explicit path is not unconditional.

**Isolation:** the current creation job derives the material session from the authenticated
owner/request ID. File APIs verify course/owner access. Retrieval validates returned
`session_id`, the configured storage hostname, scope/path and filename, and maps prepared
copies back to the correct job/original and original page number. This is **logical
application isolation in a shared index**, not one Azure resource per tenant. Legacy
knowledge-management routes and the standalone evaluator do not all have the same checks.

**Readiness/lifecycle:** a finished indexer run must be newer than the upload boundary;
prepared filenames must be present and errors/warnings accounted for. A failed, partial
or old run does not automatically mean ready. The job tracks per-file statuses and
processing generations; the complete indexing wait is bounded at two hours.

`remove_material` marks a job entry for removal; subsequent processing deletes matching
Search documents in acknowledged batches of 100 and prepared blobs with ETags.
`retrieve_course_passages` also skips removed originals. The original archive bytes and
job history are retained by this path, so this is not a complete retention/erasure API.
The datasource declares native blob soft-delete detection, but whether account-level
soft delete/retention is enabled cannot be proven from the code.

### Older/parallel retrieval surfaces

The same index manager still implements per-course, per-session unified, knowledge-source,
knowledge-base and MCP pipeline APIs. `blob_storage_manager.py` also provides older
vector-store/file-search upload and preprocessing helpers; `markdown_converter.py` can
render PDF pages and transcribe via a vision LLM. Image extraction/index records are a
separate optional path, not necessarily produced by current material jobs. Do not
describe these as stages every normal course upload passes through.

The standalone evaluator re-retrieves semantic text later and can search **without a
session filter** if metadata resolution fails. Its evaluation corpus is not guaranteed
to be the evidence originally used by the TA. See
[Admin-Dashboard/backend/groundedness_evaluator.py](Admin-Dashboard/backend/groundedness_evaluator.py#L60)
and [Admin-Dashboard/backend/main.py](Admin-Dashboard/backend/main.py#L160).

## 9. Data Architecture

### Persistent systems and relationships

| Record/system | Key relationships and responsibility |
| --- | --- |
| `invited_users_v1` (C1) | Email-partitioned invite/allowlist records, roles and affiliations; promotion records retained for audit |
| `users_v1` (C2) | `id=userId`, user partition; OAuth identity, profile/preferences, role/status, onboarding, active affiliation |
| `agents_v1` | Named Foundry agent metadata, creator/co-teachers/student IDs, material `sessionUuid`, course metadata/manage code |
| `chat_threads_v1` | User-partitioned local thread, `agentId`, title/timestamps and optional public-share boundary |
| `chat_messages_v1` | User-partitioned messages referencing local `threadId`; role/content/metadata, retry group and latest flag |
| `assets_v1` | User-owned generated artifacts linked to agent/thread; category/type/content and public/private flags |
| `learning_states_v1` | Per-user/per-course curriculum-derived topics/concepts, evidence, statuses and misconception resolution |
| `courses_v2` | Both older course API records and discriminated operational jobs: material processing, course creation/name reservations, curriculum work; historical retired-feature records are not deleted |
| `departments_v1` | Organization grouping; not itself student course authorization |
| `feedback_v1`, `groundedness_evaluations_v1` | Product feedback and model-judge results |
| Blob setup/curriculum | Agent setup JSON and current curriculum JSON; source of truth outside Cosmos despite some stale helper/doc names |
| Blob materials/media | Original/prepared documents, images, research outputs and feedback attachments |
| Foundry | Named agent versions, conversations/responses, per-agent hosted memory store |

Sources: [Agentic Shiksha Platform/Backend/azure\_services/persistence/cosmos\_db.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py>),
[Agentic Shiksha Platform/Backend/backend/schemas/course\_materials.py](<Agentic Shiksha Platform/Backend/backend/schemas/course_materials.py>),
[Agentic Shiksha Platform/Backend/backend/schemas/course\_creation.py](<Agentic Shiksha Platform/Backend/backend/schemas/course_creation.py>).
Partition descriptions above reflect actual read/write call contracts; deployed container
definitions must be checked independently. Migration tooling intentionally reads source
container partition definitions instead of assuming them.

`COSMOS_DATABASE` selects the database. Container names ending `_v1` can still live in
the current database; the suffix does **not** mean the app is using archived study data.
`get_cosmos_client` blocks the frozen `ekalaiva` database unless an explicit override
is set. That override does not make clients technically read-only.

### Lifetimes and evidence

- **Browser cache:** current identity/preferences, recent messages (50 per local thread),
	active navigation and selected workflow/job IDs. Large image bytes are stripped from
	local persistence; Blob URLs are re-signed on reads.
- **In-memory UI:** live drafts, upload `File` objects, transient generation state,
	animation state and open circuit context. Form context survives SPA navigation, not
	arbitrary machine loss; a persisted job is the server-side resume anchor.
- **Process-local backend:** OAuth state, clarification waiters, some caches, legacy
	conversations, research executor and scope fingerprints. These are not shared between
	replicas and can disappear on restart.
- **Durable jobs:** `MaterialJob`, `CourseCreationState`, `CurriculumResearchJob` have
	status/progress/attempts/leases/revisions. The job metadata does not make every legacy
	helper within it stateless; threshold-only retry still references a local raw file.
- **Progress:** deterministic `record_taught_topics` can mark up to three matching
	multiword curriculum topics `in_progress`; it never infers `learned`.
	The `update_topic_progress` tool validates/canonicalizes concept/misconception names
	against the curriculum before calling persistence. Assessment evidence is separate
	from ordinary chat volume.

See [Agentic Shiksha Platform/Backend/azure\_services/persistence/progress\_inference.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/progress_inference.py>),
[Agentic Shiksha Platform/Backend/agent\_tools/custom/update\_topic\_progress/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/update_topic_progress/__init__.py>).

### Sharing, history and privacy caveats

`create_share_token_for_thread` uses a random URL-safe token, an expected saved-message
selection and an ETag. Reusing a link does not extend the message-ID boundary; refresh
does. Public reads fetch the selected **current message records**, so the mechanism is
not an immutable serialized snapshot of message contents. See
[Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py#L387>).

`curriculum_git.py` downloads a bare Dulwich Git repository tarball, commits
`curriculum.json`, and reuploads the tarball to Blob. Its version IDs are Git commit
hashes. Concurrent writers can overwrite each other's tarball; download errors can be
treated as missing history. See
[Agentic Shiksha Platform/Backend/azure_services/persistence/curriculum_git.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/curriculum_git.py#L153>).

Privacy is pseudonymization, not anonymity: student names are stored as `student_name`
in C2, but email/OAuth IDs, affiliations and conversation content remain. JWTs carry name
and email; some authentication logs also emit them. PII redaction/placeholder replacement
does not prove that arbitrary learner text, attachments or remote memory never contain
personal data. Deletion helpers span only subsets of these systems; no verified single
end-to-end erasure transaction covers Cosmos, Blob, Foundry, Search and all caches.

## 10. End-to-End Request Traces

### A. Create a TA with course materials and curriculum

1. `CreateView.handleCreateAgent` validates the form and checks the TA name. Files go to
	`preflightMaterials`; the teacher confirms `MaterialReviewDialog`. The frontend calls
	`createMaterialDraft(sessionUuid)`, then `uploadKnowledgeFiles` per course/textbook file.
	[Agentic Shiksha Platform/Frontend/src/features/create/CreateView.tsx](<Agentic Shiksha Platform/Frontend/src/features/create/CreateView.tsx#L273>),
	[Agentic Shiksha Platform/Frontend/src/features/create/MaterialWorkflow.tsx](<Agentic Shiksha Platform/Frontend/src/features/create/MaterialWorkflow.tsx>),
	[Agentic Shiksha Platform/Frontend/src/lib/api.ts](<Agentic Shiksha Platform/Frontend/src/lib/api.ts>).
2. The authenticated `course_materials` router validates bytes/ownership and creates the
	deterministic material job and original Blob records. No LLM parses normal indexing
	copies. `material_jobs.run_worker` claims/renews/checkpoints the job.
	[Agentic Shiksha Platform/Backend/backend/routers/course\_materials.py](<Agentic Shiksha Platform/Backend/backend/routers/course_materials.py>),
	[Agentic Shiksha Platform/Backend/utils/material\_jobs.py](<Agentic Shiksha Platform/Backend/utils/material_jobs.py>).
3. `createAgentAsync` posts `CourseCreationRequest` to `/api/agents/create-async` and
	`waitForCourseCreation` polls the saved job. `start_creation` validates the creator,
	reserves the name and fingerprints immutable creation input.
	[Agentic Shiksha Platform/Frontend/src/lib/api.ts](<Agentic Shiksha Platform/Frontend/src/lib/api.ts#L1954>),
	[Agentic Shiksha Platform/Backend/backend/routers/course_creation.py](<Agentic Shiksha Platform/Backend/backend/routers/course_creation.py#L71>),
	[Agentic Shiksha Platform/Backend/utils/course_creation.py](<Agentic Shiksha Platform/Backend/utils/course_creation.py#L64>).
4. `advance_creation` runs CACA specification and memory preparation in parallel,
	composes core/course prompts, attaches tools, and creates a Foundry agent version
	carrying `course_job_id`. Reconciliation refuses to adopt an unrelated same-name
	agent and avoids blindly reissuing uncertain creates.
5. `persist_created_course` writes setup JSON to Blob and metadata to `agents_v1`, then
	`enqueue_curriculum` creates a durable curriculum job when textbooks are present.
	Prepared materials continue independently through the common Search indexer.
6. `completeCreation` creates the local project/thread, shows the returned management
	code and navigates to chat. TA-ready, material-ready and curriculum-ready are distinct.
	`run_curriculum_worker` later drives the CACA/textbook/threshold pipeline and the UI
	polls `get_course_curriculum` status. Explicit retry can also use a saved description
	when automatic textbook-triggered research was not queued.

### B. Ask the TA about a changed circuit

1. `ChatView` mounts `useAgentChat` and opens a validated circuit through `AssetContent`
	/ `CircuitBlock`. Edits change the local `draft`; Run calls `simulateCircuit`.
	[Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx](<Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx#L781>),
	[Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx](<Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx>),
	[Agentic Shiksha Platform/Frontend/src/features/chat/CircuitBlock.tsx](<Agentic Shiksha Platform/Frontend/src/features/chat/CircuitBlock.tsx>).
2. `simulate_course_circuit` verifies current account/course access; `simulate_circuit`
	builds an allowlisted netlist and invokes bounded ngspice. Results are numeric, not
	invented by the model. Running a simulation does not itself update model history.
	[Agentic Shiksha Platform/Backend/backend/routers/circuit.py](<Agentic Shiksha Platform/Backend/backend/routers/circuit.py#L157>),
	[Agentic Shiksha Platform/Backend/utils/circuit_simulation.py](<Agentic Shiksha Platform/Backend/utils/circuit_simulation.py#L182>).
3. A successful run updates the saved local circuit block/result. The editor publishes
	transient `circuitChatContext`; a draft/failed/pending state carries no fresh readings.
	`circuitChatText` snapshots this into the next outgoing question, scoped to
	user/course/thread. The visible bubble retains the original user text.
	[Agentic Shiksha Platform/Frontend/src/lib/circuit.ts](<Agentic Shiksha Platform/Frontend/src/lib/circuit.ts>),
	[Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts](<Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>).
4. `streamAgentChat` or `streamAgentChatViaAGUI` posts to the main backend. Account and
	assignment dependencies run; the backend resolves authoritative user ID, course
	material session, profile and Foundry conversation. `GeneralAgent` submits the
	question/current circuit to the TA and handles hosted/local tool outputs.
5. Events update the hook/renderers. The completed transcript independently syncs to
	Cosmos; server token/progress recording is a separate side effect. Reload uses the
	saved circuit, while closing the pane clears live outgoing context.

The preceding bug was exactly between steps 2 and 3: simulator persistence existed,
but the next request omitted the changed topology/ammeter. Current tests cover the bridge;
they do not prove the model will always interpret measurements correctly.

### C. Concept inventory -> first attempt -> teacher evidence

1. TA calls `add_quiz`; `_concept_details` and mapping helpers resolve curriculum
	entries before display.
	[Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_quiz/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_quiz/__init__.py>).
2. `QuizBlock` tracks answers/reasoning, checks whether a first attempt exists and calls
	`chatApi.submitFirstQuizAttempt`.
	[Agentic Shiksha Platform/Frontend/src/features/chat/QuizBlock.tsx](<Agentic Shiksha Platform/Frontend/src/features/chat/QuizBlock.tsx#L460>),
	[Agentic Shiksha Platform/Frontend/src/lib/chatApi.ts](<Agentic Shiksha Platform/Frontend/src/lib/chatApi.ts>).
3. `submit_first_quiz_attempt` resolves user identity; `create_first_quiz_attempt` uses a
	deterministic user-partitioned quiz asset ID, create-if-absent/ETag replacement and
	bounded conflict retries. Repeated submissions return the existing first attempt.
	[Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L10133>),
	[Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py#L3613>).
4. `QuizBlock.dispatchFeedback` emits `quiz-feedback`; the UI/hook asks the tutor for
	feedback, later appended to the same asset. Progress tools/inference update learning
	state separately. The concept gate requires some misconception evidence, not an
	independently validated proof of every prompt-defined gatekeeper.
5. Teacher evidence queries join first-attempt assets, concept/topic state and artifacts.
	Answer keys still exist client-side: first-write immutability is not anti-cheating validation.

### D. Teacher requests selected-student insights

1. `TeacherDashboard` and its dashboard client call
	`/api/teacher-dashboard/logging-agent/chat/stream`.
	[Agentic Shiksha Platform/Frontend/src/features/dashboard/TeacherDashboardPage.tsx](<Agentic Shiksha Platform/Frontend/src/features/dashboard/TeacherDashboardPage.tsx>),
	[Agentic Shiksha Platform/Frontend/src/features/dashboard/lib/dashboardApi.ts](<Agentic Shiksha Platform/Frontend/src/features/dashboard/lib/dashboardApi.ts>).
2. `logging_agent_chat_stream` derives authorized courses/selected students and builds
	the evidence bundle; it passes `tool_scope` to the analytics stream.
	[Agentic Shiksha Platform/Backend/teacher_dashboard/routes.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/routes.py#L676>).
3. `execute_scoped_tool` rejects outside IDs and class-wide overview in selected mode;
	changed scope fingerprints start a new conversation.
	[Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_tools.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_tools.py#L409>),
	[Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_chat.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_chat.py#L88>).
4. `resolve_evidence_citations` matches `[[ref]]` against the authorized catalog, excluding
	chats as formal citations while reporting whether chat signals were reviewed. The UI
	renders narrative/evidence. This is more constrained than standalone admin chat.

### E. Share a completed conversation

1. `ChatView` requests a share; `flushConversationForSharing` waits for transcript writes
	and sends selected saved message IDs.
	[Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts](<Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts#L20>).
2. `share_thread` checks the active caller; `create_share_token_for_thread` checks the
	caller's thread ownership and saved
	IDs and stores the random token, boundary, title and timestamp with an ETag.
	[Agentic Shiksha Platform/Backend/backend/routers/chat\_sharing.py](<Agentic Shiksha Platform/Backend/backend/routers/chat_sharing.py>),
	[Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py#L387>).
3. Public `/api/shared/{share_token}` returns permitted content from that boundary and
	re-signs generated images. `SharedChatView` uses read-only renderers.
	[Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L9887>),
	[Agentic Shiksha Platform/Frontend/src/pages/SharedChatView.tsx](<Agentic Shiksha Platform/Frontend/src/pages/SharedChatView.tsx>).
4. Reusing a link does not extend its boundary; explicit refresh does. Revocation removes
	it. The selected messages' contents are not separately frozen by the ID boundary.

## 11. Infrastructure

### Deployment shape

Four service-directory Docker images: two Nginx SPAs and two Uvicorn APIs. The preceding
local release in this conversation is `2026-09-24-05`, `linux/amd64`, for the four
`ekalaiva-*` repositories. The assistant did not push or deploy it.

Cloud integrations actually referenced are Foundry/Azure OpenAI, Azure AI Search,
Cosmos DB, Blob Storage, Document Intelligence, Bing grounding/custom search, Speech,
optional Content Safety, Entra ID and Google OAuth. No implemented AWS/GCP infrastructure
was found. Dockerfiles/guidance describe ACR/App Service hosting, but do not establish
live app settings, private networking, SKUs, replica counts or active release tags.
No Terraform, Bicep, `azure.yaml` or Compose stack was found in the normal source inventory.

### Build/configuration contracts

| Service | Build and runtime |
| --- | --- |
| Main frontend | Node 20 Alpine build, `npm ci`, `npm run build`; Nginx stable Alpine on 80. Receives public build arguments and derives CSP API origin from `VITE_API_BASE_URL`. |
| Main backend | Python 3.11 slim, pip requirements, Poppler/TeX Live/build tools/ngspice; `uvicorn backend.main:app`, `PORT` default 8080. |
| Admin frontend | Node 20 Alpine, `vite build` only, Nginx Alpine on 80. `VITE_API_BASE_URL` build argument targets main API; `VITE_DASHBOARD_API_URL` is the separate analytics API. |
| Admin backend | Python 3.11 slim, independent requirements, `uvicorn main:app --port 8050`. Main-backend packages are not copied into this image. |

Sources: [Agentic Shiksha Platform/Frontend/Dockerfile](<Agentic Shiksha Platform/Frontend/Dockerfile>), [Agentic Shiksha Platform/Backend/Dockerfile](<Agentic Shiksha Platform/Backend/Dockerfile>),
[Admin-Dashboard/frontend/Dockerfile](Admin-Dashboard/frontend/Dockerfile),
[Admin-Dashboard/backend/Dockerfile](Admin-Dashboard/backend/Dockerfile).
Docker ignore rules exclude backend environments, local learner data and build caches.
The frontend permits public production config into its builder, then copies only output
and Nginx config to the runtime image. Package registries can be overridden for the
workstation mirror; TLS verification should remain enabled.

| Variable group | Important names / behavior |
| --- | --- |
| Origins | `FRONTEND_URL`, `BACKEND_URL`, `AUTH_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`; dashboard `ALLOWED_ORIGINS` |
| Auth | `JWT_SECRET`, `AZURE_AUTH_CLIENT_ID` / `VITE_AZURE_CLIENT_ID`, tenant settings, Google client/secret/redirect, `SUPER_ADMIN_EMAIL` |
| Foundry | `AZURE_AI_PROJECT_ENDPOINT`, `AZURE_FOUNDRY_ENDPOINT`, `PROJECT_RESOURCE_ID`; some modules separately require `PROJECT_ENDPOINT` |
| Models | `AZURE_AI_AGENT_MODEL_DEPLOYMENT`, `AZURE_AI_MODEL_DEPLOYMENT_NAME`, `AZURE_ALLOWED_DEPLOYMENTS`, `AZURE_OPENAI_CHAT_MODEL`, `AZURE_EVAL_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`; image/TikZ/memory/research overrides |
| Search/Blob | Search endpoint/connection/API version/blob container/service name; `COMMON_INDEX_NAME` and datasource/skillset/indexer/image names; `STORAGE_ACCOUNT_NAME` |
| Cosmos | `COSMOS_ENDPOINT`, `COSMOS_DATABASE`; frozen-data override is a maintenance escape hatch, not a normal deployment default |
| Optional/legacy | Bing/deep-research project/agent/connections, Document Intelligence endpoint, Content Safety endpoint, speech settings |
| Concurrency | `EKALAIVA_MAX_SYNC_THREADS`, `EKALAIVA_RESEARCH_MAX_PARALLEL`, Foundry timeouts, `COSMOS_CONNECTION_POOL_SIZE`, `CLARIFY_TIMEOUT_SECONDS` |
| Browser | `VITE_API_BASE_URL`, `VITE_API_URL`, `VITE_DASHBOARD_API_URL`, `VITE_USE_AGUI`; all `VITE_*` values are public |
| Evaluation | `EVAL_ENABLED` default false, interval/lookback/batch settings in the admin API |

[Agentic Shiksha Platform/Backend/azure\_services/config.py](<Agentic Shiksha Platform/Backend/azure_services/config.py>) centralizes only
part of configuration. Many modules still read `os.getenv`/`os.environ`; there is no
completed Pydantic-settings layer. Process environment overrides an optional `.env`;
OS settings win. Required alias sets differ between services, so one generic environment
recipe is insufficient. No secret values or concrete resource identifiers are copied here.

`common_azure_auth` caches sync credentials/tokens, serializes acquisition with an RLock
and retries Windows CLI locking errors. Its actual auto chain is **CLI first, then
DefaultAzureCredential**, despite an older comment saying otherwise. Async credentials
are per-use. This service identity is distinct from the learner JWT.
[Agentic Shiksha Platform/Backend/common_azure_auth.py](<Agentic Shiksha Platform/Backend/common_azure_auth.py#L111>).

### Headers, monitoring and queues

[Agentic Shiksha Platform/Frontend/nginx.conf.template](<Agentic Shiksha Platform/Frontend/nginx.conf.template>) sets HSTS, nosniff, framing,
referrer/permissions policy and CSP, with API and Speech hosts. The standalone dashboard
[Admin-Dashboard/frontend/nginx.conf](Admin-Dashboard/frontend/nginx.conf) lacks comparable headers/cache policy.
Speech uses WebSockets internally; application chat is SSE.

The application uses in-process queues/executors and Cosmos polling jobs, not a verified
Service Bus/Celery/Redis task system. Python logging has some scrubbing and job IDs, but
no application-wide correlation/trace instrumentation was found.
[Agentic Shiksha Platform/Frontend/src/lib/loggingService.ts](<Agentic Shiksha Platform/Frontend/src/lib/loggingService.ts>) keeps activity
and message-content logs in localStorage, not a centralized observability backend.

`persist_stream_usage` writes immutable response-level token facts into
`chat_messages_v1` under synthetic user partitions `__token_usage__:<agent>` and a
separate watermark partition. Startup reconciliation fetches newer Foundry responses
(cap 5,000); dashboards read Cosmos facts with legacy-source deduplication. This is not
a complete billing ledger for every auxiliary LLM/image/search call.
[Agentic Shiksha Platform/Backend/teacher\_dashboard/token\_stats.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/token_stats.py>),
[Agentic Shiksha Platform/Backend/teacher_dashboard/cosmos_queries.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/cosmos_queries.py#L777>).

### CI and current-state evidence

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs main-backend pytest on Python
3.11 with synthetic settings, a main frontend Vite build on Node 22, and main Docker
builds plus a backend `.env` exclusion check. It does not run standalone dashboard
builds/tests, Playwright, ruff or gitleaks. The frontend-only job bypasses TypeScript;
the Docker frontend build runs the stricter package script. Host pytest does not install
ngspice, and solver tests skip when absent; merely building an image is not solver testing.

[.github/workflows/codeql.yml](.github/workflows/codeql.yml) runs security-extended
Python/JS/TS checks on push/PR and weekly. [.github/dependabot.yml](.github/dependabot.yml)
covers actions, both Python/Node manifests and all Docker contexts. No automated cloud
release workflow is shown by these files.

Earlier in this conversation, circuit-context regressions passed with explicit SSE and
AG-UI, the main TypeScript/production build passed, and all four `2026-09-24-05` images
passed offline Nginx/static/compiled-marker/Python checks plus a real 6 mA ngspice test.
This audit does not claim a fresh full-suite run or live cloud health. Backend test
fixtures changed after earlier failures, so those failure counts are not a current
baseline. Working tree, committed source, remote agent versions, local images and live
deployment must be tracked separately.

## 12. Dependencies

| Area | Important dependencies and actual role |
| --- | --- |
| Main UI | React/React DOM `^19.2.3`, Router `^7.11.0`, Zustand `^5.0.8`; routing, render state and browser caches |
| UI system | Tailwind `^3.4.14`, Radix, class-variance-authority, clsx, tailwind-merge, Lucide; reusable styling/controls |
| Rich educational content | react-markdown, remark-gfm/math, rehype-katex/highlight/raw/sanitize, KaTeX, Mermaid, html2pdf.js, smiles-drawer |
| Browser integration | Microsoft Speech SDK, Framer Motion, sonner; retained MSAL.js packages do not mean browser MSAL owns current login |
| Frontend toolchain | TypeScript `~5.9.3`; Vite alias `rolldown-vite@7.2.2`; Playwright `^1.63.0`; main frontend also declares ESLint |
| Main API | FastAPI `0.120.0`, Uvicorn `0.38.0`, python-multipart `0.0.32`; Pydantic is relied on through the dependency tree |
| Foundry | azure-ai-projects `2.0.0b2`, azure-ai-agents `1.2.0b5`, OpenAI SDK obtained transitively; preview API compatibility is operationally significant |
| Retrieval | azure-search-documents `11.7.0b2`, azure-ai-documentintelligence `1.0.0`; Search preview knowledge-base APIs and document processing |
| Data and credentials | azure-cosmos `4.14.5`, azure-storage-blob `12.25.1`, azure-identity `1.25.1`, azure-core `1.41.0` |
| OAuth | MSAL Python, PyJWT, httpx; Entra/Google flows and local session tokens |
| Document/media processing | PyMuPDF, python-docx, python-pptx, Pillow, pdf2image, Poppler, TeX Live; ngspice is an OS package, not a Python dependency |
| Model helpers | LiteLLM `1.98.0` for vision transcription; Azure evaluation SDK plus custom evaluation calls |
| Curriculum history | Dulwich, a pure-Python Git implementation; distinct from normal repository Git history |
| Dashboard-only difference | json-repair `0.61.7` for research-output repair; separate dependency manifest and simpler build gate |

Sources: [Agentic Shiksha Platform/Frontend/package.json](<Agentic Shiksha Platform/Frontend/package.json>),
[Admin-Dashboard/frontend/package.json](Admin-Dashboard/frontend/package.json),
[Agentic Shiksha Platform/Backend/requirements.txt](<Agentic Shiksha Platform/Backend/requirements.txt>), and
[Admin-Dashboard/backend/requirements.txt](Admin-Dashboard/backend/requirements.txt).
These are **declared constraints**, not a claim that every workstation has those resolved
versions. Node has lockfiles; Python mixes exact pins, lower bounds and an unpinned
management SDK. The main UI's `build` runs `tsc -b && vite build`; the admin UI's build
runs only `vite build`. The repository instruction claiming TypeScript always fails is
historical: the main production build passed during the circuit-context work in this session.

## 13. Architecture Problems

These are findings about the inspected code, not claims of a production exploit.

### Security and prompt correctness

| Priority | Finding | Concrete evidence and corrective direction |
| --- | --- | --- |
| Critical | Legacy transcript/profile APIs use caller-supplied IDs without authentication/ownership dependencies. If reachable, their read/write/delete operations are exposed. | `get_thread_messages`, `sync_chat_data`, `load_all_chat_data`, `get_user`, `update_user`, `delete_user`, [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L10403>). The app has no global auth middleware. Add active-account and resource-owner dependencies; external network/Easy Auth protection is unverified. |
| Critical | Standalone admin APIs include unprotected cross-course reads and administrative writes; UI roles and CORS do not authorize requests. | `update_image_quota`, ownership/teacher/directory handlers and `logging_agent_chat_stream`, [Admin-Dashboard/backend/main.py](Admin-Dashboard/backend/main.py#L285). The protected embedded teacher service is not a guard for this separate app. |
| High | Shared pedagogical instructions contain a specific algorithms course and fixed learner environment/profile, contaminating unrelated TA prompts. | [Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/pedagogical_framework.md](<Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/pedagogical_framework.md#L55>), `unify_agent_prompts`, [Agentic Shiksha Platform/Backend/utils/prompt\_unifier.py](<Agentic Shiksha Platform/Backend/utils/prompt_unifier.py>). Separate generic pedagogy, per-course data and per-learner context; add composition tests. |
| High | Authorizing the course does not authorize a supplied Foundry conversation ID. The continuation path does not establish its user/course ownership before passing it to Responses. | `agent_chat_continue`, `_open_agent_stream`, [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L2655>), `GeneralAgent.continue_chat_stream`. Persist/check a user-course-conversation binding; ID unpredictability is not ownership. |
| High | Generic exception handlers and many legacy route errors return exception strings. | `azure_err_handler`, `unhandled_err_handler`, [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L920>); image tool error captions too. Return generic external errors and correlation IDs, not infrastructure/request details. |
| High | Image-quota storage failure allows generation, removing the spend boundary during a metering outage. | `_spend_quota`, [Agentic Shiksha Platform/Backend/agent_tools/custom/generate_image/__init__.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/generate_image/__init__.py#L151>). Fail closed or define a genuinely bounded degraded policy. |
| High | Evaluation can drop the session filter and judges a later retrieval rather than exact generation-time evidence. | `_retrieve_context_with_chunks`, [Admin-Dashboard/backend/groundedness_evaluator.py](Admin-Dashboard/backend/groundedness_evaluator.py#L60), periodic loop in [Admin-Dashboard/backend/main.py](Admin-Dashboard/backend/main.py). Reject unresolved scope and persist original retrieval provenance. |
| Medium | Teacher auth checks role but not active status, and accepts teacher/admin but not literal superadmin. The newer dependency has a different policy. | [Agentic Shiksha Platform/Backend/teacher_dashboard/teacher_auth.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/teacher_auth.py#L104>) versus [Agentic Shiksha Platform/Backend/backend/dependencies/auth.py](<Agentic Shiksha Platform/Backend/backend/dependencies/auth.py>). Unify identity policy while retaining course/evidence scoping. |
| Medium | OAuth pending flows, clarification waits and analytics scope fingerprints are process-local. Clarification submission has no user binding. | [Agentic Shiksha Platform/Backend/auth.py](<Agentic Shiksha Platform/Backend/auth.py>), [Agentic Shiksha Platform/Backend/google\_auth.py](<Agentic Shiksha Platform/Backend/google_auth.py>), [Agentic Shiksha Platform/Backend/utils/clarification\_registry.py](<Agentic Shiksha Platform/Backend/utils/clarification_registry.py>). Replica routing/restarts can break flows; move expiring state to shared storage and bind actions to users. |
| Medium | The persistence mastery gate is weaker than the pedagogy contract: any misconception evidence can permit a concept to be learned. | `update_topic_in_state`, [Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py#L2692>). Compute eligibility from structured evidence for each required misconception/framing; do not rely only on the model's judgment. |
| Medium | `crossed` in the pedagogy fragment is not a valid `update_topic_progress` status; first-turn/progress/closing examples also conflict across prompts. | Shared prompt files and [Agentic Shiksha Platform/Backend/agent\_tools/custom/update\_topic\_progress/definition.json](<Agentic Shiksha Platform/Backend/agent_tools/custom/update_topic_progress/definition.json>). Contract-test examples and remove contradictory instructions before tuning models. |

External App Service access restrictions, Easy Auth or private networking could reduce
exposure, but this repository does not prove them. SameSite=None cookie authentication
also needs an explicit CSRF/origin strategy; no unified CSRF mechanism was found.
No live data endpoints were probed. Do not weaken protected APIs to satisfy old tests.

### Cross-cutting design findings

| Priority | Finding and consequence | Evidence / recommended direction |
| --- | --- | --- |
| High | Unknown function tools receive a success message even though nothing ran. This can cause a model to falsely report completion. | `GeneralAgent._dispatch_tool_call`, [Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py#L1136>). Return an explicit unsupported-tool failure; validate against the active agent's capabilities. |
| High | `update_topic_progress` is acknowledged before a daemon thread attempts the database write. Restart/failure can lose progress after the model was told it was accepted. | Same dispatcher, [Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py#L1106>). Use an awaited bounded write or the persisted-job pattern already used for materials. |
| High | Multiple histories and transient states must be reconciled manually: Foundry conversation, Cosmos transcript, local cache, hook transcript, generated assets and editor drafts. The missing circuit-to-chat state bridge was a concrete example, now fixed for an open pane. | [Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts](<Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>), [Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts](<Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts>), [Agentic Shiksha Platform/Frontend/src/lib/circuit.ts](<Agentic Shiksha Platform/Frontend/src/lib/circuit.ts>). Establish explicit per-turn input/output contracts and ownership. |
| Medium | The main API module has 11,631 lines and 155 literal-path route decorators; several responsibilities have separate newer routers but legacy paths remain. Overlapping route declarations complicate route order and maintenance. | [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py>); measured by AST inspection. Duplicate `/api/agents/check-name` definitions and overlapping tools/update handlers need explicit consolidation, not another handler appended at the bottom. |
| Medium | Core frontend orchestration is concentrated in large modules: `ChatView` 4,075 lines, `useAgentChat` 3,394, embedded teacher dashboard 3,831; admin `DashboardView` 3,664. | [Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx](<Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>), [Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts](<Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>), [Agentic Shiksha Platform/Frontend/src/features/dashboard/TeacherDashboardPage.tsx](<Agentic Shiksha Platform/Frontend/src/features/dashboard/TeacherDashboardPage.tsx>), [Admin-Dashboard/frontend/src/pages/DashboardView.tsx](Admin-Dashboard/frontend/src/pages/DashboardView.tsx). Extract feature-owned state machines/API services with regression tests, not a cosmetic file split. |
| Medium | Agent creation can continue when a function tool fails to import/register, while requested Search attachment fails closed. This can produce an agent with a partially missing UX toolset. | `AgentToolBuilder._add_function_tools` versus `_add_ai_search`, [Agentic Shiksha Platform/Backend/azure_services/agents/agent_creation.py](<Agentic Shiksha Platform/Backend/azure_services/agents/agent_creation.py#L202>). Define required/optional capabilities and validate the created definition. |
| Medium | Dependency/build reproducibility differs across services, with preview SDKs, partially unpinned Python packages and no admin TypeScript gate. | The four dependency manifests above. Pin and test the intended Python/SDK matrix and align CI with all four artifacts. |

## 14. Feature Inventory

Status means code coverage of the feature, not a promise about a live deployment.

| Feature | Frontend | Backend | Agent/LLM | Storage | Status | Key files |
| --- | --- | --- | --- | --- | --- | --- |
| Microsoft/Google sign-in + onboarding | Auth screens/guard | OAuth callbacks/JWT/directory promotion | None | C1 invites + C2 profiles | Implemented; local OAuth state and uneven API enforcement | [Agentic Shiksha Platform/Backend/auth.py](<Agentic Shiksha Platform/Backend/auth.py>), [Agentic Shiksha Platform/Frontend/src/lib/useAuth.ts](<Agentic Shiksha Platform/Frontend/src/lib/useAuth.ts>) |
| TA library / invitation links | Library/JoinAgentPage | Metadata list + access-aware code connection | None | agents/users | Implemented; code link does not auto-enroll students | [Agentic Shiksha Platform/Backend/backend/routers/agent\_membership.py](<Agentic Shiksha Platform/Backend/backend/routers/agent_membership.py>), [Agentic Shiksha Platform/Frontend/src/pages/LibraryView.tsx](<Agentic Shiksha Platform/Frontend/src/pages/LibraryView.tsx>) |
| Explicit student assignments | Admin dialog | Active-admin roster update with revision | None | agent student IDs + invite/OAuth mapping | Implemented | [Admin-Dashboard/frontend/src/components/StudentAssignmentsDialog.tsx](Admin-Dashboard/frontend/src/components/StudentAssignmentsDialog.tsx), [Agentic Shiksha Platform/Backend/backend/schemas/agent\_membership.py](<Agentic Shiksha Platform/Backend/backend/schemas/agent_membership.py>) |
| TA creation/resume | CreateView + job panel | Durable creation/material job | CACA + composed TA definition | jobs, Foundry, setup Blob, agents | Implemented; TA may precede material/curriculum readiness | [Agentic Shiksha Platform/Backend/utils/course\_creation.py](<Agentic Shiksha Platform/Backend/utils/course_creation.py>), [Agentic Shiksha Platform/Frontend/src/features/create/CreateView.tsx](<Agentic Shiksha Platform/Frontend/src/features/create/CreateView.tsx>) |
| Course Companion | FormAssistant patch/highlight/undo | Strict scoped form assistant API | form-fill-assistant v4 | Browser companion history | Implemented; not an independent lifelong companion | [Agentic Shiksha Platform/Backend/backend/routers/course\_form\_assistant.py](<Agentic Shiksha Platform/Backend/backend/routers/course_form_assistant.py>), [Agentic Shiksha Platform/Frontend/src/features/create/FormAssistant.tsx](<Agentic Shiksha Platform/Frontend/src/features/create/FormAssistant.tsx>) |
| Material ingestion/RAG | File review/status/edit | Preflight, copies, leases, index verification | Search embedding/Layout services | originals, copies, common index, jobs | Implemented; legacy pipeline APIs coexist | [Agentic Shiksha Platform/Backend/utils/material\_jobs.py](<Agentic Shiksha Platform/Backend/utils/material_jobs.py>), [Agentic Shiksha Platform/Backend/azure\_services/tools/search/course\_index\_manager.py](<Agentic Shiksha Platform/Backend/azure_services/tools/search/course_index_manager.py>) |
| Course-source evidence | Citation/source drawer | Scoped validated passages + protected download | TA synthesis with evidence | Search + originals | Implemented for explicit passage path | [Agentic Shiksha Platform/Backend/utils/course\_materials.py](<Agentic Shiksha Platform/Backend/utils/course_materials.py>), [Agentic Shiksha Platform/Frontend/src/components/chat/CourseMaterialSources.tsx](<Agentic Shiksha Platform/Frontend/src/components/chat/CourseMaterialSources.tsx>) |
| Curriculum/threshold research | Poll/retry syllabus panel | Durable wrapper around staged research helpers | CACA/textbook/threshold | curriculum Blob, jobs, raw local checkpoints | Implemented; still coupled to legacy main helpers | [Agentic Shiksha Platform/Backend/utils/course\_creation.py](<Agentic Shiksha Platform/Backend/utils/course_creation.py>), [pipeline](<Agentic Shiksha Platform/Backend/backend/main.py#L5697>) |
| Curriculum edit/history | Modules/concepts/history/commit | Save/current/history/diff | No LLM required for manual edit | Blob JSON + Dulwich tarball | Implemented; concurrent history writes unsafe | [Agentic Shiksha Platform/Backend/azure\_services/persistence/curriculum\_git.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/curriculum_git.py>), [Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx](<Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>) |
| Curriculum translation | Language/style/custom instructions | Source-hash/lock/strict mapping | Direct configured chat model | Blob cache | Implemented | [Agentic Shiksha Platform/Backend/backend/routers/curriculum\_translation.py](<Agentic Shiksha Platform/Backend/backend/routers/curriculum_translation.py>), [Agentic Shiksha Platform/Frontend/src/components/chat/SyllabusTranslationControl.tsx](<Agentic Shiksha Platform/Frontend/src/components/chat/SyllabusTranslationControl.tsx>) |
| Streaming TA chat | ChatView/useAgentChat | GeneralAgent + SSE/AG-UI | Named course TA | Foundry + Cosmos transcript | Implemented; two transport paths and multiple state representations | [Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts](<Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>), [Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py>) |
| Chat save/load/retry | Store + sync + pagination | Legacy transcript CRUD/batch | Title helper; model history separate | user-partitioned chat | Implemented; auth/conversation binding concerns | [Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts](<Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts>), [Agentic Shiksha Platform/Backend/azure\_services/persistence/cosmos\_db.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py>) |
| Clarifications/follow-ups | Paged card + suggestions | Registry and helper endpoints | ask_clarification/suggestion tool/helper | Short-lived process state | Implemented; clarification not replica-safe | [Agentic Shiksha Platform/Backend/utils/clarification\_registry.py](<Agentic Shiksha Platform/Backend/utils/clarification_registry.py>), [Agentic Shiksha Platform/Frontend/src/features/chat/ClarifyBlock.tsx](<Agentic Shiksha Platform/Frontend/src/features/chat/ClarifyBlock.tsx>) |
| Documents, challenges | Shared block/pane renderers | Packaging tools | Course TA generates content | message metadata/assets | Implemented | [Agentic Shiksha Platform/Backend/agent\_tools/custom](<Agentic Shiksha Platform/Backend/agent_tools/custom>), [Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx](<Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx>) |
| Quizzes/first-attempt evidence | QuizBlock/review/feedback | Canonical mapping, write-once attempt | Course TA + feedback | quiz asset with immutable firstAttempt | Implemented for formative assessment | [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_quiz/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_quiz/__init__.py>), [attempt persistence](<Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py#L3613>) |
| Progress/misconceptions | Syllabus status/teacher views | Inference + topic/concept updates | Tutor judgment | learning states | Implemented; write reliability/evidence gate caveats | [Agentic Shiksha Platform/Backend/azure\_services/persistence/progress\_inference.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/progress_inference.py>), [Agentic Shiksha Platform/Backend/agent\_tools/custom/update\_topic\_progress/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/update_topic_progress/__init__.py>) |
| Slide decks/PPTX | Launch card + presentation pane | Strict deck schema/native export | add_slides for content, no LLM needed to export | message/assets | Implemented | [Agentic Shiksha Platform/Frontend/src/features/chat/SlidesBlock.tsx](<Agentic Shiksha Platform/Frontend/src/features/chat/SlidesBlock.tsx>), [Agentic Shiksha Platform/Backend/utils/slide\_export.py](<Agentic Shiksha Platform/Backend/utils/slide_export.py>) |
| Generated images | Image blocks/library media | Quota + Images API + Blob/SAS | Configured image model | image blobs + message URLs | Implemented; quota/upload failure caveats | [Agentic Shiksha Platform/Backend/agent\_tools/custom/generate\_image/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/generate_image/__init__.py>), [Agentic Shiksha Platform/Frontend/src/pages/LibraryMedia.tsx](<Agentic Shiksha Platform/Frontend/src/pages/LibraryMedia.tsx>) |
| TikZ diagrams | Legacy image blocks | TeX/geometry/vision critique | Generator/discriminator/polisher | block/image payloads | Retained for older TAs; no default new attachment | [Agentic Shiksha Platform/Backend/agent\_tools/custom/add\_tikz\_diagram/\_\_init\_\_.py](<Agentic Shiksha Platform/Backend/agent_tools/custom/add_tikz_diagram/__init__.py>) |
| Analog/industrial circuits | Editable SVG workbench + instruments | Bounded ngspice/device/measurement models | add_circuit builds validated spec; solver is deterministic | saved spec/result + temporary draft | Implemented educational model, not certified hardware design | [Agentic Shiksha Platform/Frontend/src/features/chat/CircuitBlock.tsx](<Agentic Shiksha Platform/Frontend/src/features/chat/CircuitBlock.tsx>), [Agentic Shiksha Platform/Backend/utils/circuit\_simulation.py](<Agentic Shiksha Platform/Backend/utils/circuit_simulation.py>) |
| Agent awareness of circuit edits | Scoped snapshot on outgoing chat | Existing chat endpoint | TA reads current topology/fresh readings | Temporary context + saved block | Implemented, packaged in local -05 release | [Agentic Shiksha Platform/Frontend/src/lib/circuit.ts](<Agentic Shiksha Platform/Frontend/src/lib/circuit.ts>), [Agentic Shiksha Platform/Frontend/chat-persistence.spec.ts](<Agentic Shiksha Platform/Frontend/chat-persistence.spec.ts>) |
| Hosted learning memory | Mostly implicit in chat | Per-agent memory provisioning | Foundry memory service | hosted scoped memory | Configured; end-user scope resolution not verified | [Agentic Shiksha Platform/Backend/azure\_services/tools/memory/memory\_store\_manager.py](<Agentic Shiksha Platform/Backend/azure_services/tools/memory/memory_store_manager.py>) |
| Public chat sharing | Read-only share page/panes | Authorized share control + public serializer | No model needed to view | token + message-ID boundary | Implemented; not immutable content snapshot | [Agentic Shiksha Platform/Backend/backend/routers/chat\_sharing.py](<Agentic Shiksha Platform/Backend/backend/routers/chat_sharing.py>), [Agentic Shiksha Platform/Frontend/src/pages/SharedChatView.tsx](<Agentic Shiksha Platform/Frontend/src/pages/SharedChatView.tsx>) |
| Teacher insights | Embedded dashboard + evidence view | Teacher scope/query/catalog layer | teacher-analytics-agent | progress/assets/chat/usage | Implemented; older teacher auth policy differs | [Agentic Shiksha Platform/Backend/teacher\_dashboard/routes.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/routes.py>), [Agentic Shiksha Platform/Backend/teacher\_dashboard/logging\_agent\_tools.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_tools.py>) |
| Admin operations/analytics | Separate admin SPA | Separate query/directory/evaluation API | logging-agent + organization researcher | shared Cosmos/Blob | Implemented; serious missing API auth coverage | [Admin-Dashboard/backend/main.py](Admin-Dashboard/backend/main.py), [Admin-Dashboard/frontend/src/pages/DashboardView.tsx](Admin-Dashboard/frontend/src/pages/DashboardView.tsx) |
| Token accounting | Course/student charts | Stream facts + startup reconciliation | No LLM for aggregation | synthetic usage records | Implemented, not exhaustive billing | [Agentic Shiksha Platform/Backend/teacher\_dashboard/token\_stats.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/token_stats.py>) |
| Groundedness evaluation | Dashboard score displays | Optional periodic/model judge | 3 direct judge roles/SDK option | evaluations | Optional; later-context/unscoped retrieval caveats | [Admin-Dashboard/backend/groundedness\_evaluator.py](Admin-Dashboard/backend/groundedness_evaluator.py) |
| Deep research | Research card/activity/source panels | Mixed Responses + threads/runs APIs | Remote research agent | remote research threads + browser/saved research | Implemented legacy path; cancellation/auth caveats | [research API](<Agentic Shiksha Platform/Backend/backend/main.py#L8220>), [Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts](<Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>) |
| Voice input | Speech hook/composer | Speech token endpoint | Speech recognition service | Temporary recognition state | Implemented; region/origin/token policy requires deployment config | [Agentic Shiksha Platform/Frontend/src/hooks/useSpeechRecognition.ts](<Agentic Shiksha Platform/Frontend/src/hooks/useSpeechRecognition.ts>) |
| General MCP/FileSearch integration | Legacy client functions | Old pipeline helpers, stub builders | Not attached to new TAs | Legacy Search resources | Deprecated/experimental, not current default | [Agentic Shiksha Platform/Backend/agent\_tools/hosted/mcp/builder.py](<Agentic Shiksha Platform/Backend/agent_tools/hosted/mcp/builder.py>), [Agentic Shiksha Platform/Backend/agent\_tools/hosted/file\_search/builder.py](<Agentic Shiksha Platform/Backend/agent_tools/hosted/file_search/builder.py>) |

## 15. Current Architecture Diagram

```text
										Microsoft Entra ID / Google OAuth
												 ^ auth redirects/callbacks
												 |
	+----------------------+-------------------------------------------+
	| MAIN BROWSER APP (React 19 / Router / Zustand / Tailwind)          |
	| Auth + onboarding | Library | Create/Edit | Course Chat | Assets  |
	| Embedded TeacherDashboard | Public SharedChatView                 |
	| ChatView -> useAgentChat -> SSE or AG-UI adapter -> ContentBlocks   |
	| Circuit/slide/document/quiz panes; temporary editor/form state     |
	| chatStore/localStorage <-> useChatSync/chatApi (separate history)  |
	+---------------------------+--------------------------------------+
										HTTPS JSON/multipart/SSE + HttpOnly session
															|
	+---------------------------v--------------------------------------+
	| MAIN FASTAPI / UVICORN                                             |
	| backend/main.py: composition, legacy routes, auth/research helpers |
	| New routers + Pydantic schemas + active-user/course dependencies  |
	|                                                                   |
	| GeneralAgent -------------------------------------------------+  |
	|  explicit passage retrieval / profiles / circuit snapshot      |  |
	|  function dispatch <-> same-TA function outputs                |  |
	|     | content tools | progress | Images API | legacy TikZ      |  |
	|     + circuit -> validated netlist -> ngspice -> numeric result |  |
	|     + slides -> deterministic native PPTX export               |  |
	|                                                                   |
	| Materials/creation worker ----+    Curriculum worker ------------+ |
	| (Cosmos leases/checkpoints)   |    (CACA -> books -> concepts)    | |
	| Teacher API -> scope/evidence -> teacher analytics agent         | |
	| OAuth state/clarifications/caches/executors = process-local      | |
	+---------------+--------------+----------------------------------+-+
									|              |                                    |
			 +----------v-------+  +---v-------------------+  +-------------v-------+
			 | COSMOS DB        |  | BLOB STORAGE          |  | MICROSOFT FOUNDRY   |
			 | C1 invites       |  | course originals      |  | named TA versions  |
			 | C2 users         |  | prepared indexing     |  | Conversations /    |
			 | agents/rosters   |  | copies + metadata     |  | Responses + tools  |
			 | chat + assets    |  | setup/curriculum JSON |  | hosted Memory      |
			 | learning states |  | Git history tarballs  |  | auxiliary agents   |
			 | jobs             |  | images/research/files |  | direct model APIs  |
			 | usage/evaluation |  +-----------+-----------+  +---------+-----------+
			 +----------+-------+              |                        |
									^              shared blob datasource           |
									|                      v                        |
									|       +---------------------------------------v------+
									|       | AZURE AI SEARCH + ENRICHMENT                  |
									|       | common on-demand indexer                     |
									|       | DI Layout -> 2000/200 character chunks       |
									|       | OpenAI embeddings -> HNSW + semantic index   |
									|       | session_id/file_category logical filtering  |
									|       | hosted Search OR explicit SDK retrieval     |
									|       +------------------------+--------------------+
									|                                ^
	+---------------+--------------------------------+---------------------+
	| SEPARATE ADMIN FASTAPI (8050)                                          |
	| cosmos_queries + dashboard_cache | directory/ownership/quota           |
	| logging-agent chat | institute/department research -> Blob             |
	| optional periodic evaluator -> re-retrieve Search -> model judges      |
	| Several routes lack equivalent main/teacher authorization              |
	+---------------------------^-------------------------------------------+
															| separate analytics HTTPS/SSE
	+---------------------------+-------------------------------------------+
	| SEPARATE ADMIN REACT SPA                                               |
	| Overview / Analytics / User Directory / Feedback                        |
	| StudentAssignmentsDialog -> MAIN FastAPI, not analytics backend         |
	+-----------------------------------------------------------------------+

	Auxiliary services: Bing, Document Intelligence, Speech, Content Safety.
	Deep-research STREAM path: separate Foundry project -> AgentsClient
	threads/runs -> local polling thread/queue -> SSE; not GeneralAgent loop.
	Hosting artifacts: four independent Docker images; no verified shared bus,
	distributed cache, Kubernetes cluster or full infrastructure-as-code stack.
```

## 16. Important Code References

Use this as the working navigation index; the earlier sections provide behavior and caveats.

| Code reference | Exact symbol / responsibility |
| --- | --- |
| [Agentic Shiksha Platform/Frontend/src/router.tsx](<Agentic Shiksha Platform/Frontend/src/router.tsx>) | `router`, `ProtectedLayout`, `DashboardRoute`: route and UI access boundaries |
| [Agentic Shiksha Platform/Frontend/src/layouts/MainLayout.tsx](<Agentic Shiksha Platform/Frontend/src/layouts/MainLayout.tsx>) | `MainLayout`, `useAppContext`: app shell, selected TA and builder-state ownership |
| [Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx](<Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>) | `ChatView`: route-to-conversation synchronization, syllabus/actions/artifact panes |
| [Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts](<Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>) | `useAgentChat`, `send`, `editMessage`, `retry`, `stop`: request assembly, stream state, response persistence |
| [Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts](<Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts>) | `useChatSync`, `toApiMessage`, `fromApiMessage`, `flushConversationForSharing`: independent transcript sync contract |
| [Agentic Shiksha Platform/Frontend/src/lib/circuit.ts](<Agentic Shiksha Platform/Frontend/src/lib/circuit.ts>) | `parseCircuitSpec`, `parseCircuitResult`, `insertSeriesComponent`, `circuitChatText`: validated topology/results and model-input snapshot |
| [Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx](<Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx>) | `AssetContent`: same educational renderer for live/saved/read-only artifacts |
| [Agentic Shiksha Platform/Frontend/src/features/create/CreateView.tsx](<Agentic Shiksha Platform/Frontend/src/features/create/CreateView.tsx>) | `handleCreateAgent`, `resumeCreation`, `completeCreation`: current create flow |
| [Agentic Shiksha Platform/Frontend/src/features/create/builderTypes.ts](<Agentic Shiksha Platform/Frontend/src/features/create/builderTypes.ts>) | `applyCourseFormPatch`, `undoCourseFormPatch`, `courseFormContext`: constrained companion edits and conflict preservation |
| [Agentic Shiksha Platform/Backend/backend/dependencies/auth.py](<Agentic Shiksha Platform/Backend/backend/dependencies/auth.py>) | `ActiveUser`, `get_current_active_user`: verified session -> active stored account |
| [Agentic Shiksha Platform/Backend/backend/dependencies/agent\_access.py](<Agentic Shiksha Platform/Backend/backend/dependencies/agent_access.py>) | `has_agent_access`, `check_agent_access`, `require_agent_access`, `require_agent_editor`: course/role boundary |
| [Agentic Shiksha Platform/Backend/backend/routers/course\_materials.py](<Agentic Shiksha Platform/Backend/backend/routers/course_materials.py>) | `materials_lifespan`, `require_material_job`, `require_course`, `knowledge_build`: worker startup and ownership |
| [Agentic Shiksha Platform/Backend/utils/material\_uploads.py](<Agentic Shiksha Platform/Backend/utils/material_uploads.py>) | `inspect_material`, `prepared_parts`: deterministic file validation and indexing-copy generation |
| [Agentic Shiksha Platform/Backend/utils/material\_jobs.py](<Agentic Shiksha Platform/Backend/utils/material_jobs.py>) | `create_draft`, `claim_job`, `save_checkpoint`, `check_indexing`, `remove_indexed_part`, `run_worker`: durable material state transitions |
| [Agentic Shiksha Platform/Backend/utils/course\_creation.py](<Agentic Shiksha Platform/Backend/utils/course_creation.py>) | `start_creation`, `generate_specification`, `create_foundry_agent`, `advance_creation`, `run_curriculum_worker`: current TA/curriculum lifecycle |
| [Agentic Shiksha Platform/Backend/azure\_services/agents/agent\_creation.py](<Agentic Shiksha Platform/Backend/azure_services/agents/agent_creation.py>) | `AgentToolBuilder`, `AgentCreator.create_agent`: concrete tool set and remote version creation |
| [Agentic Shiksha Platform/Backend/utils/prompt\_unifier.py](<Agentic Shiksha Platform/Backend/utils/prompt_unifier.py>) | `load_prompt`, `load_prompt_file`, `unify_agent_prompts`: local prompt loading/publication assembly |
| [Agentic Shiksha Platform/Backend/harness/runtime.py](<Agentic Shiksha Platform/Backend/harness/runtime.py>) | `GeneralAgent`, `_prepare_course_material_request`, `_dispatch_tool_call`, `_execute_tools_parallel`, `get_general_agent`: main model/tool runtime |
| [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py>) | `agent_chat_stream`, `_open_agent_stream`, `_with_sse_keepalive`, `_persist_stream_token_usage`: transport/side-effect boundary; `_background_textbook_research`: staged research |
| [Agentic Shiksha Platform/Backend/utils/course\_materials.py](<Agentic Shiksha Platform/Backend/utils/course_materials.py>) | `retrieve_course_passages`, `material_filename`, `session_filter`: validated retrieval provenance/isolation |
| [Agentic Shiksha Platform/Backend/azure\_services/tools/search/course\_index\_manager.py](<Agentic Shiksha Platform/Backend/azure_services/tools/search/course_index_manager.py>) | `_create_common_*`, `ensure_common_index_pipeline`, `run_common_indexer`: active common Search resource specification |
| [Agentic Shiksha Platform/Backend/azure\_services/persistence/cosmos\_db.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py>) | `get_cosmos_client`, `sync_messages_batch`, `create_share_token_for_thread`, `update_topic_in_state`, `create_first_quiz_attempt`: core persistence and evidence contracts |
| [Agentic Shiksha Platform/Backend/azure\_services/persistence/curriculum\_git.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/curriculum_git.py>) | `save_course_curriculum_version`, `_download_repo`, `_upload_repo`: Blob-backed Git history |
| [Agentic Shiksha Platform/Backend/utils/circuit\_simulation.py](<Agentic Shiksha Platform/Backend/utils/circuit_simulation.py>) | `circuit_netlist`, `parse_simulation`, `simulate_circuit`: solver execution/limits |
| [Agentic Shiksha Platform/Backend/teacher\_dashboard/routes.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/routes.py>) | `logging_agent_chat_stream`, `agent_overview`, `token_usage_analytics`, `learning_activity_analytics`: teacher workflows |
| [Agentic Shiksha Platform/Backend/teacher\_dashboard/logging\_agent\_tools.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_tools.py>) | `execute_scoped_tool`, `resolve_evidence_citations`: authorized analytics/evidence |
| [Agentic Shiksha Platform/Backend/teacher\_dashboard/token\_stats.py](<Agentic Shiksha Platform/Backend/teacher_dashboard/token_stats.py>) | `build_stream_usage_events`, `persist_stream_usage`, `sync_foundry_usage_to_cosmos`: token facts and recovery |
| [Admin-Dashboard/backend/groundedness\_evaluator.py](Admin-Dashboard/backend/groundedness_evaluator.py) | `_retrieve_context_with_chunks`, `evaluate_groundedness_with_llm`: post-hoc scoring, separate from inline TA inference |

## 17. Technical Debt and TODO Signals

### Verified signals, not just keyword counts

- **Explicit unfinished UI action:** `AssetsSection` contains `TODO: Open create asset modal`
  in [Agentic Shiksha Platform/Frontend/src/components/assets/AssetsSection.tsx](<Agentic Shiksha Platform/Frontend/src/components/assets/AssetsSection.tsx#L162>).
  Source search found no external consumer; do not confuse this with the routed AssetsView.
- **Unrouted legacy page:** `ProjectHomeView` has only its own declaration in the inspected
  source references and is absent from `router.tsx`. By contrast, `SettingsView` is used
  by `SettingsPage`; it is not dead simply because it is not directly routed.
  [Agentic Shiksha Platform/Frontend/src/pages/ProjectHomeView.tsx](<Agentic Shiksha Platform/Frontend/src/pages/ProjectHomeView.tsx>),
  [Agentic Shiksha Platform/Frontend/src/pages/SettingsPage.tsx](<Agentic Shiksha Platform/Frontend/src/pages/SettingsPage.tsx>).
- **Deprecated auth remnants:** MSAL.js config/packages and token helper stubs coexist
  with backend-cookie auth. `BYPASS_AUTH=false` and teacher dev-auth default-off are
  explicit testing switches, not evidence that production auth is currently bypassed.
- **Deprecated hosted tools:** file-search/MCP builders throw `NotImplementedError`;
  legacy Search/MCP management APIs and outdated comments still imply otherwise.
  The create form even has an old MCP attachment comment while the current backend uses
  a hosted Azure AI Search tool.
- **Dormant TikZ provisioning:** Pylance reports only the definition of
  `_ensure_agents_created`; the active diagram generator uses direct completions.
  The three named-helper creation blocks should not be assumed operational.
- **Duplicated prompt generations:** `_old` core files, form assistant v1/v2/v3,
  translation v1/v2/v3/v4, and root monolithic prompts remain. Current imports decide
  which one matters. A stored prompt is not automatically a runtime prompt.
- **Legacy creation defaults:** `BaseAgentManager.create_agent` checks local config
  and remote names by default. The legacy course-creation caller explicitly passes
  `save_to_config=False` to avoid writing local agent configuration.
- **Partial refactor:** `main.py` retains legacy creation/upload/history APIs alongside
  typed routers; newer utility modules still import constants/helpers from `backend.main`,
  retaining import-time cycles and app initialization coupling.
- **Legacy nonpersistent chat:** `/api/course-chats/sessions` uses an in-process session
  map, distinct from the real Cosmos transcript path. Do not extend it as a durable API.
- **State corruption risk:** the learning-state cache exposes mutable records without
  expiry or conditional writes. `update_topic_in_state` ignores failed-save return values.
  [Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py](<Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py#L2365>).
- **Unbounded orchestration/hidden work:** main and analytics `while pending_tool_calls`
  loops have no explicit overall round/cost cap; analytics finalization still issues an
  unseen response. Keep history-only finalization from the main runtime when consolidating.
- **Pagination/scale:** legacy `get_messages_for_thread` loads matching records before
  application-side slicing; teacher overview performs per-student profile lookups. Common
  indexing and long-running curriculum work compete inside API workers. Use measured
  profiles and continuation/batching limits rather than increasing thread counts alone.
- **Incomplete retention/concurrency:** curriculum-history tarballs are unconditional
  overwrites; file removal retains originals; user/thread deletion does not establish a
  full Cosmos/Blob/Search/Foundry erasure transaction.
- **Mock data distinction:** Playwright and pytest deliberately use synthetic data and
  mocked external services; that is test isolation, not a mocked production database.
  Test bodies do not prove live Foundry/Search/Cosmos integration health.
- **Historical documents:** `PLAN.md` still says several now-existing dependencies/tests
  are absent and includes historical secret-fallback findings. Current `JWT_SECRET` is
  required; do not repeat the old fallback allegation as current. The root README's
  dashboard path, prompt-loading scope and RAG chunking description are stale.
- **Build/test gap:** CI does not run the many browser checks or standalone services,
  and conditional ngspice tests can skip. A successful Vite build alone cannot certify
  UI behavior, auth or remote tool registration.

There is no evidence of a completed migration to the proposed single settings/client
registry or fully modular application factory. No runtime code was changed by this report.

## 18. Twenty Facts Before Modifying This Codebase

1. There are **four independently built services**; the embedded teacher dashboard runs
	in the main API/UI and is not the standalone admin dashboard.
2. The main application is React 19 + Router + Zustand + Tailwind 3, not Next.js, and its
	Vite package is the Rolldown alias.
3. `backend/main.py` remains the monolith, but repository conventions explicitly require
	new APIs in typed routers/schemas/dependencies; do not append another domain there.
4. Foundry agents are named/versioned; `agent_id` often means a name, not `asst_*`.
5. Local chat thread IDs, Foundry conversation IDs, and material session UUIDs have
	different meanings despite similar field names.
6. `GeneralAgent` objects are shared across users. Never place learner-specific mutable
	state on a cached agent instance; pass user ID on each turn/tool execution.
7. Client identity/roles are cache/UI hints. Use a verified cookie/bearer subject and
	server-side active account/course assignment checks on every protected operation.
8. Legacy/admin endpoints are not uniformly protected. Do not reuse an old handler's
	apparent lack of authorization as an acceptable pattern.
9. Student course access is explicit roster membership, including invite-to-OAuth ID
	mapping. An institution/department or six-character TA code is not enrollment.
10. Model history and Cosmos UI history are separate. Updating a saved artifact does
	 not automatically inform the TA; the open circuit snapshot bridge does so explicitly.
11. A new block crosses tool schema/dispatch, SSE/AG-UI, ContentBlock types, live rendering,
	 persistence, asset replay and public-share boundaries. Test all of them.
12. New course TAs get a filtered **shared** Search index. Do not recreate a per-course
	 pipeline merely because older helper names/examples still show one.
13. Current uploads retain original files and create deterministic indexing copies.
	 Citation pages/filenames must map back to the original through the saved material job.
14. TA creation, material indexing and curriculum generation are independent status
	 dimensions. A created TA is not proof of completed knowledge/curriculum.
15. Reuse the durable job/ETag/lease pattern for important long work; a daemon thread or
	 BackgroundTasks call is not a persisted queue.
16. Shared prompt files are published into remote versions, not automatically reloaded
	 on every turn. The current pedagogical fragment contains inappropriate course/profile
	 specifics and must be separated before broad prompt reuse.
17. Topic `in_progress`, topic `learned`, concept crossing, and first-attempt quiz evidence
	 are distinct. Do not equate chat volume, topic coverage or generated content with mastery.
18. Circuit answers come from bounded ngspice; models/components are educational. Fresh
	 results require Run after electrical edits; animation position is not a fresh solve.
19. C2 name placeholders do not anonymize the system. Emails/IDs/content and several
	 storage systems remain; never include real learner records or secrets in fixtures/docs.
20. A local build, a passing mocked test, a remote agent definition and a live deployment
	 are different evidence. Verify the exact service/config/version and preserve user work.

Primary anchors for these rules: the directory map, auth dependencies, `GeneralAgent`,
`material_jobs`, `course_creation`, `useAgentChat`, `useChatSync`, and the four manifests
referenced throughout this report.

## 19. Best Extension Points

### Safest places to extend

| Intended feature | Reuse / extend | Required safeguards |
| --- | --- | --- |
| New protected API | New module in [Agentic Shiksha Platform/Backend/backend/routers](<Agentic Shiksha Platform/Backend/backend/routers>), strict request/result schema, shared auth/course dependencies | Validate ownership; generic errors; test missing/disabled/wrong-role/outside-course cases |
| New teaching artifact | `CustomTool` schema/implementation + `AgentToolBuilder`, `ContentBlock` and existing asset renderer pipeline | Typed runtime validation; block cancellation; SSE/AG-UI parity; persistence/reload/share regression |
| Long-running workflow | `MaterialJob` / `CourseCreationState` pattern or a dedicated discriminated job using the same lease/ETag discipline | Idempotent inputs, uncertain-write reconciliation, restart claims, failure status and bounded retry |
| New material format | `inspect_material` / `prepared_parts` and material job schema | Byte/signature/expansion limits; deterministic copies; original identity/page provenance; safe deletion |
| New learning-evidence type | Teacher evidence catalog + scoped tools + asset/progress schema | Immutable source evidence, explicit scope, meaningful coverage; no model-selected authorization |
| New deterministic circuit device/instrument | Pydantic circuit/device schema + ngspice stamps/measurement helper + mirrored TS registry/inspector | Physics/topology reference tests, limits, stale-result handling, persisted/shared compatibility |
| New translated/localized curriculum view | Source-hash translation cache/validator and string mapping layer | Preserve canonical IDs, names/math where required; version cache by prompt/style/source |
| New dashboard metric | Persist response/event facts, bounded query projections, dashboard request cache | Same population/time filters in chart and detail; explicit missing-data states and source attribution |
| Reusable UI work | Radix primitives, common chat container, AssetContent/fullscreen control, material status panels | Keep mobile pane sizing, keyboard behavior and draft retention; avoid duplicating another renderer |

### Refactor before widening

1. Close auth/ownership gaps and unify teacher/admin identity policy before adding more
	administrative or data-export features.
2. Separate global pedagogy from course/learner data and validate prompt/tool examples
	before adding more agents or trying to fix behavior solely by changing models.
3. Introduce a shared bounded streaming-turn executor/typed event contract; preserve
	current completion/cancellation semantics and history-only finalization in tests.
4. Give artifact drafts an explicit context/persistence contract instead of another
	ad hoc bridge between hook state, messages, assets and panes.
5. Make progress writes conditional/reliable and formalize the evidence needed for a
	crossing before expanding mastery/credential features.
6. Extract service configuration/client lifecycle from `main.py` and remove utility imports
	back into app composition. Use the newer per-router client lifespans as starting points.
7. Add server-persisted retrieval/evaluation provenance, distributed flow state and a
	complete retention policy before scaling across replicas or institutions.

### Do not extend further in their current form

- The large legacy `backend/main.py` route families, unrestricted admin handlers,
  and in-memory course-chat session map.
- The duplicated copy-and-edit analytics streaming loops or global mutable learning-state cache.
- The monolithic `ChatView` / `useAgentChat` by adding another independent collection of
  booleans/refs for each artifact.
- Per-course index/MCP/file-search stubs as if they were the default current RAG architecture.
- Prompt-only claims of privacy, authorization, mastery, numeric correctness or budget enforcement.

## 20. Open Questions

1. Which working-tree changes are committed and actually deployed? The local -05 images
	are known; current live app/image versions were not queried.
2. What external access controls protect the legacy/admin APIs? The source itself does
	not consistently authenticate them. Private networking/Easy Auth must be verified,
	not assumed from an Azure hostname.
3. Do all referenced Foundry agents exist, with which exact model, tools, instructions
	and versions? In particular, form-fill-assistant v4, research agents and teacher
	analytics are external dependencies; local reference prompts are not authoritative.
4. How does Foundry resolve `{{$userId}}` when the application calls through a shared
	service credential? Where is per-learner hosted-memory isolation proved?
5. Where is a durable ownership mapping from Foundry conversation ID to authenticated
	user and course enforced for continuation/history operations?
6. Is the deployed Search index/skillset actually the common 2,000/200-character version,
	and are all expected metadata fields populated? The code schema alone cannot establish this.
7. Are native Blob soft deletion, retention, lifecycle cleanup and job/reservation expiry
	configured? The code does not show a complete infrastructure/retention definition.
8. Is retaining original removed materials intentional, and what is the full deletion
	contract across originals, prepared blobs, Search, curriculum versions, Foundry and caches?
9. Is a shared `temp-course-agent` still a supported preview workflow? How should access
	work now that real course metadata/ownership is required?
10. Is `web_search_enabled=False` in both normal chat endpoints intentional product policy
	 or a regression from the visible/reused toggle plumbing?
11. Should "crossed" require the full prompt-defined set of misconception/framing evidence,
	 and what is the intended policy for reasoning quality versus a correct answer selection?
12. Are standalone admin evaluations meant to be post-hoc plausibility checks or audits
	 of the exact evidence used at generation time? The current implementation supports the former.
13. How should existing remote TA schemas/prompts be upgraded after local changes without
	 losing custom tools or teacher configuration? Current enable controls are primarily add-only.
14. What are the intended tenant boundaries? Course/owner/session checks exist, but there
	 is no consistently enforced tenant partition across every endpoint and shared service.
15. What global request/model budget, cancellation and queue-fairness requirements apply
	 under simultaneous courses/users? Existing per-call limits do not answer that.
16. Is lifelong Lumen/credentialing a separate roadmap or external system? No complete
	 independently routed/service-backed implementation was established in this tree.
17. Which tests currently pass in a clean checkout with intended Python/Node/SDK versions?
	 Recent fixture edits make earlier full-suite failures an unreliable current baseline.

# CONTEXT FOR ANOTHER AI

## Product and constraints

Agentic Shiksha / Ekalaiva is a research teaching-learning platform, not a generic chatbot.
Teachers create course-specific Foundry Teaching Assistants from course descriptions,
textbooks, uploaded resources, prerequisites and starters. Students must be invited,
onboarded and explicitly assigned; they learn through chat, challenges, concept inventories,
documents, slides, images and simulations. Teacher insights aggregate evidence/progress;
administrators manage directories/rosters and cross-course analytics. Public tokenized
chat shares are read-only and do not enroll students. The stated goal is threshold-concept
crossing, not message count or competitive grades. Lifelong Lumen is mentioned in docs,
but the current implementation principally supports course TAs and a Course Companion
that helps teachers fill the creation form; do not invent another companion backend.

## Four services and entry points

- Main UI: `Frontend`, React 19 + TypeScript 5.9 + Router 7 + Zustand 5 + Tailwind 3;
  Vite is aliased to rolldown-vite 7.2.2. Entry: main.tsx -> router.tsx -> MainLayout.
  Routes: auth/onboarding; home/course/chat; library; create/edit; assets; teacher dashboard;
  public shared/:shareToken and join/:code; settings/help/learn; companion animation page.
- Main API: `Backend`, Python 3.11 + FastAPI. Uvicorn backend.main:app. main.py is still
  about 11.6k lines, with old routes plus new routers/schemas/dependencies. New work belongs
  in typed domain routers, not more main.py branches.
- Standalone admin UI: `Admin-Dashboard/frontend`, a separate React/Vite/Nginx app with
  overview, analytics, directory and feedback routes all mounting DashboardView.
- Standalone admin API: `Admin-Dashboard/backend`, FastAPI/Uvicorn main:app on 8050,
  flat imports and independent dependency manifest. Embedded teacher dashboard is in the
  main app, not this service. Admin student-assignment UI calls the main API; analytics
  uses the separate dashboard API.

## Frontend ownership and contracts

MainLayout owns selected TA and creation form context. ChatView orchestrates conversation,
history, syllabus and artifact panes. useAgentChat owns streaming/generation state and
per-turn callbacks; chatStore owns local threads/messages/profile/navigation; useChatSync
independently batches them to Cosmos after a 1-second debounce and supplies the pre-share
save barrier. Initial hydration/pagination and browser caches are bounded. Foundry model
history is distinct from Cosmos UI history. Never conflate local thread ID, Foundry
conversation ID and material session UUID. Client roles/user IDs are not authorization.

Renderable ContentBlock variants: text, document, quiz, challenge, TikZ/generated image,
circuit, slides, clarify, suggested_queries and tool_activity. Adding a block requires
tool schema/dispatch, SSE/AG-UI transport, types/rendering, save/reload, AssetContent and
public-share handling. Markdown is sanitized; Mermaid strict mode is enabled. Assets
reuse the live renderers; retired-feature assets are hidden without deletion. LibraryMedia derives
images from loaded chat messages, not a full server-side media catalog.

API layers are handwritten: lib/api.ts for agent/material/stream functions, chatApi.ts
for persistence/profile/assets/assessment, and separate teacher/admin dashboard clients.
VITE_API_BASE_URL and auth's VITE_API_URL must agree. VITE_* values are public build-time
settings. Normal chat is SSE; VITE_USE_AGUI=true uses an adapter that translates standard
AG-UI plus trusted A2UI surfaces back into the same block callbacks. Speech internally
uses its own SDK/WebSocket, not the application chat transport.

## Backend, agents and tools

New get_current_active_user validates the session JWT, re-fetches active Cosmos profile,
and checks role; require_agent_access/editor verifies explicit course assignments or
creator/co-teacher/admin access. Microsoft MSAL PKCE and Google OAuth produce a 7-day
HS256 HttpOnly Secure SameSite=None cookie, with bearer compatibility. Pending OAuth
flows are process-local. C1 invited_users_v1 is email-keyed; C2 users_v1 uses OAuth user
ID. Invites persist after promotion for audit/assignment mapping. Student names become
student_name in C2, but IDs/email/content remain: the system is not anonymous.

GeneralAgent uses AIProjectClient and OpenAI Conversations/Responses, referencing a named
Foundry agent. Cached runtime objects are shared by endpoint/agent/material session;
learner ID is per call. It handles streamed tools/prose, parallel independent function
calls (up to six), declared tool plans, citations and token usage. Successful main-loop
finalization writes conversation tool outputs without another model response. There is
no LangGraph/AutoGen/A2A orchestrator. A2UI is UI data, not agent RPC.

New TA tools: add_message, add_document, add_quiz, add_challenge,
add_circuit, add_slides, generate_image, get_threshold_concepts, update_topic_progress,
declare_plan, ask_clarification, suggest_next_queries. JSON definitions live beside
CustomTool.execute/output handlers; AgentToolBuilder registers FunctionTool(strict=False).
Runtime validation must enforce schemas. Hosted tools are filtered azure_ai_search,
optional memory_search and configured custom Bing; general web is disabled for new
course creation and both normal chat endpoints force web_search_enabled=False.

declare_plan forces subsequent tool_choice in order. ask_clarification emits a card and
waits up to 60 seconds in a process-local registry for submitted answers, then continues
the same turn. The registry is not replica-safe or user-bound. There is no explicit
overall turn round/cost cap. Unknown tool names currently get a false success message;
progress updates are acknowledged before a daemon write completes. These need repair.

Retained tools/helpers: old add_tikz_diagram direct generator/discriminator/polisher
calls, default gpt-5.4, with TeX/geometry validation; not attached to new TAs. Its named-
agent provisioner has no callers. generate_image uses configured Images API (default
gpt-image-2-1), fixed landscape, low/medium quality, Blob/SAS persistence and weekly
quota; quota-storage failure currently allows generation. search_knowledge_base has
only a legacy schema, not current dispatch. FileSearch/MCP builders are explicit stubs,
although old Search KB/MCP provisioning helpers remain.

Other model components: CACA course-agent-creation-agent produces course specs and
reframes syllabi; CCA course-conversational-agent/temp-course-agent are legacy builder/
preview identities. Course Companion calls form-fill-assistant version 4 (local expected
definition gpt-5, low reasoning, no tools, strict form JSON) with store=False and bounded
attachments/history. Translation directly calls configured CHAT_MODEL with strict batch
JSON and source-hash/user/style/instruction cache keys. gpt-4.1-mini handles titles and
next questions, with deterministic fallback/greeting cases. Separate teacher analytics
and admin logging agents call local analytics tools; their remote definitions/models
are not proven by source. Organization research reuses institute-research-agent.
Deep-research streaming alone uses AgentsClient threads/runs with polling and a 30-minute
limit; its nonstream endpoint uses Responses. Evaluation has three direct judge calls
or SDK groundedness and an optional periodic loop. A Content Safety progress-claim
check is post-hoc/logging, not a complete blocking safety pipeline.

## Prompts and lifecycle

utils/prompt_unifier.py combines agent_behavior, pedagogical_framework, tool_handling,
knowledge_grounding and safety_guardrails with the course-specific CACA instructions.
Publishing creates/updates a remote version; editing Markdown does not update existing
TAs automatically. Runtime uses remote named definitions. Local research/reference prompt
files may not be loaded by their callers; several prompts are still inline.

Critical content defect: shared pedagogical_framework.md includes an algorithms-course
identity, CLRS map and fixed learner/campus/language/interests. It is concatenated into
unrelated courses. Remove these data-specific assumptions from global pedagogy. Prompt
status crossed also conflicts with tool statuses learned/in_progress. Some example plans
contradict closing rules. Fix prompt contracts before escalating model complexity.

Course creation is now a durable job, not just the old BackgroundTasks helpers. CreateView
preflights files, obtains a deterministic owner/request-derived material draft, uploads
originals, posts create-async and polls/resumes. material_jobs/course_creation in Agentic Shiksha Platform/Backend/utils
use courses_v2 records, ETags, five-minute leases/30-second renewals, checkpoints and
bounded retries. CACA spec generation and memory preparation run in parallel; a metadata
job ID prevents adoption of an unrelated same-name remote agent or blind uncertain creates.
Setup JSON goes to Blob; agents_v1 stores metadata; TA readiness is separate from materials.

Curriculum research uses a durable wrapper around legacy main.py helpers: CACA reformat
or generate syllabus -> textbook-research-agent enrichment batches -> threshold-concept-
research-agent batches plus semantic consolidation -> curriculum JSON and Git history.
Automatic enqueue requires textbooks; explicit retry can use saved description. Some raw
checkpoint files remain local, so not every recovery path is replica-independent.

## RAG and storage

Current course RAG uses ONE common Azure AI Search index, not one per course. Uploads:
PDF/DOCX/TXT/MD/images; file limit 100 MiB, batch 250 MiB/100 files, PDF 2,000 pages.
Preflight validates content. Originals are immutable/hash-identified under material-originals;
prepared copies live under sessions/<session>/<scope>. PDF copies <=50 pages/16 MB;
TXT/MD becomes escaped HTML copies. Blob metadata carries session/scope/source/hash/
generation/page ranges. No LLM is needed for normal upload preprocessing.

The on-demand common indexer runs DI Layout (text, 2,000-character chunks, 200 overlap)
then Azure OpenAI embeddings. HNSW cosine plus semantic ranking; index fields include
content_id/text_document_id/title/text/vector/path/page/session_id/file_category and
optional section/chunk/image fields. Not every declared field is populated by current
projections. Hosted Search is filtered by material session. Explicit document-oriented
chat requests call retrieve_course_passages: intersect filter/session, exclude image rows,
validate returned session and Blob identity, max eight passages/12k chars, stable hash
citations and original-file/page remapping. Retrieval failure does not pretend success.
Regular questions may rely on model-chosen hosted Search instead.

Indexer readiness checks timestamps, expected copies and errors. Removal jobs delete
Search rows and prepared copies; originals are retained. Legacy per-session/unified/KB/
MCP and vision-Markdown routes still coexist, but are not the normal pipeline. Hosted
memory is one store per agent using {{$userId}} and a 300-second update delay; verify
actual end-user scope resolution under service credentials before assuming isolation.

Cosmos containers: users_v1, invited_users_v1, agents_v1, chat_threads_v1,
chat_messages_v1, assets_v1, learning_states_v1, departments_v1, feedback_v1,
groundedness_evaluations_v1, and courses_v2 (also jobs/reservations). _v1 names
do not imply the archived database; COSMOS_DATABASE chooses it and the old frozen
ekalaiva database is guarded. Setup/curriculum/research/media are Blob-backed. Curriculum
versions are Dulwich Git tarballs with no ETag write protection. No full erasure workflow
across Cosmos/Blob/Search/Foundry has been established.

Learning state IDs are user_agent_state with a partitionKey field; cached mutable docs
have no expiry/ETag protection and write outcomes are not always propagated. Deterministic
exposure inference marks at most three multiword topics in_progress, never learned.
First-attempt quiz assets use deterministic IDs and ETag/create-once semantics; assessment
content/answers are still client-visible, so this is formative assessment, not secure exams.
Concept crossing currently requires some misconception evidence, not the full prompt proof.

Teacher insights fix authorized courses/students server-side, use get_learning_evidence
plus four analytics tools, and resolve only known evidence refs. Selected-student mode
blocks class overview. Admin logging is broader and less guarded. Token events are
immutable Cosmos facts in synthetic per-agent chat-message partitions, with startup Foundry
watermark recovery; not all helper-call costs are accounted for. Post-hoc RAG evaluation
can re-retrieve without scope and is not original-evidence replay.

## Circuits, artifacts and public shares

CircuitBlock is a pane workbench with typed v1/v2 spec, SVG topology, series insertion,
nodes/grounds, instruments, events/faults and examples. Backend stamps allowlisted ngspice
circuits, limits two local solver slots/eight seconds and resource/output sizes. Industrial
models are parameterized educational approximations, not certified protection/plant models.
The private Industrial Trainer workflow is retired; Circuit Lab simulation remains.
Native slides export uses python-pptx, not another LLM.

Recent fixed behavior: running/adding a component used to save the UI circuit but not inform
the agent. The open editable pane now publishes user/agent/thread-scoped circuitChatContext;
circuitChatText appends current topology plus only fresh final-sample readings to the next
normal/edited request. Dirty/invalid/running/failed drafts send no stale readings. Context
clears on close/logout and is not cached or added to visible user text. Test both SSE/AG-UI.

Public sharing flushes writes, stores a random token and selected message-ID boundary,
and serves read-only sanitized artifacts. Reusing a link does not add future messages;
refresh does, revoke removes it. It is not a frozen copy of selected message contents.

## Risks and extension policy

Highest priorities: legacy chat/profile CRUD and standalone admin APIs lack equivalent
auth/ownership checks; client-supplied Foundry conversation IDs lack a proven user binding;
shared pedagogy contains another course/profile; errors leak details; quota failure opens
spending; progress writes/evidence gates are unreliable; evaluation can lose RAG scope.
Teacher auth itself is older (role-only, no active check, no superadmin literal). Do not
assume CORS or frontend AuthGuard fixes backend authorization. External network protection
is unknown. Process-local OAuth/clarification/cache state complicates horizontal scaling.

Add protected routers + strict schemas; use shared dependencies, durable leased jobs,
CustomTool/block contracts, AssetContent and evidence-catalog patterns. Refactor main.py,
ChatView/useAgentChat and duplicated analytics loops rather than growing them indefinitely.
Make authorization, status eligibility, bounds, IDs and numeric results deterministic;
reserve models for teaching/semantic synthesis. Fix prompt and data contracts before
adding more agents. No secrets/real user data in examples, no live changes assumed authorized.

CI: main Python pytest, main Vite build, main Docker builds, CodeQL, Dependabot. Missing:
standalone dashboard gates, Playwright, ruff/gitleaks and host ngspice installation.
Main package build includes tsc; admin build and standalone frontend CI use Vite only.
Local -05 images were built for linux/amd64 and smoke-tested, not pushed/deployed.
Recent context tests passed in both transports; no fresh full-suite/live-cloud validation
was performed for this architecture audit. Remote model definitions, deployment protection,
memory scope, retention, tenant boundaries and clean-checkout baseline remain open questions.