# Main platform frontend

The React application for course Teaching Assistants, their learners, and the
embedded teacher dashboard. This is separate from the
[Admin Dashboard frontend](../../Admin-Dashboard/frontend/README.md).

See [INSTALL.md](../../INSTALL.md) for complete setup and
[RELEASE_NOTES.md](../../RELEASE_NOTES.md) before upgrading an existing checkout.

## Graph Memory (opt-in per course)

For enabled courses, **Course Curriculum > Graph Memory** and **Learner profile >
Memory** display the server-derived learning profile. Concept mastery is separate
from threshold crossing. Pending processing, missing evidence, stale versions and
revalidation are explicit; unassessed prerequisites are not labelled struggles.
Off-mode courses retain the legacy interface.

Teachers use **Course Curriculum > Graph editor** to edit stable node IDs,
prerequisites, required misconception/transfer mappings and policy JSON. Draft
saves use server revisions. Publication creates an immutable reviewed version;
a scoped administrator must activate its curriculum binding separately.
The advanced JSON editor covers approved problems and frozen rubric definitions.
Policy defaults are illustrative, uncalibrated settings, not pedagogical probabilities.

**Dashboard > My Students** provides course-only cohort counts, partial-coverage
status and authorized individual evidence drilldown. Learning profiles are never
editable local-storage truth. Only unfinished quiz selections/reasoning are cached.
Server-issued diagnostics contain no answer keys before submission, preserve their
assessment/curriculum identity through SSE, A2UI and saved assets, and display grades
only from the server. Their first attempt remains immutable.

Synthetic browser/API contracts (no Azure calls):

```powershell
npx playwright test learner-memory.spec.ts
```

The main backend is the authority for permissions, scope, immutable evidence and
publication validation. No new browser credential or dependency is required.

## Stack

- React 19, TypeScript 5.9 and React Router 7.
- `rolldown-vite` 7.2.2, installed under the `vite` package name.
- Tailwind CSS 3, local shadcn/Radix primitives and Lucide icons.
- Zustand stores, Fetch-based APIs, React Markdown, KaTeX and Mermaid.
- Playwright browser regressions with synthetic intercepted API responses.

Use Node.js 22.12 or newer in the Node 22 line, matching the CI major version.
The locked Vite package also accepts Node 20.19 or newer in the Node 20 line.
Node 18 does not satisfy its engine requirement. Install with `npm ci` and keep
[package.json](package.json) and [package-lock.json](package-lock.json) together.

## Local development

From the repository root:

```powershell
Set-Location -LiteralPath '.\Agentic Shiksha Platform\Frontend'
npm ci
# First setup only; preserve an existing .env.
Copy-Item .env.example .env
npm run dev -- --host localhost --port 5173 --strictPort
```

