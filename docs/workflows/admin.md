# Standalone admin API and UI workflows

Source audit: **2026-09-30, current packaged backend working tree**. This rebase
supersedes the earlier flat-module snapshot and its verification. It is not a live deployment,
data-quality, model-quality, or security-test report. The companion
[machine-readable map](admin.json) assigns every explicit admin handler to one
primary workflow and maps the actual router and nested UI action groups.

**Scope and discovery.** The standalone entry point is
[`Admin-Dashboard/backend/main.py`](../../Admin-Dashboard/backend/main.py)
(`main:app`), now a compatibility entry that calls
[`admin_backend.app.create_app`](../../Admin-Dashboard/backend/admin_backend/app.py),
not the main application's teacher dashboard. Discovery found that entry plus
45 package Python files: 38 non-initializer production implementation files in
total, six production package initializers, and an excluded scripts package
initializer/live-read utility. The factory mounts 11 router objects from
10 route-bearing modules; the agent-list router is separate to preserve the
original registration order around feedback. Tests and
[`scripts/check_coverage.py`](../../Admin-Dashboard/backend/admin_backend/scripts/check_coverage.py)
are outside the production handler inventory. All 29 frontend
TypeScript/TSX source files were considered: 15 `.ts` and 14 `.tsx`, including
the router, two page modules, dialogs, chat renderer, API clients and stores.
There are **43 explicit handler registrations (42 dispatchable plus the preserved
shadowed evaluation `/all` declaration)**, **20 workflows**, **35 UI action
groups**, and **5 router entries: four screens and one catch-all redirect**.
There is no development-only route, separate nested admin app, settings route,
or asset-library route.
Uncalled helpers and shared type names do not create additional UI capabilities.

**Reading the classifications.** `current` means wired source behavior, including
explicitly identified API-only operations; `compatibility` means retained legacy
behavior not used by the current screens; `optional` means an explicit capability
gate; `mixed` combines those cases. An empty `handlers` array is marked
`ui_only`: the standalone admin implementation owns only the browser operation,
even when it invokes a separately owned **main** API contract.

**Access boundary, verified rather than inferred.** None of the 43 admin
handlers has a session/role dependency. The new
[`Services` dependency](../../Admin-Dashboard/backend/admin_backend/dependencies.py)
retrieves `request.app.state.services`; it is dependency injection, not caller
authentication. App assembly adds CORS and domain-error mappings, not
authentication middleware or global authorization dependencies. Azure service
credentials authorize the process to storage/models, not the human caller.
`UserDirectorySection` sets `isAdmin` and `isSuperAdmin` to `true`.
`roles.ts`, `VITE_SUPER_ADMIN_EMAIL`, `useAuth`, cookies, and CORS do not enforce
admin API permissions. Names, email addresses, individual learning state,
feedback, research and evaluation content are not pseudonymized by this service.
An independently enforced deployment boundary is necessary but was **not
inspected or verified** here. Main-API permission checks in the optional editors
are browser prechecks; the main mutation routes' server-enforced dependencies
are a separate boundary, detailed in the roster workflow.

