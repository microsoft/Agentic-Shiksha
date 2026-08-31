# EKALAIVA Shiksha — Role-Based Access Control (RBAC)

## Overview

The application supports **three user roles**, each with a curated set of features. The role is stored in the user's persisted Zustand store (`userStore`) and can be changed at runtime (e.g. from an admin panel or settings page).

## Roles

| Role        | Description |
|-------------|-------------|
| **Student** | Default role for learners. Can chat, browse courses, use tools, and view assets. |
| **Teacher** | Course creators/instructors. Everything a student can do, plus create/edit courses and access the instructor dashboard. |
| **Admin**   | Full access. Everything a teacher can do, plus delete courses, manage users, and all analytics. |

---

## Feature Access Matrix

| Feature                  | Student | Teacher | Admin |
|--------------------------|:-------:|:-------:|:-----:|
| **Pages**                |         |         |       |
| Home (Chat)              |    ✅    |    ✅    |   ✅   |
| Library                  |    ✅    |    ✅    |   ✅   |
| Assets                   |    ✅    |    ✅    |   ✅   |
| Create Teaching Assistant |    ❌    |    ✅    |   ✅   |
| Edit Teaching Assistant   |    ❌    |    ✅    |   ✅   |
| Course Home              |    ✅    |    ✅    |   ✅   |
| Dashboard                |    ❌    |    ✅    |   ✅   |
| Settings                 |    ✅    |    ✅    |   ✅   |
| Help                     |    ✅    |    ✅    |   ✅   |
| Learn More               |    ✅    |    ✅    |   ✅   |
| **Chat Features**        |         |         |       |
| Send Messages            |    ✅    |    ✅    |   ✅   |
| Edit Messages            |    ✅    |    ✅    |   ✅   |
| Share Threads            |    ✅    |    ✅    |   ✅   |
| Web Search Tool          |    ✅    |    ✅    |   ✅   |
| Deep Research Tool       |    ✅    |    ✅    |   ✅   |
| Voice Input (STT)        |    ✅    |    ✅    |   ✅   |
| Attachments              |    ✅    |    ✅    |   ✅   |
| **Course Management**    |         |         |       |
| Create Courses           |    ❌    |    ✅    |   ✅   |
| Edit Courses             |    ❌    |    ✅    |   ✅   |
| Delete Courses           |    ❌    |    ❌    |   ✅   |
| View Syllabus            |    ✅    |    ✅    |   ✅   |
| **Dashboard & Analytics**|         |         |       |
| View Dashboard           |    ❌    |    ✅    |   ✅   |
| Student Progress         |    ❌    |    ✅    |   ✅   |
| Analytics & Groundedness |    ❌    |    ✅    |   ✅   |
| Dashboard Chat           |    ❌    |    ✅    |   ✅   |
| **User Management**      |         |         |       |
| Manage Users             |    ❌    |    ❌    |   ✅   |
| Submit Feedback          |    ✅    |    ✅    |   ✅   |
| Access Settings          |    ✅    |    ✅    |   ✅   |

---

## Architecture

### Files

| File | Purpose |
|------|---------|
| `src/lib/roles.ts` | Role types, permissions matrix, `hasAccess()` helper |
| `src/lib/userStore.ts` | Persisted Zustand store with `role` field and `setRole()` action |
| `src/hooks/useUserRole.ts` | React hook: `useUserRole()` → `{ role, can, isStudent, isTeacher, isAdmin }` |

### Usage Examples

#### Check a single permission
```tsx
import { useUserRole } from "@/hooks/useUserRole";

function SomeComponent() {
  const { can } = useUserRole();
  
  return (
    <>
      {can("page:dashboard") && <DashboardLink />}
      {can("course:create") && <CreateButton />}
    </>
  );
}
```

#### Gate an entire page (in router or layout)
```tsx
const { can } = useUserRole();
if (!can("page:dashboard")) return <Navigate to="/home" replace />;
```

#### Conditionally render sidebar items
```tsx
const { can } = useUserRole();

<nav>
  <Item label="Library" />
  {can("page:create") && <Item label="Create" />}
  {can("page:dashboard") && <Item label="Dashboard" />}
</nav>
```

#### Change role (e.g. from settings or admin panel)
```tsx
const { setRole } = useUserRole();
setRole("teacher"); // persisted automatically
```

---

## Default Role

New users are assigned the **student** role by default (`DEFAULT_ROLE` in `roles.ts`).

## Future Considerations

- **Backend enforcement**: Currently roles are client-side only. Backend API should validate roles via JWT claims or database lookup.
- **Role assignment UI**: Admin panel page for promoting/demoting users.
- **Per-course roles**: A user could be a student in one course and a teacher in another.
- **Granular permissions**: Feature flags could become more fine-grained (e.g., `course:edit:own` vs `course:edit:any`).
