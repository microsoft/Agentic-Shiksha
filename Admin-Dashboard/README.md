# Ekalaiva Dashboard

Learning-progress analytics, split by audience:

- **`admins/`** — standalone Instructor / Admin dashboard (all courses, user
  directory, ownership transfer, institute / department research). Has its own
  `backend/` (FastAPI) and `frontend/` (React + Vite).
- **Teacher dashboard** — **merged into the main app.** The teacher-scoped
  dashboard now lives inside the main `Frontend` (route `/dashboard`, served on
  `:5173`) and the main `Backend` (routes under `/api/teacher-dashboard`, served
  on `:8000`), using the same HttpOnly session-cookie auth. See
  `Backend/teacher_dashboard/` and `Frontend/src/features/dashboard/`.

| App | Backend | Frontend | API base |
|---|---|---|---|
| `admins/` | `:8050` | `:5174` | `/api/dashboard` |
| Teacher (merged) | `:8000` (main Backend) | `/dashboard` on `:5173` | `/api/teacher-dashboard` |

## Quick Start (Admin)

```bash
cd Admin-Dashboard/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8050

cd Admin-Dashboard/frontend
npm install && npm run dev    # → http://localhost:5174
```

## Teacher dashboard (merged into the main app)

The teacher dashboard is no longer a standalone app. It runs inside the main
Shiksha app:

- **Frontend:** `Frontend/src/features/dashboard/` — reachable at `/dashboard`
  on the main dev server (`:5173`) via the sidebar's **Teacher Dashboard**
  button (visible to teachers and admins).
- **Backend:** `Backend/teacher_dashboard/` — mounted on the main Backend
  (`:8000`) under `/api/teacher-dashboard`.
- **Auth:** the same HttpOnly `session` cookie as the rest of the app (shared
  `JWT_SECRET`); the teacher is derived from the token's `sub` and verified to
  have role `teacher` or `admin`. No separate login or bearer token.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `COSMOS_ENDPOINT` | `https://<account>.documents.azure.com:443/` | Cosmos DB endpoint |
| `COSMOS_DATABASE` | `ekalaiva` | Cosmos DB database name |
| `ALLOWED_ORIGINS` | `http://localhost:5173,...` | CORS origins (comma-separated) |

## Teacher API Endpoints (`/api/teacher-dashboard`, served by the main Backend)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/me` | Authenticated teacher profile |
| `GET` | `/summary` | Aggregate summary across the teacher's courses |
| `GET` | `/agents` | The teacher's courses |
| `GET` | `/agents/{agent_id}/overview` | Progress stats for one course (access-checked) |
| `GET` | `/agents/{agent_id}/students/{user_id}` | Single student's topic breakdown |
| `GET` | `/overview/courses` | Per-course analytics table (scoped) |
| `GET` | `/overview/tokens` | Per-course token stats (scoped) |
| `GET` | `/overview/tokens/per-student` | Per-student token usage (course or all) |
| `GET` | `/usage/analytics` | Token consumption trends (course or all owned courses) |
| `GET` | `/activity/analytics` | Threshold-crossing or asset-creation trends (course or all owned courses) |
| `GET` | `/feedback` | Feedback from the teacher's students |
| `GET` | `/evaluation/groundedness` | Groundedness across the teacher's courses |
| `GET` | `/evaluation/groundedness/agent/{agent_id}` | Groundedness for one course |
| `POST` | `/logging-agent/chat/stream` | Analytics chat (SSE), scoped context |

## Admin API Endpoints (`/api/dashboard`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard/health` | Health check |
| `GET` | `/api/dashboard/agents` | List all agents with student counts |
| `GET` | `/api/dashboard/agents/{agent_name}/overview` | Aggregate progress stats for an agent |
| `GET` | `/api/dashboard/agents/{agent_name}/students` | List all students with progress for an agent |
| `GET` | `/api/dashboard/agents/{agent_name}/students/{user_id}` | Detailed progress for a single student |
