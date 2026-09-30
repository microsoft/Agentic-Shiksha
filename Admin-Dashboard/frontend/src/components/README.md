# src/components

Components for the admin dashboard.

| Path | Purpose |
| --- | --- |
| [ImageQuotaCard.tsx](ImageQuotaCard.tsx) | Reads/edits the shared weekly image allowance and previews the server-supplied cost estimate. |
| [StudentAssignmentsDialog.tsx](StudentAssignmentsDialog.tsx) | Opt-in, per-TA roster editor using the main API, with filters, revision checks and unsaved-change protection. |
| [chat/](chat) | Chat shell for the analytics agent. |
| [common/](common) | Shared presentational components. |
| [layout/](layout) | Page chrome. |
| [ui/](ui) | Primitives. |

`ImageQuotaCard` is a configuration editor, **not** an individual student's
consumption report. It uses the admin API's `GET`/`PUT /api/dashboard/image-quota`
to change the allowance applied to each student/course. Enforcement is in the
[main backend's image quota module](<../../../../Agentic Shiksha Platform/Backend/azure_services/persistence/image_quota.py>).
Saving against a live backend affects shared state; the displayed cost is an
estimate, not a billing quote.

The roster editor keeps selected IDs and the server revision separate from
candidate filtering. Failed loads cannot be saved; revision conflicts require
reloading, and an explicitly empty saved roster revokes all student access to
that TA. The dialog and its callers use
[main-API permission checks](../lib/useStudentAssignmentAccess.ts), not the
legacy directory's cosmetic role flags. See
[assignment semantics](../../../README.md#student-access-per-ta-admin) and the
[mocked browser suites](../../README.md#validation).

Several components here are trimmed copies of their counterparts in
[Frontend/src/components/](<../../../../Agentic Shiksha Platform/Frontend/src/components>). The duplication is
deliberate — this app does not need the teaching-specific rendering paths — but it means a
fix in one tree does not reach the other.
