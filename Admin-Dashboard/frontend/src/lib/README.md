# src/lib

API clients, session synchronization, state and helpers for the admin dashboard.
See [frontend configuration](../../README.md#configuration-and-routing) before
changing any API base URL: admin analytics and main-app assignments use different
services.

| Module | Purpose |
| --- | --- |
| [dashboardApi.ts](dashboardApi.ts) | `/api/dashboard` analytics, ownership, teachers, feedback and quotas on port 8050. |
| [dashboardRequestCache.ts](dashboardRequestCache.ts) | Two-second authenticated-scope GET reuse, shared pending requests, isolated result copies and invalidation. |
| [api.ts](api.ts) | Admin directory/affiliation and research request helpers; mutations invalidate cached views. |
| [chatApi.ts](chatApi.ts) | Admin-side **user profile** helpers used by auth synchronization; not the streaming chat client. |
| [studentAssignmentsApi.ts](studentAssignmentsApi.ts) | Main-backend permission checks, validated roster reads/writes and additive membership requests. |
| [useStudentAssignmentAccess.ts](useStudentAssignmentAccess.ts) | Opt-in permission loading/retry, aborted stale checks and fail-closed state for assignment controls. |
| [useAuth.ts](useAuth.ts) | Relative `/auth/*` session synchronization plus admin-side profile lookup. |
| [roles.ts](roles.ts) | Client-side feature flags; not server authorization. |
| [userDirectory.ts](userDirectory.ts) | Canonical directory records, affiliation/course grouping, CSV handling and assignment orchestration. |
| [userStore.ts](userStore.ts) | Persisted Zustand user/role state and cache clearing on role/account changes. |
| [nameGuard.ts](nameGuard.ts) | Replaces matching words from the current display name in outgoing chat text with `{{user_name}}`. |
| [secureId.ts](secureId.ts) | Random-token helper for local identifiers. |
| [config.ts](config.ts) | Public Vite settings and main API URL normalization. |
| [types.ts](types.ts) | Shared types. |
| [utils.ts](utils.ts) | `cn`, `getCourseName`. |

## API and auth boundaries

`DASHBOARD_API_URL` supplies the admin service origin; helpers append `/api` or
`/api/dashboard`. `API_BASE_URL` supplies the main API origin and strips a
trailing `/api`. `useAuth.ts` instead uses relative `/auth` URLs, handled by the
Vite dev proxy; a production static server needs separate routing.

Credentialed requests need both `credentials: "include"` and an appropriately
configured server/browser cookie boundary. The assignment client sends cookies,
checks the main session and active `admin`/`superadmin` profile, validates roster
payloads, and submits the saved `revision` with replacements. It does not trust
the directory's cosmetic administrator flags. Disabled assignment builds do
not start those permission/roster requests.

Do not assume every legacy analytics helper sends credentials or that sending
them secures a route. The current admin backend has no session/role checks on
directory, analytics or profile handlers. The UI's `useAuth` call is not a route
guard. `chatApi.ts` also retains a profile-update helper, but the admin server
implements only `GET /api/user/{id}`, not its `PUT` counterpart; do not rely on
that helper to provision a new account.

## Identity, privacy and caching

`userStore.ts` persists under `ekalaiva.user.v1`. Browser persistence and
`roles.ts` affect UI state, not permission to mutate data. Directory grouping
keeps the canonical user ID and every saved institute/department pair; grouping
under another affiliation must not switch the active profile or rewrite a
membership.

The directory returns real names and emails; it is **not pseudonymized by these
modules**. `nameGuard.ts` is a limited outgoing-text substitution, not a renderer,
directory filter or comprehensive anonymizer. Do not put personal data into
fixtures or claim this helper makes analytics output anonymous.

The request cache holds up to 64 completed results, keyed by user/role scope
and request path. Empty scopes bypass caching. It reuses successful results
for two seconds, never caches errors, returns cloned values, and prevents an
invalidated in-flight result from becoming a fresh cache entry.
Account/role changes and mutation helpers clear cached results. Roster responses
use their own no-store/abort/revision handling.

For changes here, run the
[Node cache test and relevant mocked browser suites](../../README.md#validation).
Do not replace mocked responses with live directory records.
