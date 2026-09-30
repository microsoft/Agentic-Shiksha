# Admin Dashboard

Standalone institution-wide analytics and administration: all-course usage,
learning progress, the user directory, ownership/teacher changes, feedback,
image quotas, and institute/department research.

- [backend](backend/README.md) is a separate FastAPI service.
- [frontend](frontend/README.md) is its separate React + TypeScript + Vite client.
- The teacher-scoped dashboard is part of
  [the main application](<../Agentic Shiksha Platform/README.md>), not another
  service under this directory. There is no nested `admins` application.

| App | Backend | Frontend | API base |
|---|---|---|---|
| Admin Dashboard | `:8050` | `:5174` | `/api/dashboard`, `/api/directory`, `/api/user` |
| Teacher (merged) | `:8000` (main Backend) | `/dashboard` on `:5173` | `/api/teacher-dashboard` |

## Setup and access boundary

Start with the repository [installation guide](../INSTALL.md), then the
[backend setup](backend/README.md#setup) and
[frontend setup](frontend/README.md#setup). The backend container uses Python
3.11; keep its virtual environment separate from the main backend. Use Node
22.12+ for the frontend and its direct TypeScript test, and `npm ci` with the
admin frontend's own lockfile.

**This is not an authenticated administration boundary as currently implemented.**
The admin server's directory, profile and analytics handlers do not verify a
session or administrator role; the directory UI also sets its admin flags to
`true`. Sending cookies, setting a frontend role, or configuring CORS does not
add server authorization. Keep this service private behind an independently
enforced access boundary; do not expose it publicly or treat its directory as
pseudonymized. The main API's assignment checks described below are separate.

After preparing the backend environment and required configuration, start it
in one PowerShell terminal from the repository root:

```powershell
Set-Location '.\Admin-Dashboard\backend'
$env:EVAL_ENABLED = 'false'
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8050
```

In another terminal, also starting at the repository root:

```powershell
Set-Location '.\Admin-Dashboard\frontend'
npm ci
npm run dev
```

Opening the UI and using analytics is **Azure-connected work**, even though the
servers run locally. Directory edits, quotas, ownership changes, rosters,
research and evaluations can write shared state. Use
[isolated backend tests](backend/tests/README.md) and
[mocked frontend checks](frontend/README.md#validation) for offline validation.

## Azure command reference

Use the [shared build/deploy command recipe](../docs/deployment.md#azure-cli-container-and-app-service-commands)
with `admin-backend` or `admin-frontend`, selecting only the approved service.
The [resource-creation reference](<../Agentic Shiksha Platform/Backend/azure_services/README.md#azure-resource-creation-commands>)
owns common provisioning commands; they are not repeated across the dashboard
READMEs. The main backends/frontends remain separately selected deployment units.
New admin deployments require the private access boundary described above.

## Student access per TA (Admin)

The assignment controls are opt-in. Set the frontend build-time variable
`VITE_STUDENT_ASSIGNMENTS_ENABLED=true` only when the main API already supports
the assignment routes and credentialed CORS from the deployed admin origin.
The default is `false`: controls are hidden and no assignment permission/roster
requests are made. This allows an admin-only deployment without changing the
main backend. It does not change any saved memberships or student access policy.

Active admins and superadmins can open **User Directory → Assign Students**, choose
a course/TA, and edit its student roster. **Analytics → Assign Students**, next to
**Teachers**, opens the selected TA directly. The new controls verify the signed-in
user's active administrator role from the main Backend; the existing directory's
cosmetic admin flags and browser-persisted roles do not grant assignment permission.

The directory groups people by **College / Institution → Department → Course / TA
→ Teachers and Students** using saved teacher and student assignments. People in
multiple TAs appear under each matching course; institution and department counts
still count directory users once. People without a course assignment remain under
**Unassigned to a course**. Course groups refresh when the assignment editor closes.
If memberships cannot be loaded, the directory keeps users visible and offers a
retry without mislabeling them as unassigned. This grouping does not change rosters.

Users with multiple saved affiliations appear under every saved college/department
pair, not only their original or active affiliation. Importing an existing student
into another college therefore remains visible after reload. Directory and roster
filters include those saved affiliations; they never combine a college from one
affiliation with a department from another. Overall and college totals count each
user once, even across departments/courses. Rows retain the canonical user ID, role
and active profile for edits and assignment operations; display grouping does not
switch affiliations, change permissions or create another user.

- Each TA has its own saved roster. Reopening the editor loads the saved assignments.
- Search, institution, and department filters only change the visible candidates.
  Institution choices include the full user directory (all roles and affiliations),
  known institution/department entries, and affiliations from all courses, not just
  institutions represented by eligible students. An institution with no matching
  students shows an empty result without changing the saved roster.
  The directory and roster load together; a failed directory request shows an
  error and retry instead of presenting an incomplete list.
  **Select matching** / **Clear matching** explicitly edit matching students;
  selections outside the filters remain unchanged.
- Active and invited students are labeled. Invitations can be assigned before
  activation. Previously assigned unavailable entries remain visible and selected
  until explicitly removed. Remove all unavailable selections, including those
  hidden by filters, before saving. If a student becomes unavailable after loading,
  the server rejects the save; the draft remains available to correct or reload.
- Only assigned students have access. Department membership and shared links never
  enroll students. Saving an empty roster intentionally revokes all student access.
- A failed load cannot be saved. Failed saves preserve the draft for retry; a
  revision conflict requires **Reload saved roster** before further editing.
  Reloading discards the unsaved draft. Switching TAs or closing with unsaved changes
  asks whether to discard them.

Assignment requests use the **main Backend (`:8000`)**, not the analytics backend
(`:8050`): `GET /api/agents/{agent_id}/students` loads candidates, selected IDs, and a
revision; `PUT` on the same path sends `{student_ids, revision}`. Both send the
HttpOnly session cookie. Sign in through the main application with an active
administrator account first.

For local development, copy `frontend\.env.example` to `frontend\.env.local` if
overrides are needed. `VITE_API_BASE_URL` defaults to `http://localhost:8000` and
accepts a main-backend URL with or without a trailing `/api`.
`VITE_DASHBOARD_API_URL` continues to configure the separate analytics backend.
The main Backend must allow the admin UI origin (locally
`http://localhost:5174`) with credentialed CORS. Use the same hostname for sign-in
and API access; do not mix `localhost` and `127.0.0.1`.

These Vite settings are **build-time** settings. For deployment, supply the frontend
image's `VITE_API_BASE_URL` build argument with the browser-reachable main-backend
URL (for example, `https://api.example.com`) and explicitly opt in with
`VITE_STUDENT_ASSIGNMENTS_ENABLED=true`, then rebuild/redeploy the frontend.
Setting an environment variable only on the running nginx container does not
change the compiled app. Configure credentialed CORS and session cookies for the
deployed admin UI and main-backend origins.

Focused offline UI regression tests after frontend dependency/browser setup
(synthetic users and mocked APIs only; start at the repository root):

```powershell
Set-Location '.\Admin-Dashboard\frontend'
npm run test:student-assignments
npm run build
```

The assignment test script expects the enabled test configuration. See
[frontend validation](frontend/README.md#validation) for browser prerequisites,
type-checking and the explicit enabled/disabled feature-flag suites. A successful
mocked test does not verify live authorization, cookies or CORS.

## Adding users with a Course/TA

With course assignments enabled and an active administrator session, open
**Add New User -> Import from CSV**. This section has its own required
**College / Institution -> Department -> Teaching Assistant (TA)** dropdowns
directly above the upload area. Select them in that order to enable upload.
A `course-id` is the internal identifier of a teaching assistant; choosing a TA
in the dropdown supplies it without adding an ID column to the CSV.

The CSV selections are independent of the single-user form: its name, email,
role, institution, department and course fields do not configure the import.
Changing a CSV college clears its department and TA; changing the CSV department
clears its TA. Only matching TAs are offered, with an explicit empty state when
none match. The same CSV selections apply to every row. The template contains only:

```csv
name,email,role
Example Student,student@example.com,student
Example Teacher,teacher@example.com,teacher
```

The alternative header `user name,user email id,role` is also accepted. Roles are
`student`, `teacher` or `admin`. Student and teacher rows receive the selected
course assignment; admin rows are saved in the selected institution and department
without a course assignment. The single-user form's role does not override CSV
roles. Both forms are locked while a batch is running; failed rows retain the
CSV selections for retry. Closing the Add New User dialog clears both forms.

Older five/six-column files are now rejected explicitly: remove their institution,
department and course columns and choose those values in the CSV section. Import one
institution/department/course at a time. To add another course, select it and
re-import the relevant users; existing memberships are never replaced.

Course lists in Analytics, the single-user form and CSV import are filtered by the selected
institution/department **pair**. Changing a parent selection clears dependent
selections and stale analytics. Empty matches do not fall back to all courses.
The course-list API exposes `courseAffiliations`: explicit course affiliations
take precedence; legacy courses use saved creator/assigned-teacher affiliations,
resolved with bounded profile batches (including invited teachers). Courses with
no known affiliation are not offered under unrelated institutions.

A course remains optional when adding one user manually. Leaving it empty
preserves memberships and does not grant access to every course at an institution.

Assignments use the main backend's credentialed
`POST /api/agents/{agent_id}/members`, adding only the selected student or teacher
without replacing a roster. Student IDs are resolved against the authoritative
roster so invited and promoted users use the correct ID. The saved directory
role must match the requested assignment role.

Creation and assignment are separate operations. If creation succeeds but an
assignment cannot be confirmed, the form keeps the saved user and offers
**Retry assignment** without another invitation. CSV results report directory
additions, confirmed assignments, skipped rows and assignment failures separately.
Re-import failed rows to retry; existing users and memberships are retained.
Do not re-import merely because an existing user has a different primary college:
the additional affiliation and course membership are preserved and displayed.
When the assignment feature or active administrator access is unavailable, the
CSV dropdowns remain visible but disabled with an explanation. Manual user
creation without a course remains available.
Update the admin backend and frontend together for the affiliation metadata
and form-scoped CSV behavior. No main-application change is needed if its required
assignment APIs are already available; these UI changes do not migrate memberships.

## Teacher dashboard (merged into the main app)

The teacher dashboard is no longer a standalone app. It runs inside the main
Shiksha app:

- **Frontend:** [main dashboard feature](<../Agentic Shiksha Platform/Frontend/src/features/dashboard/README.md>),
  reachable at `/dashboard` on the main dev server (`:5173`).
- **Backend:** [teacher-dashboard package](<../Agentic Shiksha Platform/Backend/teacher_dashboard/README.md>),
  mounted on the main Backend (`:8000`) under `/api/teacher-dashboard`.
- **Auth:** the main application's HttpOnly session cookie and server-side
  teacher/admin checks, not the admin server's access model. Consult that
  package's README for its current endpoint and authorization contracts.

## Performance and Freshness

Course lists and learner overviews resolve profiles in parameterized batches of up to
100 IDs, rather than issuing a sequential read for every creator or learner. Invitation
records are queried only for missing creator IDs. Per-course activity queries restrict
messages to that course's thread IDs.

Completed course lists, progress/usage summaries, all-course summaries, and date-filtered
statistics are cached for 30 seconds per backend process. Concurrent identical reads share
one load. The cache is bounded to 128 entries, returns independent copies, and does not
cache failures. Ownership, teacher, directory, or affiliation edits invalidate the cached
views. Updates from other processes are reflected after TTL expiry.

Overview, period, and student usage statistics read persisted `token_usage_event` records
from each course's `__token_usage__:<agentId>` partition in `chat_messages_v1`. These
response-level facts do not require a browser-saved assistant message or a local thread ID.
They are the authoritative usage source for courses that have them; courses without event
records fall back to assistant-message metadata. The two sources are not added together
for the same course. Event reads are cached and partition-scoped; legacy message reads
use batches of 100 thread IDs and pages of 500. The current overview, period and
student views use these Cosmos summaries. The separate legacy
`/api/dashboard/overview/tokens` endpoint still calls Foundry and caches results
for 600 seconds; it is not the source of those views' totals.

Known admin/teacher usage is excluded. Events without `studentUserId` contribute to course
token and model-round totals, but not to active-student counts, student drill-downs, or
per-student averages. Averages use `attributedTokens`, `attributedRounds`, and
`attributedStudents`; missing attribution is shown as unavailable, not as zero. Legacy
rounds count assistant messages because response-level history is unavailable. Date ranges
use inclusive UTC calendar dates, and new-conversation counts still come from saved threads.
Failed period requests show an error with retry; failed student requests are distinct from
empty results.

Frontend GETs share pending requests and reuse successful responses for two seconds within
the current user/role scope. Responses are cleared after edits and account changes. Both
the admin backend and frontend must be rebuilt to receive these changes.

The cache, batching and attribution regressions are covered by the
[backend tests](backend/tests/README.md). Frontend cache and view regressions
are listed under [frontend validation](frontend/README.md#validation).

## Environment variables

The [backend configuration table](backend/README.md#configuration) distinguishes
import-time requirements from feature-specific settings. Its small
`.env.example` is not a complete runnable configuration. The
[frontend configuration](frontend/README.md#configuration-and-routing) describes
public build-time variables, the local `/auth` proxy and the additional routing
needed when serving the compiled app through nginx.

## Admin API entry points

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard/health` | Process health only; does not validate Azure access |
| `GET` | `/api/dashboard/agents` | Course metadata and affiliation pairs |
| `GET` | `/api/dashboard/agents/{agent_name}/overview` | Aggregate progress and the course's student summaries |
| `GET` | `/api/dashboard/agents/{agent_name}/students/{user_id}` | Detailed progress for a single student |
| `GET` | `/api/dashboard/overview/courses`, `/api/dashboard/overview/today` | Course totals and date-filtered usage |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/directory` and its child routes | Read and change users/affiliations; not guarded by session checks |
| `GET` | `/api/user/{user_id}` | Admin-side profile lookup |
| `POST` | `/api/dashboard/logging-agent/chat/stream` | Azure-connected analytics chat (SSE) |

The full route definitions are in [backend/main.py](backend/main.py); local
OpenAPI is served at `/api/dashboard/docs` and `/api/dashboard/openapi.json`.
There is no standalone `GET /api/dashboard/agents/{agent_name}/students`
handler; use the `students` returned by the course overview.
Research, evaluation, teacher/owner and quota operations are described in the
[backend safety notes](backend/README.md#connected-operations-and-safety).
