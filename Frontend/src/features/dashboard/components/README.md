# features/dashboard/components

Presentational components local to the teacher dashboard.

| Component | Purpose |
| --- | --- |
| [UnifiedChatContainer.tsx](UnifiedChatContainer.tsx) | Chat shell, dashboard variant. |
| [Markdown.tsx](Markdown.tsx) | Markdown renderer. |

Both are trimmed copies of their counterparts in
[../../../components/](../../../components), kept separate so the dashboard can drop the
teaching-specific rendering paths it never uses.

The duplication is intentional but not free: a fix to markdown sanitisation or chat layout
in the shared components does **not** propagate here. Check both when changing either.
