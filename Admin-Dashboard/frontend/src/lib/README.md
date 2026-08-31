# src/lib

API clients, authentication, types and helpers for the admin dashboard.

| Module | Purpose |
| --- | --- |
| [dashboardApi.ts](dashboardApi.ts) | Client for the Dashboard server on port 8050. |
| [api.ts](api.ts) | Shared fetch wrapper. |
| [chatApi.ts](chatApi.ts) | Analytics agent chat. |
| [useAuth.ts](useAuth.ts) | Session state. |
| [roles.ts](roles.ts) | Role constants and checks. |
| [userDirectory.ts](userDirectory.ts) | User directory access. |
| [userStore.ts](userStore.ts) | Client-side user state. |
| [nameGuard.ts](nameGuard.ts) | Guards display of user names. |
| [config.ts](config.ts) | Environment configuration. |
| [types.ts](types.ts) | Shared types. |
| [utils.ts](utils.ts) | `cn`, `getCourseName`. |

## Cross-origin requests

This client calls a **different origin** from the page that serves it, so requests must
set `credentials: "include"` for the session cookie to travel. A request missing that flag
arrives unauthenticated, and the server is expected to reject it — do not "fix" such a
failure by relaxing the check on the server.

## Names are privileged data

`nameGuard.ts` and `roles.ts` exist because the directory is pseudonymized by role: only
the super-admin sees real names and email addresses, while other roles see placeholder
identifiers with emails withheld. These modules control *display*; the server decides what
is actually returned. Rendering a name the API did not send is not possible, and bypassing
the guard for a name it did send defeats the pseudonymization.
