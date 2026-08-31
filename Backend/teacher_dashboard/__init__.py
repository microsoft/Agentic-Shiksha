"""
Teacher Dashboard API package.

Merged into the main Backend: teacher-scoped analytics over student learning
progress, served by the main app under ``/api/teacher-dashboard/*`` and
authenticated with the shared HttpOnly session cookie.

Import ``router`` from :mod:`teacher_dashboard.routes` and include it on the
main FastAPI app.
"""
