# src/pages

Top-level screens for the admin dashboard.

| Page | Purpose |
| --- | --- |
| [DashboardView.tsx](DashboardView.tsx) | Route-driven shell for Overview, Analytics, User Directory and Feedback; course filters, student progress, teacher/owner dialogs, CSV imports, research and logging-agent chat. |
| [OverviewPage.tsx](OverviewPage.tsx) | Embedded all-course overview, period usage, course/student token breakdowns and the shared image-quota editor. |

[App.tsx](../App.tsx) maps `/overview`, `/analytics`, `/user-directory` and
`/feedback` to `DashboardView`; `OverviewPage` is not a separately mounted route.
Both use [dashboardApi.ts](../lib/dashboardApi.ts). Directory/import operations
also use [userDirectory.ts](../lib/userDirectory.ts) and [api.ts](../lib/api.ts).
The logging-agent SSE request/abort loop currently lives inside `DashboardView`.

These are institution-wide views. The teacher-scoped equivalent, limited to a teacher's
own courses, is [the main dashboard feature](<../../../../Agentic Shiksha Platform/Frontend/src/features/dashboard/README.md>).

## Selection, permissions and edits

Analytics selections follow institution → department → course and use the
server's paired `courseAffiliations`. Parent changes clear dependent selections
and stale analytics instead of falling back to all courses.

The optional [student-assignment dialog](../components/StudentAssignmentsDialog.tsx)
uses main-API active-administrator permission checks, not the directory's
hard-coded admin flags. Directory grouping and CSV behavior are detailed in
[the admin workflows](../../../README.md#adding-users-with-a-courseta).
Displaying a secondary affiliation does not change the canonical profile or
membership. Imports, teacher/owner edits, research and quota changes are real
mutations when connected to live services, not harmless preview interactions.

The current directory sets `isAdmin` and `isSuperAdmin` to `true`; neither these
views nor browser-persisted roles provide a server access boundary. Read the
[frontend access caveats](../../README.md#configuration-and-routing).

## Usage and freshness

Current overview/period/student totals come from Cosmos-backed endpoints, not
the legacy Foundry totals endpoint. Persisted response events take precedence
over assistant-message fallback on a per-course basis. Missing student
attribution is shown as unavailable rather than invented as zero.

Backend summary caches last **30 seconds** per process. Authenticated frontend
GETs may reuse a response for **two seconds** within their user/role scope.
The separate legacy `/api/dashboard/overview/tokens` endpoint has a 600-second
Foundry cache; that interval does not describe the current overview UI.
See [the backend tests](../../../backend/tests/README.md) and
[frontend validation](../../README.md#validation) for attribution, failure,
selection-race and responsive-layout regressions.