Before starting, edit `.env` using the [installation configuration guide](../../INSTALL.md#main-frontend).
The normal app needs a configured [main backend](../Backend/README.md); installing
the frontend alone does not provision services or create a sign-in account.

| Setting | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Main API origin; local default `http://localhost:8000` |
| `VITE_API_URL` | Authentication API origin; set to the same local backend origin |
| `VITE_USE_AGUI` | `false` for legacy SSE, `true` for the AG-UI adapter |
| `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`, `VITE_AZURE_REDIRECT_URI` | Historical client settings retained in the example; active sign-in is backend-mediated through `VITE_API_URL` |

[vite.config.ts](vite.config.ts) sets the `@` alias and React plugin; it does not
proxy API traffic. Keep `localhost` versus `127.0.0.1`, CORS origins and OAuth
redirects consistent. All `VITE_` values are public and compiled into the browser
bundle: never place credentials in them.

[msalConfig.ts](src/lib/msalConfig.ts) is a compatibility stub. Configure OAuth
credentials and callback URLs on the backend/provider; changing the old frontend
MSAL variables alone does not configure sign-in.

The embedded teacher dashboard uses the main API and its session cookie, not the
separate admin service. See [dashboard configuration](src/features/dashboard/lib/config.ts).

## Source map

| Path | Responsibility |
| --- | --- |
| [src/main.tsx](src/main.tsx) | React root, theme, notifications and router |
| [src/router.tsx](src/router.tsx) | Actual public/protected route registration |
| [src/layouts](src/layouts/README.md) | Main layout, selected TA and form context |
| [src/pages](src/pages/README.md) | Library, chat, assets, settings, shares and preview routes |
| [src/features](src/features/README.md) | Creation, editing, chat and teacher-dashboard behavior |
| [src/components](src/components/README.md) | Shared UI, authentication, artifacts and chat shells |
| [src/lib](src/lib/README.md) | API transports, stores, schemas and configuration |
| [src/hooks](src/hooks/README.md) | Role presentation and voice-input hooks |
| [public](public/README.md), [src/assets](src/assets/README.md) | Static versus bundled assets |

## User flows

- **Create:** configure one course TA, review/upload materials, then submit a durable
  creation job. Saved work opens in a recovery dialog; retries do not require a
  second upload. See [creation](src/features/create/README.md).
- **Edit:** simple and advanced configuration use Course Companion for unsaved
  changes; **Update** remains explicit. See [editing](src/features/edit/README.md).
- **Chat:** persisted conversations, Concise/Balanced/Comprehensive answer depth, learner
  profile, course sources and structured educational artifacts. Documents and
  concept inventories have centered fullscreen reading layouts. The **+** menu
  includes **Presentation** and **Simulation**; `/presentation` (or `/slides`)
  and `/simulation` select the same actions. Selection preserves the draft and
  requests generation only when the learner sends the message.
- **Assets:** filter documents, quizzes, challenges, presentations and simulations
  and return to their originating chat. These five filters remain visible even
  before an asset of that type has been saved; empty results are not generated
  examples. Legacy slide/circuit payloads use the same Presentation/Simulation
  labels as their filters without rewriting stored content. Retired historical
  assets remain stored but are not rendered.
- **Library:** browse TAs and their previews. Default course badges use colored
  initials on dark rounded squares; uploaded images are preserved.
- **Teacher dashboard:** course-scoped roster/activity/progress analytics within
  the same application; not the standalone admin SPA.

**TA actions > Learner profile** edits account-wide default instructions and shows
current-course progress. Instructions apply on subsequent turns, including existing
conversations. Saves await backend confirmation; unavailable progress is not
displayed as zero. Closing with unsaved edits asks before discarding them.

## Verification

Run from this directory:

```powershell
npm run build
npm run lint
# Use installed Edge on Windows, or install Playwright Chromium as in INSTALL.md.
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npx playwright test share-ta.spec.ts learner-profile.spec.ts
```

`npm run build` runs `tsc -b` before Vite. The existing `test:share` npm script runs
the Playwright configuration, which includes more than sharing tests:

| Test | Coverage area |
| --- | --- |
| [config.spec.ts](config.spec.ts) | Authoritative model configuration, validation, loading/failure/retry and setup preservation |
| [chat-persistence.spec.ts](chat-persistence.spec.ts) | Chat persistence, creation/editing, answer depth and artifacts |
| [chat-response.spec.ts](chat-response.spec.ts) | Pure response normalization and generation-lifecycle policies |
| [share-ta.spec.ts](share-ta.spec.ts) | TA sharing, header and course-information UI |
| [slides.spec.ts](slides.spec.ts) | Slides, export and explicit tool enablement |
| [companion-animations.spec.ts](companion-animations.spec.ts) | Character poses and motion |
| [learner-profile.spec.ts](learner-profile.spec.ts) | Instructions and course progress |

[playwright.config.ts](playwright.config.ts) starts one local Vite server on port
4175 by default and uses one worker. Set `PLAYWRIGHT_PORT` to an unused port when
another runner is active; `PLAYWRIGHT_OUTPUT_DIR` separates artifacts. Avoid sharing
or overwriting another run's output, and never replace synthetic fixtures with live
learner records. A development-only `/preview/pet-animations` route supports artwork
inspection without changing the real Course Companion.

## Production build

[Dockerfile](Dockerfile) builds the SPA and serves `dist` with Nginx.
Pass public `VITE_` build arguments to the Docker build. In particular,
`VITE_API_BASE_URL` determines both the compiled API endpoint and the Nginx CSP
backend origin. The Docker build also sets `VITE_API_URL` to that same origin
for backend-mediated sign-in and chat/asset persistence. Changing runtime App
Service settings alone cannot rewrite a previously built SPA.

The Dockerfile defaults to a configurable npm mirror through `NPM_REGISTRY`.
Use a trusted reachable registry and normal certificate validation; do not disable
TLS verification to make a build pass.

See [local container builds](../../INSTALL.md#local-container-builds) for commands.
Build context is this directory, not its parent. Do not commit `node_modules`,
`dist`, `.env` files or browser-test output.

For remote ACR builds and App Service deployment, use the
[shared command recipe](../../docs/deployment.md#azure-cli-container-and-app-service-commands)
with service key `main-frontend`. It uses the relocated
`Agentic Shiksha Platform\Frontend` context and versioned image tags.
The shared recipe passes declared build arguments and never stages a server
environment file. Provision shared resources through the
[Azure resource reference](../Backend/azure_services/README.md#azure-resource-creation-commands).
