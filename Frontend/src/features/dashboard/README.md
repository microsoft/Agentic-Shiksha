# features/dashboard

Teacher-facing learning-progress analytics, embedded in the main app.

| Path | Purpose |
| --- | --- |
| [TeacherDashboardPage.tsx](TeacherDashboardPage.tsx) | The page: sidebar with course selector and section nav, header, and section content. |
| [lib/](lib) | API client, config and types. |
| [chat/](chat) | Stripped-down chat components for the analytics agent. |
| [components/](components) | Dashboard-local presentational components. |

Talks to [Backend/teacher_dashboard/](../../../../Backend/teacher_dashboard) at
`/api/teacher-dashboard`, in the same process and behind the same session cookie as the
rest of the app.

Every request is scoped server-side to the courses the authenticated teacher owns, so this
UI cannot widen its own access by asking for a different course id.

Distinct from [Admin-Dashboard/](../../../../Admin-Dashboard), which is a separate service
for institution-wide administration.
