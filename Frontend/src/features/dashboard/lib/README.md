# features/dashboard/lib

Data layer for the teacher dashboard.

| Module | Purpose |
| --- | --- |
| [dashboardApi.ts](dashboardApi.ts) | Client for `/api/teacher-dashboard` on the main backend. |
| [config.ts](config.ts) | Dashboard configuration, merged into the main app. |
| [types.ts](types.ts) | Response shapes. |

Every call is scoped to the authenticated teacher's own courses. That scoping is applied
**server-side** in
[Backend/teacher_dashboard/teacher_scope.py](../../../../../Backend/teacher_dashboard/teacher_scope.py);
this client cannot broaden it, and should not be given a code path that appears to.

Unlike the Admin Dashboard's client, this one targets the main backend rather than a
separate port, so it inherits the app's session cookie directly.
