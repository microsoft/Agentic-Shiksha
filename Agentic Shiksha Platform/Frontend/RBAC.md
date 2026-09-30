# EKALAIVA Shiksha — Role-Based Access Control (RBAC)

## Overview

This guide describes the **three-role frontend presentation matrix** in
[roles.ts](src/lib/roles.ts), not the complete server authorization model. The
browser's persisted `userStore` is not an authority for granting access.
Authenticated backend roles, course ownership and assignment checks determine
which operations are actually allowed.

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

Do not treat a browser-store role change as promotion or API access. Role
administration must use the authorized backend workflow; tests can mock roles
without changing real users.

---

## Default Role

New users are assigned the **student** role by default (`DEFAULT_ROLE` in `roles.ts`).

## Future Considerations

- **Backend enforcement**: This matrix is presentation only. Keep it aligned with
  authenticated route and ownership checks; hiding a control never replaces them.
- **Role assignment UI**: See the separate [Admin Dashboard](../../Admin-Dashboard/README.md).
- **Per-course roles**: A user could be a student in one course and a teacher in another.
- **Granular permissions**: Feature flags could become more fine-grained (e.g., `course:edit:own` vs `course:edit:any`).