Existing orientation and contracts:
[admin guide](../../Admin-Dashboard/README.md),
[backend guide](../../Admin-Dashboard/backend/README.md),
[frontend guide](../../Admin-Dashboard/frontend/README.md),
[API/state helpers](../../Admin-Dashboard/frontend/src/lib/README.md),
[main assignment contract](<../../Agentic Shiksha Platform/Backend/backend/README.md#student-assignments>),
and [evaluation limitations](../evaluation.md). This audit closes the gap between
those topical guides and an exhaustive handler/screen/action ownership map;
it does not change the implementation or repair the limitations below.

**Source-to-source reconciliation.** HTTP methods, literal paths, handler
function names, registration order, UI routes and the documented permission
limitations are retained. Canonical handler IDs now point to the corresponding
`admin_backend/routers` module, never the entry-point alias or a service method.
Query/Foundry/Blob adapters moved into `integrations`; settings/cache/logging and
contracts moved into `core`; orchestration moved into injected `services`; body
models moved into `schemas`. Existing orientation documents still contain some
flat-layout descriptions/links; this audit's source links are current.

Actual changes found during reconciliation are narrower than a new API:
configuration no longer selects `APP_ENV`-specific dotenv profiles; research
and Blob integrations no longer try the optional monorepo credential helper;
research-response and attachment-download clients now use context managers;
evaluator caches belong to the injected service instance; and lifespan cleanup
now uses `finally`. Known validation errors from service classes are mapped to
the existing 400/404 response shapes by the factory. The new
[package manifest](../../Admin-Dashboard/backend/pyproject.toml) declares Python
`>=3.11,<3.14` and the evaluation SDK dependency; no installation/runtime
compatibility was exercised by this audit. These are source observations,
not changes made by the audit.

<a id="admin-runtime-health"></a>
## Service startup, health, and process lifetime

- **Classification / actors:** current; service operator and health/API client.
  `GET /api/dashboard/health` → `health` returns the fixed service/liveness
  object. Framework-generated GET/HEAD routes cover `/api/dashboard/docs`,
  `/api/dashboard/openapi.json`, `/docs/oauth2-redirect` and `/redoc`; these eight
  method entries are not additional source-decorated admin handlers.
- **Execution / permissions:** no agent/model is invoked by health. `lifespan`
  calls `validate_startup_settings`; `create_app` builds or accepts `AdminServices`
  on application state, and default adapters also resolve settings.
  Typed settings require the Cosmos, storage, research, chat and explicit CORS
  domains; evaluation settings are required at startup only when enabled.
  No caller-auth check is applied to health or the generated documentation.
- **State:** settings are process-cached. `bootstrap_environment` anchors optional
  dotenv loading to this backend's base `.env`; injected process variables take
  precedence. **`APP_ENV` profile selection has been removed** from current admin
  settings. `PYTHON_DOTENV_DISABLED` disables the base-file read. This audit read
  no dotenv contents. Cosmos and research Blob clients are
  lazy singletons; research/chat/evaluation also have their own client paths.
  `scrub` removes CR/LF, not personal data.
- **Success / failure / shutdown:** missing/invalid configuration can prevent
  startup; changing it requires restart because consumers retain snapshots.
  Health does not probe Azure identity, containers, model deployments or jobs.
  Lifespan uses `finally` to cancel and await the optional evaluator task on
  shutdown, including exceptional lifespan exits; it does not
  implement a general worker registry, durable queue, or comprehensive client
  shutdown. Research task lifetime is described below.
- **Sources:** [`create_app`, `build_services`, `lifespan`](../../Admin-Dashboard/backend/admin_backend/app.py),
  [`health`](../../Admin-Dashboard/backend/admin_backend/routers/health.py),
  [`AdminServices`](../../Admin-Dashboard/backend/admin_backend/services/container.py),
  [`validate_startup_settings`, `bootstrap_environment`](../../Admin-Dashboard/backend/admin_backend/core/settings.py),
  [`_init`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py),
  [`scrub`](../../Admin-Dashboard/backend/admin_backend/core/log_safe.py).

<a id="admin-navigation-session"></a>
## Browser navigation and session synchronization

- **Classification / actors:** mixed, standalone-admin UI-only; browser operator.
  `App` routes `/overview`, `/analytics`, `/user-directory`, and `/feedback` to
  the same `DashboardView`; `*`, including `/`, redirects to `/overview` with
  replacement. Sidebar navigation also replaces history. Expanding/collapsing
  the sidebar and showing an avatar are browser state only.
- **Triggers / services:** mounting the shell calls `useAuth`. Its relative
  `GET /auth/me` targets the **main** auth service through the development `/auth`
  proxy, while `chatApi.getUserProfile` calls the **admin**
  `GET /api/user/{user_id}` (owned by the directory-read workflow).
  `VITE_API_BASE_URL` does not configure the relative auth proxy.
  The included nginx configuration serves SPA files and does not add an auth
  proxy; deployed routing remains unverified.
- **Permissions / state:** the router is not guarded. The shell only consumes
  `user`, not the hook's authenticated/loading/error result to block screens.
  `BYPASS_AUTH` is currently `false`. Zustand persists identity and cosmetic role
  in `ekalaiva.user.v1`; temporary-user support uses `ekalaiva.temp.userId` but
  is not a login screen or a grant of API access. Login/logout/role-store actions
  clear the browser dashboard cache. Persisted registration can skip another
  sync, which is why optional editors separately verify a fresh main session.
- **Success / failure / compatibility:** successful sync labels the current user;
  missing sessions can clear the store, and backend/auth errors remain hook
  state rather than a route guard. The hook exports Microsoft/Google login,
  logout and retry functions, but the mounted shell provides no controls for
  them. Its retained auto-registration branch calls an admin
  `PUT /api/user/{user_id}` helper **with no mounted counterpart**. A normal
  profile 404 is treated as a backend error; this is not supported onboarding.
  There is no new auth agent, worker, or admin registration endpoint.
- **Sources:** [`App`](../../Admin-Dashboard/frontend/src/App.tsx),
  [`DashboardView`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx),
  [`useAuth`](../../Admin-Dashboard/frontend/src/lib/useAuth.ts),
  [`ChatApiService`](../../Admin-Dashboard/frontend/src/lib/chatApi.ts),
  [`useUserStore`](../../Admin-Dashboard/frontend/src/lib/userStore.ts),
  [`Vite proxy`](../../Admin-Dashboard/frontend/vite.config.ts),
  [`nginx SPA routing`](../../Admin-Dashboard/frontend/nginx.conf).

<a id="admin-overview-reporting"></a>
## All-course reporting, period filters, and usage drill-downs

- **Classification / actors:** current; dashboard operator and direct reporting
  client. Admin API coverage:

  | Trigger | Handler |
  | --- | --- |
  | `GET /api/dashboard/agents` | `list_agents` |
  | `GET /api/dashboard/overview/courses` | `courses_overview` |
  | `GET /api/dashboard/overview/today?start_date=…&end_date=…` | `today_overview` |
  | `GET /api/dashboard/overview/tokens/per-student?agent_id=…` | `token_usage_per_student` |

- **UI:** `/overview` loads the course table and Today's usage; Today, This Week
  (Sunday start), This Month, and Custom/Go change the period request.
  Column headings sort the browser snapshot. Total Tokens opens the searchable
  **Token Usage by Course** dialog (positive-token courses, share of the original
  total; search does not change its denominator). Average-token and
  average-round cells load separate student charts using the same per-student
  endpoint; the rounds chart sorts by rounds. Closing a dialog changes no data.
  The agent list also supplies analytics and editor choices.
- **Execution / state / permissions:** no agent/model. Cosmos reads
  `agents_v1`, `users_v1`, `invited_users_v1`, `chat_threads_v1`, and
  `chat_messages_v1`. Persisted `token_usage_event` records in
  `__token_usage__:{agent_id}` partitions take precedence **per course**, with
  assistant-message token metadata used only for courses without events.
  Explicit course institute/department pairs, not staff affiliations, determine
  `courseAffiliations`. No admin session/role filtering is performed.
- **Meaning of success:** aggregate rounds/tokens are usage, not mastery.
  Attributed averages divide attributed tokens/rounds by attributed students;
  missing attribution is `Unavailable`, not fabricated zero. Overview
  `activeUsers` is based on thread/event association, whereas the analytics
  activity endpoint requires a user message. Total users uses top-level
  institute/department and deduplicated email, not the saved per-TA roster or
  every affiliation; overall active counts sum course counts and can repeat a
  learner. Several filters exclude exactly `admin`/`teacher`, not a general role
  hierarchy. The overview labels Graph Memory courses as legacy-progress
  unavailable and directs users to the authorized main teacher view.
- **Freshness / failure / retry:** selected aggregate helpers have a 30-second,
  128-entry process cache, shared pending loads and a 60-second waiter timeout.
  Failed loads are not cached. Authenticated browser GETs use a separate
  two-second, 64-result user/role/path cache and reject changed-account responses;
  anonymous scopes bypass that browser cache. Agent metadata lists are read
  fresh server-side. Period failures clear the cards to unavailable and expose
  Retry. Course-table failures show an error; student-chart failures show an
  error and can be retried by reopening. There is no scheduled UI refresh.
  Date strings are compared inclusively by date prefix; the API has no typed
  date/range-order validation. Many admin 500 responses retain `str(e)`.
- **Sources:** [`OverviewContent`](../../Admin-Dashboard/frontend/src/pages/OverviewPage.tsx),
  [`dashboardApi`](../../Admin-Dashboard/frontend/src/lib/dashboardApi.ts),
  [`overview routes`](../../Admin-Dashboard/backend/admin_backend/routers/overview.py),
  [`courses_overview`, `today_stats`, `per_student_token_usage`, `list_agents`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py),
  [`cached_view`](../../Admin-Dashboard/backend/admin_backend/core/dashboard_cache.py),
  [`cachedDashboardRequest`](../../Admin-Dashboard/frontend/src/lib/dashboardRequestCache.ts).

<a id="admin-legacy-foundry-tokens"></a>
## Compatibility Foundry response totals

- **Classification / actors / trigger:** compatibility, API-only; reporting
  client calls `GET /api/dashboard/overview/tokens` → `token_usage_overview`.
  `getTokenUsageOverview` remains exported, but `OverviewContent` does not call it.
- **Execution / permissions / state:** `token_stats.get_token_stats`, not an
  analytics agent, directly reads stored Foundry `/openai/responses` using
  `AZURE_AI_PROJECT_ENDPOINT` and process credentials. It aggregates input/output/
  total tokens, response rounds and conversations by `agent_reference`, accepting
  historical `agent` fields. There is no caller or student-role scope.
  Results have a separate 600-second process cache.
- **Success / limits / retry:** pagination stops at 50 pages of 100 responses.
  Page errors stop the scan and can produce cached partial totals. Setup/fetch
  failure returns the previous cache or `{}`; it is not proof of zero use.
  A later read after expiry is the retry path; no UI refresh control or billing
  reconciliation exists here. It must not be substituted for the current
  Cosmos-backed overview contract.
- **Sources:** [`token_usage_overview`](../../Admin-Dashboard/backend/admin_backend/routers/overview.py),
  [`get_token_stats`, `_fetch_all_responses`](../../Admin-Dashboard/backend/admin_backend/integrations/token_stats.py).

<a id="admin-course-analytics"></a>
## Course selection, legacy progress, and student topic details

- **Classification / actors:** mixed: current analytics UI with compatibility
  learning-state metrics; operator or API client.
  `GET /api/dashboard/agents/{agent_name}/overview` → `agent_overview`;
  `GET /api/dashboard/agents/{agent_name}/students/{user_id}` → `student_detail`.
  Despite the path parameter's name, the UI passes the selected agent ID.
- **UI / state:** `/analytics` requires institution → department → course.
  `filterDashboardAgents` matches the same normalized explicit affiliation pair;
  it does not take the Cartesian product of affiliations. Changing a parent
  filter clears selected course, student detail, errors and chat-pane visibility.
  Request-generation checks discard stale course responses. The selected course
  shows activity cards, completion distribution, struggle topics and expandable
  student rows with learned/in-progress/not-started topic summaries.
- **Execution / permissions:** no model. Cosmos legacy state is read from
  `learning_states_v1`; course usage reads threads, user messages and profiles.
  The summary's struggle heuristic (in-progress without summary) is not the
  chat tool's keyword-based heuristic. None of these admin reads checks the
  caller's role, course membership, or student ownership.
- **Success / failure / retry:** no-state and no-activity results are valid empty
  views; a missing individual state returns 404 (storage read failures can also
  collapse to missing). API/selection failures show the shared error banner;
  reselect/reopen retries. Graph Memory `shadow`/`authoritative` prevents these
  helpers from reading legacy progress: overview returns unavailable/null metrics
  and detail returns availability metadata. The analytics renderer does not
  fully represent that availability contract, unlike the all-course badge.
  Empty/null legacy results must not be interpreted as no learning or graph
  mastery. Topic-detail requests are protected against course changes, not
  every same-course row-selection race.
- **Sources:** [`DashboardView`, `StudentRow`, `TopicColumn`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx),
  [`filterDashboardAgents`](../../Admin-Dashboard/frontend/src/lib/dashboardApi.ts),
  [`progress routes`](../../Admin-Dashboard/backend/admin_backend/routers/progress.py),
  [`agent_overview`, `agent_usage_stats`, `student_detail`, `_legacy_progress_availability`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py).

<a id="admin-image-quota"></a>
## Shared image allowance settings

- **Classification / actors / triggers:** current; operator edits the
  `/overview` Image generation quota card, or an API client calls
  `GET /api/dashboard/image-quota` → `get_image_quota` and
  `PUT /api/dashboard/image-quota` → `update_image_quota`.
- **Execution / permissions / state:** no image model is called.
  `ImageQuotaUpdate` accepts optional `medium`/`low` integers 0–1000; at least
  one is required. The helper merges supplied values into
  `learning_states_v1`, document `__image_quota_config__`, partition
  `__config__`, with `updatedAt`. Defaults are medium 5 and low 15; reads
  silently use defaults on missing/unreadable configuration. No server
  administrator check or revision precondition protects this shared write.
- **Success:** all students' per-course weekly allowance changes; actual
  consumption/resets/enforcement belong to the
  [main image quota module](<../../Agentic Shiksha Platform/Backend/azure_services/persistence/image_quota.py>).
  The browser previews server-supplied per-image cost constants and 4.3-week
  monthly estimates; this is not live pricing or a billing quote.
- **Failure / retry / cancel:** load/save errors appear inline; a failed load can
  leave the loading label alongside the error. Failed saves retain the draft;
  Save can be retried. Reset restores the last loaded limits locally, not a
  server reset. Validation errors return 400/422; storage errors may return 500.
  There is no optimistic concurrency, distributed cache invalidation, scheduled
  quota reset worker in admin, or automatic mutation retry.
- **Sources:** [`ImageQuotaCard`](../../Admin-Dashboard/frontend/src/components/ImageQuotaCard.tsx),
  [`ImageQuotaUpdate`](../../Admin-Dashboard/backend/admin_backend/schemas/quota.py),
  [`update_image_quota`](../../Admin-Dashboard/backend/admin_backend/routers/quota.py),
  [`quota_payload`](../../Admin-Dashboard/backend/admin_backend/services/quota.py),
  [`get_image_quota_config`, `set_image_quota_config`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py).

<a id="admin-user-directory"></a>
## Directory reads, affiliation-aware grouping, and profile lookup

- **Classification / actors / API:** current; directory operator, shell profile
  reader or API client. `GET /api/directory?role=…&status=…` →
  `api_list_directory`; `GET /api/user/{user_id}` → `api_get_user_profile`.
  The latter is an **admin** profile endpoint, not the same-path main contract.
- **UI / state:** `/user-directory` loads canonical users; role, institution,
  department, search and expandable institute/department/course/role branches
  filter the browser snapshot. Saved affiliations repeat a person under every
  complete saved pair, retaining canonical identity, active affiliation and role.
  Overall/institute counts deduplicate user IDs. Profiles without any complete
  institute/department pair are omitted by `groupByInstituteDept`, even though
  the API may return them.
- **Optional course grouping:** only when the main-API assignment permission
  check succeeds, up to four browser loaders concurrently request each TA's
  admin teacher list and **main** student roster. The tree includes only TAs
  explicitly placed in the local institute/department pair. Confirmed unmatched
  users are “Unassigned to a course”; failed/unavailable membership loads keep
  people visible under “Course assignments unavailable,” not falsely unassigned.
  Closing the roster editor or saving placement refreshes this membership
  snapshot; no roster is changed by grouping.
- **Execution / permissions / results:** `list_directory_users` reads invited
  C1 and active/profile C2 stores, excludes promoted invites and prefers C2 for
  duplicate email when status is not specified. List failures are swallowed per
  store, so HTTP success can be partial/empty. Profile reads only C2 and returns
  404 when absent/unreadable. No session or role is verified; returned names,
  email, roles, statuses and affiliations are personal/org data.
- **Failure / retry:** frontend list errors display a directory error (remount/
  reload retries); optional course-load errors have an explicit Retry course
  assignments button. Abort controllers discard stale membership loads on
  account/course changes. In-memory `USER_DIRECTORY` is not a server authority,
  and a successful list does not prove both stores were healthy.
- **Sources:** [`UserDirectorySection`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx),
  [`loadDirectory`, `directoryAffiliations`, `groupByInstituteDept`, `groupByCourse`](../../Admin-Dashboard/frontend/src/lib/userDirectory.ts),
  [`api_list_directory`, `api_get_user_profile`](../../Admin-Dashboard/backend/admin_backend/routers/directory.py),
  [`DirectoryService`](../../Admin-Dashboard/backend/admin_backend/services/directory.py),
  [`list_directory_users`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py).

<a id="admin-user-invitations-import"></a>
## Invitations, CSV imports, and optional additive course assignment

- **Classification / actors / primary API:** mixed; directory operator.
  **Add New User** or each imported user calls admin `POST /api/directory` →
  `api_invite_user`. This is an allowlist write, not an email-delivery worker.
- **Current single-user path:** email, institution and department are required
  by the UI; name and Student/Teacher/Admin role are entered locally.
  `invite_user` normalizes email, checks an existing invite before an active
  profile, adds a nonduplicate institute/department affiliation without changing
  the active role/pair, or creates a C1 `dir-…` invitation. It returns 201 for a
  new user and 200 with `affiliationAdded`/`alreadyExists` otherwise. The backend
  models use strings rather than enforcing the UI's role/email/required-pair
  rules, and do not authorize the caller. There is no cross-store transaction
  or concurrent-invite uniqueness guarantee.
- **CSV / browser assets:** View Template previews/downloads a browser-created
  `.csv` Blob/object URL, then revokes the URL. User CSV accepts only
  `name,email,role` (also the two documented legacy header labels), optional
  header, quoted commas and escaped quotes, one record per line. Extra columns,
  missing email, invalid role, unterminated quoting and empty files are reported.
  Dedicated CSV College/Department fields apply to all rows; TA is optional and
  independent of the single-user form. Rows run sequentially with added,
  skipped, assigned, directory-only, assignment-failed and per-row errors.
  Institution/department CSV modes are local registries, described separately.
- **Main cross-service step:** TA choices and **user CSV import itself** require
  `VITE_STUDENT_ASSIGNMENTS_ENABLED === "true"` plus a freshly verified active
  main `admin`/`superadmin`; this applies even to CSV imports with no TA.
  A single directory-only invite remains available without that flag.
  For student/teacher assignment, `assignUserToCourse` verifies permission
  again, requires the saved role to match, and uses main
  `POST /api/agents/{agent_id}/members` with
  `{user_id, member_type}`. Students are uniquely matched by canonical ID or
  email against main `GET /api/agents/{agent_id}/students`; admins are saved
  directory-only. Additive assignment is not a full-roster replacement.
  See the [main membership router](<../../Agentic Shiksha Platform/Backend/backend/routers/agent_membership.py>)
  and [main contract](<../../Agentic Shiksha Platform/Backend/backend/README.md#student-assignments>):
  student additions require admin; teacher membership uses course-manager
  access server-side, although this admin UI gates both more narrowly.
- **Success / failure / retry / cancel:** saving the directory and assigning a
  course are separate writes; a failed membership call does not undo the user.
  The single-user dialog retains `savedUser` and offers Retry assignment without
  another invitation. CSV continues after row failure; re-import the failed row
  explicitly. No automatic mutation retry or batch rollback exists. Inputs/
  closing are blocked during a user/import mutation; afterwards Cancel/Close
  discards browser form state, not already saved users. Saved membership and
  access do not derive from department placement.
- **Sources:** [`handleAddUser`, `handleCsvImport`, `downloadCsvTemplate`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx),
  [`addUser`, `assignUserToCourse`](../../Admin-Dashboard/frontend/src/lib/userDirectory.ts),
  [`addCourseMember`](../../Admin-Dashboard/frontend/src/lib/studentAssignmentsApi.ts),
  [`DirectoryService.invite_user`](../../Admin-Dashboard/backend/admin_backend/services/directory.py),
  [`invite_user`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py).

<a id="admin-user-role-profile-management"></a>
## Editing profiles and roles, and removing directory entries

- **Classification / actors / triggers:** current; directory operator or client.
  Row Edit/Save calls `PATCH /api/directory/{user_id}` →
  `api_update_directory_user`; confirmed Remove calls
  `DELETE /api/directory/{user_id}` → `api_remove_directory_user`.
- **Execution / state:** no agent. Edit locates C2 first, then C1, updates names,
  role and top-level institution/department, and synchronizes the selected
  existing affiliation entry. Active-user edits use `upsert_user_profile`;
  invited-user edits use the adapter's `save_directory_record` to upsert C1.
  Browser `updateUser` retains saved
  secondary affiliations when the response omits them.
  Removal attempts both C2 and same-ID C1, not chats, research, course
  memberships or a complete identity cascade.
- **Permissions:** `canEdit`/`canRemove` are cosmetic because both admin flags
  are `true`. Configured super-admin email blocks a Remove control only;
  there is no corresponding server guard, role enum/transition policy or
  requester identity check. UI labels do not make these writes safe.
- **Success / failure / retry / conflicts:** successful edits/removals update
  the local directory; failures stay in the dialog with inline error and can be
  manually retried. Cancel closes the draft/confirmation without a new write.
  Missing targets return 404. Removal helpers swallow individual storage
  failures and report success if either deletion succeeded, so partial cleanup
  is possible. No ETag/concurrency protection or undo is implemented. Decorated
  helpers invalidate process summary caches, but `save_directory_record` does not
  itself invalidate them, so C1 edits still do not use that
  helper; other processes and external main writes are not coordinated.
- **Sources:** [`handleEditSave`, `handleRemoveConfirm`, `canEdit`, `canRemove`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx),
  [`api_update_directory_user`, `api_remove_directory_user`](../../Admin-Dashboard/backend/admin_backend/routers/directory.py),
  [`DirectoryService`](../../Admin-Dashboard/backend/admin_backend/services/directory.py),
  [`upsert_user_profile`, `remove_directory_user`, `save_directory_record`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py).

<a id="admin-affiliation-switch"></a>
## API-only active-affiliation switching

- **Classification / actors / trigger:** current, API-only; client calls
  `POST /api/directory/{user_id}/switch-affiliation` with `{index}` →
  `api_switch_affiliation`. `switchUserAffiliation` is exported but no mounted
  screen invokes it; viewing a secondary-affiliation directory row does not
  switch anything.
- **Execution / permissions / state:** `switch_active_affiliation` loads a C2
  profile, validates an existing index and writes `activeAffiliation`,
  `institute`, `college`, `department`, affiliation role and timestamp, then
  invalidates local summary caches. It does not authorize the caller or check
  that the requested role transition is permitted; C1 invites are not supported.
- **Success / failure / retry:** returns the selected profile context.
  Missing profile or bad index returns 400; storage errors propagate.
  Repeating an explicit request is a caller decision; there is no version check,
  undo or automatic retry. This changes active profile role, not per-TA
  membership arrays.
- **Sources:** [`api_switch_affiliation`](../../Admin-Dashboard/backend/admin_backend/routers/directory.py),
  [`switch_active_affiliation`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py),
  [`switchUserAffiliation`](../../Admin-Dashboard/frontend/src/lib/api.ts).

<a id="admin-organization-directory"></a>
## Institution and department registries, maintenance, and onboarding counts

- **Classification / actors:** mixed; directory operator and API-only count
  consumer. API coverage:

  | Trigger | Handler |
  | --- | --- |
  | `POST /api/directory/institutes/rename` `{old_name,new_name}` | `api_rename_institute` |
  | `POST /api/directory/institutes/delete` `{name}` | `api_delete_institute` |
  | `POST /api/directory/departments/rename` `{institute,old_name,new_name}` | `api_rename_department` |
  | `POST /api/directory/departments/delete` `{institute,department}` | `api_delete_department` |
  | `GET /api/directory/onboarding-progress?institute=…&department=…` | `api_onboarding_progress` |

- **Local creation/import:** Add Institution/Add Department and their CSV uploads
  only mutate `_extraInstitutes`/`_extraDepartments` in browser memory. They
  populate choices but do not create an org document or survive page reload by
  themselves. Templates are `name` or `institute,department`; preview/download
  uses browser Blob URLs. Empty new groups without user records need not appear
  in the tree.
- **Shared maintenance / permissions:** rename/delete confirmations call the
  admin API without server auth. Helpers query **top-level** institute/department
  matches in C1/C2 and individually upsert affected users. Institution deletion
  clears institute and department (and C2 college); department deletion clears
  department, not people. They do **not** rewrite saved affiliation arrays,
  course placement, memberships or research blob keys. Therefore secondary/old
  affiliation branches can remain after a rename/delete. These actions are not
  an atomic organizational migration.
- **Success / failure / retry:** returns updated/cleared record counts; no match
  is zero, not an error. Required blank request fields return 400. Partial
  writes can precede an exception; no ETag, rollback, merge-conflict UI or
  automatic retry. UI failures log to console and leave the dialog rather than
  reliably presenting a visible error; cancel closes locally. The uncalled
  onboarding-count endpoint compares invited nonpromoted C1 with active C2
  top-level pairs; storage errors become zero counts and `done:false`.
- **Sources:** [`UserDirectorySection`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx),
  [`addInstitute`, `addDepartment`, `renameInstitute`, `deleteDepartment`](../../Admin-Dashboard/frontend/src/lib/userDirectory.ts),
  [`directory routes`](../../Admin-Dashboard/backend/admin_backend/routers/directory.py),
  [`rename_institute`, `delete_institute`, `rename_department`, `delete_department_users`, `get_department_onboarding_progress`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py).

<a id="admin-course-ownership-teachers"></a>
## Course ownership transfer and teacher-list replacement

- **Classification / actors / API:** current; operator with a selected analytics
  course, or direct client. Transfer calls
  `POST /api/dashboard/agents/{agent_id}/transfer-ownership`
  `{new_owner_id}` → `transfer_ownership`. Teachers loads
  `GET /api/dashboard/agents/{agent_id}/teachers` → `get_agent_teachers`;
  Save calls `POST` on that path with `{teacher_ids}` → `set_agent_teachers`.
- **Execution / state:** no model. Targets are resolved against C2 profiles or
  C1 invites. Cosmos `agents_v1.createdById` changes on transfer; the new owner
  is added to `teacherIds`, while the former owner is not automatically removed.
  Teacher replacement normalizes/deduplicates IDs and always retains the owner.
  `updatedAt` and server process caches change; successful browser mutations
  clear the browser dashboard cache.
- **Permissions:** the UI offers teacher/admin directory rows and disables the
  owner checkbox; the handlers only check record existence/list shape, **not**
  caller identity, administrator status, target teacher role or active status.
  These are admin-service full-document upserts, distinct from the main
  authenticated additive membership route used by imports.
- **Success / failure / retry / cancel:** missing payload/targets produce
  400/404. Loading failure alerts and closes the teacher dialog; write failures
  alert and leave a retryable draft. Cancel performs no new write. No revision
  conflict/merge protection or automatic retry exists. Mounted analytics state
  is not comprehensively refetched after success; cache clearing is not a
  guaranteed immediate redraw or cross-service cache invalidation. Picker
  candidates come from in-memory `USER_DIRECTORY`; these dialogs do not load
  that directory independently, so entering Analytics before Directory can
  leave the candidate picker empty even when saved teachers exist.
- **Sources:** [`openTeachersDialog`, `DashboardView`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx),
  [`transferAgentOwnership`, `setAgentTeachers`](../../Admin-Dashboard/frontend/src/lib/dashboardApi.ts),
  [`ownership and teacher routes`](../../Admin-Dashboard/backend/admin_backend/routers/agents.py),
  [`AgentService`](../../Admin-Dashboard/backend/admin_backend/services/agents.py),
  [`transfer_agent_ownership`, `set_agent_teachers`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py).

<a id="admin-student-roster"></a>
## Opt-in main-API student roster editor

- **Classification / actors:** optional, standalone-admin UI-only; an active
  administrator/superadministrator verified by the **main** API.
  Directory → Assign Students selects any TA; Analytics → Assign Students
  starts with the selected course. Exact gate:
  `VITE_STUDENT_ASSIGNMENTS_ENABLED === "true"` and successful
  `getStudentAssignmentPermission` (`GET /auth/me`, then
  `GET /api/user/{session.id}` on `API_BASE_URL`, cookies and `no-store`).
  Disabled builds do not issue these permission/roster calls; permission failure
  is fail-closed with Retry permissions, separate from cosmetic directory roles.
- **Probe versus authorization:** main
  [`create_identity_router`'s `auth_me`](<../../Agentic Shiksha Platform/Backend/backend/routers/identity.py>)
  and [`get_user`](<../../Agentic Shiksha Platform/Backend/backend/main.py>)
  have different contracts. `auth_me` delegates to
  [`IdentityService.session_profile`](<../../Agentic Shiksha Platform/Backend/backend/services/identity.py>),
  verifying a cookie-preferred JWT (Bearer
  fallback) and returns identity claims, without reloading active status or
  checking admin role. The legacy main `get_user` has no caller check and returns
  the supplied path-ID profile or `success:true, profile:null`. The browser
  combines the token identity with that profile and checks active/admin status;
  neither probe endpoint independently authorizes the roster, placement or
  membership mutation. Their main route dependencies enforce the actual
  active-user/role rules. This distinction also applies to import and directory
  course-grouping prechecks.
- **Contract:** main `GET /api/agents/{agent_id}/students` supplies candidates,
  selected IDs and revision; main `PUT` replaces only that TA's
  `{student_ids,revision}`. These handlers belong to the
  [main membership router](<../../Agentic Shiksha Platform/Backend/backend/routers/agent_membership.py>),
  not this admin inventory. The dialog loads admin `GET /api/directory` in
  parallel to enrich saved affiliations; both loads must succeed before editing.
- **Browser / shared state:** search/institution/department filter candidates
  without mutating selections outside the filter. Choices include the whole
  directory, all affiliations, local org choices and course placements.
  Select matching/Clear matching explicitly edit only visible matches.
  Active and invited students are eligible; already selected unavailable entries
  remain visible, cannot be saved, and must be explicitly removed, including
  those hidden by filters. Saving an empty roster intentionally revokes student
  access; affiliation, placement and share/join links do not enroll anyone.
- **Success / failures / retry / cancellation:** validated responses replace
  local selected IDs/revision and show saved status; main writes enforce
  active-admin access and ETag-based concurrency. Main 401/403, 404, 422, 409 and
  sanitized 503 are distinct from success. A failed load cannot be saved.
  Ordinary failed saves retain the draft and allow retry; 409 locks editing
  until Reload saved roster. Reload immediately discards unsaved selections.
  Switching TAs/closing a dirty dialog prompts Keep editing/Discard; closing is
  blocked during save, and pending reads abort on unmount. No backend cancel
  endpoint exists for a write already sent. Revocation affects new main requests,
  not deletion of prior conversations or interruption of an existing response.
- **Sources:** [`StudentAssignmentsDialog`, `StudentRosterEditor`](../../Admin-Dashboard/frontend/src/components/StudentAssignmentsDialog.tsx),
  [`useStudentAssignmentAccess`](../../Admin-Dashboard/frontend/src/lib/useStudentAssignmentAccess.ts),
  [`getStudentRoster`, `saveStudentRoster`, `getStudentAssignmentPermission`](../../Admin-Dashboard/frontend/src/lib/studentAssignmentsApi.ts);
  [existing roster guide](../../Admin-Dashboard/README.md#student-access-per-ta-admin).

<a id="admin-course-placement"></a>
## Opt-in main-API course placement editor

- **Classification / actors:** optional, standalone-admin UI-only; the same
  flag/fresh-main-admin check as the roster editor, not an unguarded admin API
  mutation. Directory or selected Analytics → **Assign TA to department** opens
  all TAs, including unassigned/out-of-scope ones.
- **Contract / execution:** main `GET /api/agents/{agent_id}/placement` loads a
  complete pair or unassigned state with revision. Main `PUT` accepts
  `{institute,department,revision}`; both fields must be supplied or empty.
  [Main `course_placement.py`](<../../Agentic Shiksha Platform/Backend/backend/routers/course_placement.py>)
  uses active `AdminUser` and an ETag-conditioned patch of `agents_v1` institute,
  department and legacy `departmentId` (cleared). It never replaces teacher or
  student memberships. These main handlers are not counted as admin handlers.
- **Browser state / success:** directory and course affiliation suggestions
  supplement free-text exact names. Saving/clearing placement updates local
  `courseAffiliations`, dependent course choices and directory grouping, and
  clears the browser dashboard cache. Parent analytics selection can reset when
  the TA no longer matches its previous filters.
- **Failure / retry / cancel:** stale GETs are aborted/epoch-checked. Failed
  directory suggestions do not block typing exact names. Incomplete saved
  responses, main 401/403/404/422/503, or save-response mismatch show errors.
  409 requires Reload saved assignment for a fresh revision; unlike the roster
  editor this dialog has no dedicated conflict lock, so retrying the unchanged
  revision can conflict again. Reload discards the draft; switching/closing dirty
  forms prompts discard, and controls prevent closing while saving. No automatic
  write retry or server rollback is implemented.
- **Sources:** [`CoursePlacementDialog`](../../Admin-Dashboard/frontend/src/components/CoursePlacementDialog.tsx),
  [`getCoursePlacement`, `saveCoursePlacement`](../../Admin-Dashboard/frontend/src/lib/studentAssignmentsApi.ts),
  [main request schema](<../../Agentic Shiksha Platform/Backend/backend/schemas/course_placement.py>);
  [existing placement guide](../../Admin-Dashboard/frontend/README.md#assigning-a-ta-to-a-department).

<a id="admin-analytics-chat"></a>
## Analytics chat, local tools, and message artifacts

- **Classification / actors / triggers:** current; dashboard operator.
  Analytics requires all three filters to enable **Ask Agent**. Suggestions
  populate the input; Send/Enter calls
  `POST /api/dashboard/logging-agent/chat/stream` → `logging_agent_chat_stream`;
  explicit `OPTIONS` on the same path → `logging_agent_chat_options`.
  Payload is `{text,conversation_id}`; `thread_id` is accepted as a compatibility
  input alias. The UI does **not** send its selected course/filter as an enforced
  data scope.
- **Actual agent/model/tools:** the adapter references the configured
  **`LOGGING_AGENT_NAME`** in `AZURE_AI_PROJECT_ENDPOINT` using Foundry
  conversations/responses and `agent_reference`. The remote definition decides
  model, instructions and advertised tools; their deployed values are unknown.
  Local dispatch is exactly `list_agents`, `list_all_students`,
  `get_student_progress`, `get_agent_overview`, plus formatting tool
  `add_message`. The four analytics handlers read Cosmos; there is no local
  teaching, research, quota, roster or asset-generation tool attached here.
  An unknown function receives an acknowledgement string, not a real execution.
- **Permissions / state:** no route or conversation-ownership check. Name guard
  substitutes words from the current display name only; tool results, other
  people and stored records are not thereby anonymized. New chats create remote
  conversation state and paid responses. Browser messages/conversation ID are
  component memory, not a saved admin chat-history store; reload loses them.
  Cached SDK clients live in the process. Chat tools share legacy helpers;
  unfiltered `list_all_students` specifically queries legacy learning-state
  records in `users_v1`, unlike the per-course `learning_states_v1` path.
  Empty tool results therefore do not prove there is no learner data.
- **Streaming / artifacts:** SSE includes IDs, deltas, message-block start/delta/
  final, done/error. Tool outputs feed subsequent response rounds; a later
  message-only round ends the chain, with no general iteration cap in code.
  Plain-text fallback is packaged as a message block. The browser appends both
  incremental and final blocks rather than reconciling them, so streamed
  `add_message` content can repeat. Messages use sanitized Markdown, math,
  tables, copy-message/copy-code, HTTP(S) links, heading scroll and lazy images.
  Images/links can load directly in the browser; there is no admin asset
  persistence or authenticated course-file download path here.
- **Failure / retry / stop:** empty text is 400; SSE exceptions expose “Internal
  error,” while tool errors can be returned to the model. Malformed event JSON
  is skipped. Stop aborts the browser fetch, preserving partial messages; it
  does not call a remote cancellation API. Close hides the pane, not a worker
  cancellation. There is no wired regeneration/edit action, automatic replay,
  or new-conversation reset control. Good/Bad response and More options buttons
  have no persistence/action handlers; they are not feedback submission.
- **Sources:** [`useLoggingChat`, `handleChatSend`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx),
  [`SSE routes`](../../Admin-Dashboard/backend/admin_backend/routers/chat.py),
  [`chat_stream`](../../Admin-Dashboard/backend/admin_backend/integrations/logging_agent_chat.py),
  [`TOOL_HANDLERS`](../../Admin-Dashboard/backend/admin_backend/integrations/logging_agent_tools.py),
  [`UnifiedChatContainer`](../../Admin-Dashboard/frontend/src/components/chat/UnifiedChatContainer.tsx),
  [`ChatBubble`](../../Admin-Dashboard/frontend/src/features/chat/ChatBubble.tsx),
  [`Markdown`, `CodeBlock`](../../Admin-Dashboard/frontend/src/components/common/Markdown.tsx).

<a id="admin-institute-department-research"></a>
## Institute and department research jobs and result inspection

- **Classification / actors:** current; directory operator, API client and
  in-process background worker. Primary coverage:

  | Trigger | Handler |
  | --- | --- |
  | `POST /api/dashboard/directory/research/bulk-status` `{items}` | `api_bulk_research_status` |
  | `POST /api/dashboard/directory/institutes/research` `{name,instructions?}` | `api_trigger_institute_research` |
  | `GET /api/dashboard/directory/institutes/research?name=…` | `api_get_institute_research` |
  | `DELETE /api/dashboard/directory/institutes/research?name=…` | `api_cancel_institute_research` |
  | `POST /api/dashboard/directory/departments/research` `{institute,department,instructions?}` | `api_trigger_department_research` |
  | `GET /api/dashboard/directory/departments/research?institute=…&department=…` | `api_get_department_research` |
  | `DELETE /api/dashboard/directory/departments/research?institute=…&department=…` | `api_cancel_department_research` |

- **UI / actual agent:** directory load issues one bulk-status call; Research/
  Retry opens optional instructions, then confirmation starts the job.
  `ResearchService.run_institute` and `ResearchService.run_department` invoke
  the configured **`INSTITUTE_RESEARCH_AGENT_NAME`** in **`PROJECT_ENDPOINT`**,
  not `LOGGING_AGENT_NAME`. Both use inline structured-profile prompts, a new
  remote conversation and response. Their `research_response` integration now
  context-manages `DefaultAzureCredential` and `AIProjectClient`, rather than
  trying the optional monorepo credential helper. No model deployment or external search
  tool implementation is selected in this local code; the remote agent's
  research capabilities and quality are unverified.
- **Permissions / storage lifecycle:** no caller auth. FastAPI `BackgroundTasks`
  schedules work inside the service process, not a durable scheduler.
  The worker writes `researching`, then parsed `completed` profile/timing or
  `failed`. `parse_research_json` strips fences/trailing commas and may repair
  malformed JSON, requiring a nonempty object, not a full profile schema.
  Process credentials may create `institute-research-v2` and overwrite
  `institutes/{sanitized_name}.json` or
  `departments/{sanitized_institute}/{sanitized_department}.json`.
  Names are lowercased and nonalphanumeric/nonhyphen/nonunderscore characters
  become `_`; distinct names can share a key.
- **Success / viewing:** per-key browser polling runs every 15 seconds and
  normally stops on completed/failed; intervals are cleared on unmount.
  View opens a structured, collapsible profile viewer. Re-Research starts
  another request; the viewer's shortcut does not reuse prior instructions.
  Blob helpers cache successful reads/writes in process with no TTL, so
  multi-process/external updates can be stale.
- **Failure / retry / cancellation / conflicts:** blanks are 400; a saved
  researching marker returns `already_researching`, not a new queued job.
  This check and marker write are not atomic; parallel triggers can race.
  Cancellation writes a `cancelled` marker and stops that browser poll; it does
  **not** stop the Foundry call or running worker, which may overwrite it later.
  Polling ignores errors and does not generally stop on a cancelled marker
  written by another client. Reads mask Blob errors as `not_started`; save
  helpers return `False` but callers do not enforce it, so a trigger/cancel
  acknowledgement does not prove persistence. Restart can strand `researching`
  with no resumable job; retry/research is manual, not durable recovery.
  JSON parse failure can retain raw response excerpts; general failure stores
  “Research failed.” The viewer shortcut has no explicit rejection handler.
  Storage delete/list helpers are not extra mounted research-delete APIs.
- **Sources:** [`research handlers`](../../Admin-Dashboard/backend/admin_backend/routers/research.py),
  [`ResearchService`](../../Admin-Dashboard/backend/admin_backend/services/research.py),
  [`research_response`](../../Admin-Dashboard/backend/admin_backend/integrations/research_agent.py),
  [`parse_research_json`](../../Admin-Dashboard/backend/admin_backend/services/research_json.py),
  [`research storage helpers`](../../Admin-Dashboard/backend/admin_backend/integrations/research_storage.py),
  [`pollResearchStatus`, `ResearchDataRenderer`, `RenderValue`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx).

<a id="admin-feedback-assets"></a>
## Feedback review and attachment delivery

- **Classification / actors / triggers:** current; feedback reviewer/API client.
  `/feedback` loads `GET /api/dashboard/feedback?limit=500` → `get_feedback`
  (API default 200, validation 1–1000), then locally filters category/sentiment.
  Attachment selection calls
  `GET /api/dashboard/blob/proxy?url=…` → `proxy_blob`.
- **Execution / permissions / state:** no agent, sentiment inference or new
  feedback write; `list_feedback` and `get_feedback_stats` read `feedback_v1`
  directly using process Cosmos credentials. They return text, names/emails,
  image/file URLs and stored sentiment/category. No session, owner, or
  administrator checks are applied. `max_item_count=limit` controls query page
  size while iteration exhausts pages, so it is not a guaranteed returned-record
  cap. Statistics perform another feedback read.
- **Attachment contract / success:** proxy validates HTTPS and exact configured
  storage hostname, restricts container names to the
  `feedback-attachments` prefix, and rejects `..` path segments. It reads the
  configured account directly with `DefaultAzureCredential`, buffering the
  whole blob, then streams stored content type/length with public one-day cache
  headers. `AttachmentService.resolve` now performs validation and the separate
  `download_attachment` integration context-manages the credential/blob client;
  invalid-operation mapping still returns 400. These path restrictions are not
  caller authorization.
  The attachment list opens images or PDFs in an overlay (`img`/`iframe`);
  other extensions open the proxy in a new tab for viewing/downloading.
  Closing the list/viewer is browser state only.
- **Failure / retry:** list request errors show an error page; remount/reload is
  the retry, not an in-page feedback retry button. Cosmos list errors can instead
  be swallowed into empty results and empty stats. Bad URL/path is 400, Blob
  failures are 500 with exception detail; the viewer has no explicit load-error
  recovery or cancellation API. No admin upload, attachment-delete, general
  storage browser, or separate asset-library workflow is mounted.
- **Sources:** [`FeedbackSection`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx),
  [`get_feedback`, `proxy_blob`](../../Admin-Dashboard/backend/admin_backend/routers/feedback.py),
  [`AttachmentService`](../../Admin-Dashboard/backend/admin_backend/services/attachments.py),
  [`download_attachment`](../../Admin-Dashboard/backend/admin_backend/integrations/attachments.py),
  [`list_feedback`, `get_feedback_stats`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py).

<a id="admin-evaluation-on-demand"></a>
## API-only on-demand groundedness and RAG judging

- **Classification / actors:** current, API-only; evaluation client. No active
  admin screen invokes these calls.

  | Trigger | Handler |
  | --- | --- |
  | `POST /api/dashboard/evaluation/groundedness` | `evaluate_groundedness_endpoint` |
  | `POST /api/dashboard/evaluation/groundedness/batch` | `evaluate_groundedness_batch` |
  | `POST /api/dashboard/evaluation/rag` | `evaluate_rag_endpoint` |

- **Input / actual execution:** single groundedness takes query, response,
  optional context/session UUID and method (`auto`, `sdk`, `llm` convention;
  other strings fall through to auto). Batch uses `{items,method}`. Combined RAG
  takes query/response/context/session UUID. Helpers retrieve semantic Search
  context from `AZURE_AI_SEARCH_ENDPOINT`/`COMMON_INDEX_NAME` when needed, then
  invoke SDK `GroundednessEvaluator` or direct Foundry responses with configured
  **`AZURE_EVAL_MODEL`**, not a named research/logging agent.
  `auto` falls back from any SDK failure to LLM; combined RAG always runs the
  faithfulness, answer-relevancy and context-precision LLM judges.
- **Permissions / state / success:** no caller auth; method calls require valid
  evaluation configuration on module import even with `EVAL_ENABLED=false`.
  On-demand routes return model-judge values and reasons but do not store an
  evaluation, alter learning progress or update graph state. Process/model/Search
  operations incur usage. Prompts truncate context to 6000 and response to 3000
  characters; scales are intended 1–5, not strictly range-validated outputs.
- **Failure / retry / cancel:** missing context yields an error/null score inside
  a successful single groundedness envelope, while `/rag` returns 400.
  Batch rejects no items with 400, handles rows sequentially and retains per-row
  `ok:false` errors; average includes only non-null scores. Combined metric
  failures produce null scores/reasons and average remaining metrics, not an
  unconditional pass. Other exceptions can surface as 500/detail. There is no
  request idempotency, automatic transient retry, batch job/status record or
  cancel endpoint; clients explicitly choose whether to submit another judge
  request. The SDK is now declared in the runtime package manifest, but installed
  availability and deployed model/Search behavior were not tested.
- **Sources:** [`evaluation routes`](../../Admin-Dashboard/backend/admin_backend/routers/evaluation.py),
  [`EvaluationService.batch`](../../Admin-Dashboard/backend/admin_backend/services/evaluation.py),
  [`evaluate_groundedness`, `evaluate_rag_metrics`, `_retrieve_context_with_chunks`](../../Admin-Dashboard/backend/admin_backend/integrations/groundedness_evaluator.py);
  [evaluation guide](../evaluation.md).

<a id="admin-evaluation-results"></a>
## Stored evaluation reads and the dormant quality panel

- **Classification / actors:** mixed: current API-only reads and retained
  compatibility UI; evaluation client/operator. Coverage:

  | Trigger | Handler |
  | --- | --- |
  | `GET /api/dashboard/evaluation/groundedness/{message_group_id}?session_id=…` | `get_groundedness_result` |
  | `GET /api/dashboard/evaluation/groundedness/session/{session_id}` | `get_session_groundedness` |
  | `GET /api/dashboard/evaluation/groundedness/thread/{thread_id}?session_id=…` | `get_thread_groundedness` |
  | `GET /api/dashboard/evaluation/groundedness/all?limit=…` | `get_all_groundedness` |

- **Execution / permissions / success:** no model; process credentials read
  `groundedness_evaluations_v1` by document/session partition, thread+session,
  or cross-partition limit (default 200, 1–1000). Lists calculate averages and
  `/all` additionally defines score buckets. Stored query, response, reasons,
  context/retrieved material and user/session references are sensitive content,
  not just aggregate numbers. No route-level caller/scope authorization exists.
- **Routing caveat:** the generic single-segment `{message_group_id}` GET is
  registered **before** the literal `/all` GET. Under normal Starlette matching,
  `/all` selects the earlier handler (and without `session_id`, fails validation),
  rather than `get_all_groundedness`. The latter still counts as a decorated
  handler in this source inventory. This was verified from declaration order,
  not by importing or starting the app.
- **UI / failure / retry:** Analytics renders `GroundednessSection`, but
  `fetchGroundedness` is an intentional no-op and its data setters are unused.
  Refresh therefore makes no request; the “No groundedness evaluations yet”
  text is **not evidence of an empty database**. The retained expanded
  query/response/reason/claim rows and Show all/less branch are not populated by
  the current app. `getAllGroundednessEvaluations` is an unused client helper.
  Single reads return 404 if missing/unreadable; list storage errors can return
  `[]`, masking outages. A direct caller can retry; there is no current UI
  regeneration, storage mutation or evaluation deletion operation.
- **Sources:** [`get_groundedness_result`, `get_all_groundedness`](../../Admin-Dashboard/backend/admin_backend/routers/evaluation.py),
  [`EvaluationService`, `summarize`](../../Admin-Dashboard/backend/admin_backend/services/evaluation.py),
  [`get_groundedness_evaluation`, `get_groundedness_evaluations_for_session`, `get_groundedness_evaluations_for_thread`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py),
  [`fetchGroundedness`, `GroundednessSection`](../../Admin-Dashboard/frontend/src/pages/DashboardView.tsx).

<a id="admin-evaluation-scheduler"></a>
## Manual stored evaluations and the optional scheduled evaluator

- **Classification / actors / triggers:** mixed; API evaluation operator and
  optional process worker. `POST /api/dashboard/evaluation/groundedness/trigger`
  → `trigger_groundedness_evaluation` requires
  `{messageGroupId,sessionId,threadId,userId}` and accepts `method`.
  Independently, startup schedules `EvaluationService.run_periodic` only when
  **`EVAL_ENABLED=true`** (default false). Defaults: interval 5 seconds,
  lookback 24 hours, batch limit 50. There is no admin UI enable/disable control.
- **Actual worker / model / state:** after sleeping, the asyncio loop uses
  `asyncio.to_thread` for blocking Cosmos/evaluation work, fetches up to twice
  the batch limit of recent assistant records, excludes already evaluated
  message-group IDs, deduplicates and limits the batch. It resolves thread/course/
  material-session through `_threads`/`_agent_sessions` caches on the injected
  `EvaluationService` instance; `evaluate_recent` owns one scan cycle.
  `evaluate_and_store_groundedness`
  reads user/assistant text, re-retrieves Search chunks, runs all three LLM
  judges with `AZURE_EVAL_MODEL`, and upserts `groundedness_evaluations_v1`
  (`id=messageGroupId`, partition `sessionId`). The stored path accepts `method`
  but does not use it to select SDK evaluation.
- **Permissions / success:** no caller authorization on the manual endpoint;
  scheduled work uses service credentials across users/courses. The stored
  record includes query, truncated response/context, retrieved documents,
  per-metric reasons/claims, overall and timestamp. It is response-quality
  metadata, not a mastery write. Re-retrieved context can differ from what the
  original student turn saw. Missing session/context uses a placeholder rather
  than refusing every evaluation; no-session work does not perform an unfiltered
  Search query.
- **Failure / retry / shutdown:** missing manual fields are 400. The handler
  creates a 422 for an uncompleted result inside a broad `except`, which catches
  it and emits 500 instead. Null metric results may still be stored and then
  treated as already evaluated by later scans. Per-message failures are logged;
  unevaluated records can reappear next cycle, and unexpected outer-loop errors
  back off 30 seconds. Thread-resolution exceptions that escape the adapter are
  now logged rather than silently ignored; helper read errors can still return
  empty/None.
  There is no distributed lock, durable job record, resume ledger, strict
  exactly-once guarantee or automatic rejudge of existing IDs; multiple service
  processes can perform duplicate work. Manual submission can overwrite an
  existing evaluation. Shutdown cancels/awaits the coroutine; cancellation
  does not guarantee that a thread already executing a remote call is stopped.
- **Sources:** [`lifespan`](../../Admin-Dashboard/backend/admin_backend/app.py),
  [`trigger_groundedness_evaluation`](../../Admin-Dashboard/backend/admin_backend/routers/evaluation.py),
  [`EvaluationService.run_periodic`, `EvaluationService.evaluate_recent`](../../Admin-Dashboard/backend/admin_backend/services/evaluation.py),
  [`evaluate_and_store_groundedness`](../../Admin-Dashboard/backend/admin_backend/integrations/groundedness_evaluator.py),
  [`save_groundedness_evaluation`](../../Admin-Dashboard/backend/admin_backend/integrations/cosmos_queries.py),
  [`RuntimeSettings`, `EvaluationSettings`](../../Admin-Dashboard/backend/admin_backend/core/settings.py).

**Coverage verification and unresolved boundaries.** Verification statically
re-extracts all production route decorators and their exact functions, the five
`App.tsx` route paths, unique workflow/action IDs, required nonempty arrays,
primary-handler uniqueness, source symbols, local links and explicit anchors.
The rebased read-only filesystem check passed **43/43 primary handlers across
10 route-bearing modules and 11 router mounts, 5/5 UI router entries, 20 workflow
anchors, 35 unique action groups, 58 UI API hand-offs, 146 source-symbol references
and 116 Markdown links**. There were no missing/duplicate mappings, obsolete flat
handler IDs, invented admin API targets or broken local links. A repeated
fingerprint of the admin entry/package and all 29 frontend source files remained
unchanged across the final checks. A separate frontend
network/clipboard/download/polling call-site pass checked action-group scope,
including unmounted compatibility helpers.
No backend imports, server starts, cloud reads/writes, record inspection,
dependency installs, commits or deployment checks were performed. The 43
decorated handlers have no exclusions; the moved live-read coverage script, test modules and
framework-generated routes are not extra handler functions in this inventory.

Unknowns remain external: actual deployed auth/network isolation, credentials
and RBAC, data completeness, runtime response order/cancellation timing,
remote named-agent definitions/models/tools, model/Search availability,
cross-origin production cookie/proxy behavior, and multi-process consistency.
Source-visible limitations are documented above, notably unguarded admin
mutations/reads, shadowed evaluation `/all`, dormant evaluation UI, unmounted
profile PUT helper, research cancellation versus real worker lifetime,
nontransactional directory/import maintenance, and the distinction between
main-authorized roster/placement writes and admin teacher/owner upserts.
