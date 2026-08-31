# components/layout

Application chrome — the frame around a page's content.

| Component | Purpose |
| --- | --- |
| [Sidebar.tsx](Sidebar.tsx) | Primary navigation. |
| [PageHeader.tsx](PageHeader.tsx) | Page title and header actions. |
| [SettingsDialog.tsx](SettingsDialog.tsx) | User settings modal. |

Page composition — which chrome wraps which route — is decided in
[../../layouts/MainLayout.tsx](../../layouts/MainLayout.tsx). These components are the
pieces it arranges.

Navigation entries are filtered by role via
[../../hooks/useUserRole.ts](../../hooks/useUserRole.ts). Hiding a link is presentation
only; the backend still enforces access on every route it protects.
