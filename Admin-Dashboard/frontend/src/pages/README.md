# src/pages

Top-level screens for the admin dashboard.

| Page | Purpose |
| --- | --- |
| [DashboardView.tsx](DashboardView.tsx) | Per-course learning progress. Left sidebar selects an agent and switches between Overview and Chat; the right pane shows the selected view. |
| [OverviewPage.tsx](OverviewPage.tsx) | All-courses analytics table: course, institute, department, professors, active and total users, total tokens, average tokens per student. |

Both read through [../lib/dashboardApi.ts](../lib/dashboardApi.ts).

These are institution-wide views. The teacher-scoped equivalent, limited to a teacher's
own courses, is [Frontend/src/features/dashboard/](../../../../Frontend/src/features/dashboard).

Token figures come from a server-side cache refreshed every 10 minutes, so a number that
looks stale immediately after activity is expected rather than a bug.
