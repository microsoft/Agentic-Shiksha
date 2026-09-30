# Admin-Dashboard/frontend

React + TypeScript + Vite client for the institution-wide admin dashboard. Talks to the
Admin Dashboard server on port 8050. The optional student-assignment editor and
Course/TA assignments in Add New User and CSV imports use the existing main
backend and are disabled unless the build explicitly sets
`VITE_STUDENT_ASSIGNMENTS_ENABLED=true`. Enable it only after verifying that
API's assignment routes, authenticated session, and credentialed CORS.

User CSV files contain only `name,email,role`. Use the dedicated College and
Department fields in **Import from CSV**, directly above upload. TA selection is
optional: without a TA, users are added to the directory without course access.
These selections do not depend on the single-user form. The course lists use the admin API's
`courseAffiliations` metadata to enforce the selected institution/department pair.
See [the admin workflow](../README.md#adding-users-with-a-courseta) for batch behavior,
admin rows and migration from the older CSV format.

The directory retains all saved user affiliations for grouping and filtering.
An imported existing user can appear in multiple college/department branches,
while totals and assignment writes still use the canonical user identity.
Within each department, course groups include only TAs explicitly placed in that
college/department pair. A shared teacher's membership does not repeat the TA under
their other affiliations. People without a matching local course remain visible
in that branch's unassigned group; their existing course access is unchanged.
Unplaced TAs remain selectable in the placement editor rather than appearing
under every member's department. Saving a new placement updates this tree as well
as the course dropdowns, including after a reload.

## Graph Memory availability

Courses with `graph_memory_mode` set to `shadow` or `authoritative` are labelled
**legacy progress unavailable** in the overview. Token/usage analytics retain
their existing meaning; they are not mastery evidence. Use the authorized main
teacher dashboard for Graph Memory. The separate admin API does not read or
expose the new learner ledger, snapshots or evidence.

## Assigning a TA to a department

Verified administrators can use **User Directory > Assign TA to department**.
The dialog lists all TAs, including unassigned TAs and those in other colleges.
Choose a TA, select or enter the exact college and department names, then save.
The main API uses revision-checked writes; conflicts require reloading. Clearing
placement removes only the department mapping, not teachers, students or access.

Course filters use explicit TA metadata. A creator's or teacher's affiliations
do not automatically place a TA in every one of their departments. A TA without
a complete explicit pair remains unassigned until an administrator places it.
The separate **Assign Students** dialog edits the roster; its institution and
department selectors filter students and do not move the TA.

## Setup

Use the [repository installation guide](../../INSTALL.md) for the main app and
[backend setup](../backend/README.md) for the separate admin API. Each frontend
has its own `package.json` and lockfile; installing in the main frontend does
not prepare this one.

Use **Node 22.12+** for development and tests. The locked Vite package
(`vite` is an alias for `rolldown-vite@7.2.2`) and React plugin require
`^20.19.0 || >=22.12.0`. Node 20.19+ can build the UI, but cannot run the
documented `--experimental-strip-types` test; that flag needs Node 22.6+.
The Node 22.12+ baseline covers both requirements.

[package-lock.json](package-lock.json) uses lockfile format 3 and currently
resolves React/React DOM `19.2.4`, TypeScript `5.9.3`, Tailwind `3.4.19` and
Playwright `1.63.0`. Use `npm ci` to reproduce it, rather than generating a new
dependency resolution with `npm install`. The package's `0.0.0` version is a
manifest value, not a published application release.

From the repository root in PowerShell:

```powershell
Set-Location '.\Admin-Dashboard\frontend'
npm ci
if (-not (Test-Path '.\.env.local')) { Copy-Item '.\.env.example' '.\.env.local' }
npm run dev
```

Vite requests port **5174**. If it is occupied, ordinary development mode can
choose another port; use the URL printed by Vite and update CORS deliberately.
For a fixed-port check, use `npm run dev -- --strictPort`. Normal UI use requires
configured backends and can read/write Azure resources; it is not an offline
demo. The browser suites below mock the APIs instead.

| Path | Purpose |
| --- | --- |
| [src](src/README.md) | Application source and routing. |
| [index.html](index.html) | Vite entry document. |
| [Dockerfile](Dockerfile), [nginx.conf](nginx.conf) | Container build; nginx serves the built assets. |
| [tailwind.config.cjs](tailwind.config.cjs), [postcss.config.cjs](postcss.config.cjs), [vite.config.ts](vite.config.ts) | Styling, `@` source alias, dev port and `/auth` proxy. |
| [playwright.config.ts](playwright.config.ts) | Mocked browser-suite server and feature-flag selection. |

## Configuration and routing

Variables prefixed `VITE_` are compiled into the browser bundle and are
**public**, not secret storage. [.env.example](.env.example) documents the
supported API/feature overrides; [src/lib/config.ts](src/lib/config.ts) is their
runtime source.

| Setting | Default | Meaning |
| --- | --- | --- |
| `VITE_DASHBOARD_API_URL` | `http://localhost:8050` | Admin analytics/directory/profile origin. Supply the origin without an `/api` suffix or trailing slash. |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Main API origin for assignment permission, rosters and membership writes. Whitespace, trailing slashes and a trailing `/api` are normalized. |
| `VITE_STUDENT_ASSIGNMENTS_ENABLED` | `false` | Only the exact string `true` enables assignment controls/requests. |
| `VITE_SUPER_ADMIN_EMAIL` | Empty | Legacy UI setting referenced in `DashboardView.tsx`; not an authorization mechanism. |

The main application's own frontend settings are separate. In particular,
`VITE_API_URL` is not consumed by this admin client's source; changing it does
not configure either API origin above.

- Analytics and directory calls go directly to port 8050, not through a Vite
  `/api` proxy. The admin backend's `ALLOWED_ORIGINS` must contain the UI origin.
- [useAuth.ts](src/lib/useAuth.ts) uses relative `/auth/*` URLs. During `npm run dev`,
  Vite proxies **only `/auth`** to `http://localhost:8000`. Setting
  `VITE_API_BASE_URL` does not change that proxy or these relative auth URLs.
- Assignment checks call the main API's `/auth/me` and `/api/user/{id}`, then
  its `/api/agents/{id}/students` and `/members` routes with
  `credentials: "include"`. The main backend must allow the admin origin in its
  credentialed CORS configuration (`CORS_ALLOWED_ORIGINS`).
- Sign in through the main application first with an active administrator
  account. Use the same hostname for sign-in and both APIs; do not mix
  `localhost` with `127.0.0.1`. For deployed cross-site origins, configure
  cookie scope/SameSite/Secure and browser access policies appropriately.

**Do not confuse the UI with server authorization.** The directory currently
sets `isAdmin` and `isSuperAdmin` to `true`, and the admin backend does not check
sessions on its directory/analytics/profile routes. Persisted browser roles,
`VITE_SUPER_ADMIN_EMAIL`, CORS and cookie inclusion do not fix that. Keep both the
admin API and UI behind an independently enforced private access boundary.
Assignment controls separately verify an active `admin`/`superadmin` against the
main API and do not trust those cosmetic flags.

## Validation

These checks need the npm dependencies installed first. There is no generic
`test` or `lint` script in [package.json](package.json).

```powershell
# Run from Admin-Dashboard\frontend
npx --no-install tsc -p .\tsconfig.json --noEmit
npm run build
node --experimental-strip-types --test .\dashboardRequestCache.test.ts
```

`npm run build` runs Vite only; it is not a substitute for the separate
TypeScript check. `npm run preview` serves the resulting `dist` locally for
inspection, not as a production server or an authenticated API proxy.

| Check | Coverage |
| --- | --- |
| [dashboardRequestCache.test.ts](dashboardRequestCache.test.ts) | Node-only cache coalescing, independent copies, account isolation, invalidation, failures and expiry. |
| `npm run test:overview` / [overview.spec.ts](overview.spec.ts) | Responsive token-usage dialogs, search, counts, unavailable data and retry behavior. |
| `npm run test:student-assignments` / [studentAssignments.spec.ts](studentAssignments.spec.ts) | Enabled assignment/CSV flows, membership and affiliation grouping, permissions, concurrency and error recovery. |
| [studentAssignmentsDisabled.spec.ts](studentAssignmentsDisabled.spec.ts) | Disabled controls and absence of assignment permission/roster requests. |

Browser tests require Playwright's Chromium or an installed supported channel.
To prepare Chromium, run `npx --no-install playwright install chromium` once;
this downloads a browser and is not an offline step. On Windows, an already
installed Edge can instead be selected with
`$env:PLAYWRIGHT_CHANNEL = 'msedge'`.

The configuration starts its own Vite server on **127.0.0.1:4184** with
`--strictPort --mode test` and never reuses a running dev server. It gives the
mock main API the distinct origin `http://127.0.0.1:4185/api/`; **do not start
a backend on 4185**. Tests intercept auth/API requests and use synthetic
identities/records. Once dependencies and a browser are present, they need no
Azure credentials or data. Artifacts go to `node_modules\.cache\playwright-results`.

By default, Playwright tests the enabled assignment configuration even though
the application default is disabled. Run both configurations explicitly:

```powershell
$previousAssignments = $env:PLAYWRIGHT_STUDENT_ASSIGNMENTS_ENABLED
try {
    $env:PLAYWRIGHT_STUDENT_ASSIGNMENTS_ENABLED = 'true'
    npx --no-install playwright test
    $env:PLAYWRIGHT_STUDENT_ASSIGNMENTS_ENABLED = 'false'
    npx --no-install playwright test
} finally {
    $env:PLAYWRIGHT_STUDENT_ASSIGNMENTS_ENABLED = $previousAssignments
}
```

The disabled configuration includes overview plus the disabled-assignment spec,
not `studentAssignments.spec.ts`. Do not run the enabled-only npm script with
the disabled flag and interpret missing tests as a pass. Mocked tests do not
prove deployed cookie, authorization or CORS behavior.

## Containers and upgrades

Use the [shared ACR/App Service commands](../../docs/deployment.md#azure-cli-container-and-app-service-commands)
with service key `admin-frontend` rather than copying the main frontend's command.
It covers the distinct public API origins and assignment flag, ACR publication,
managed image-pull identity and a selected-app-only update. Shared resource
creation is documented [once here](<../../Agentic Shiksha Platform/Backend/azure_services/README.md#azure-resource-creation-commands>).

The [Dockerfile](Dockerfile) builds with `node:20-alpine`, runs `npm ci`, and
serves `dist` through nginx on **port 80**. Its `NPM_REGISTRY` build argument
defaults to a corporate mirror; use an approved reachable registry in your
environment. The floating Node 20 image is not a pinned Node patch release.

`VITE_API_BASE_URL`, `VITE_DASHBOARD_API_URL`, and
`VITE_STUDENT_ASSIGNMENTS_ENABLED` are explicit image build arguments. The shared
command recipe passes those public values directly; the repository's dotenv
exclusions remain unchanged. Real secrets must never be included in any frontend
env file.

Changing environment variables only on the running nginx container does not
change compiled values. Rebuild after public configuration changes.
`nginx.conf` provides static files and SPA fallback only: unlike Vite dev mode,
it does **not** proxy `/auth` or `/api`. Production ingress must route relative
`/auth/*` to the main backend and enforce access independently. Use
browser-reachable API URLs and appropriate credentialed CORS.

When upgrading, review this app's manifest/lockfile together, use `npm ci`, run
type-check/build and relevant offline suites, and coordinate API payload changes
with the admin backend. Retain the prior bundle/image for rollback. Do not run
CSV imports, roster writes, research or quota edits as upgrade smoke tests.

This remains separate from the
[main frontend](<../../Agentic Shiksha Platform/Frontend/README.md>), which hosts
the student/teacher experience. Several components are adapted copies; fixes
do not propagate automatically between the two source trees.
