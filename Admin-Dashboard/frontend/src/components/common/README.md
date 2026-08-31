# components/common

Shared presentational components for the admin dashboard.

| Component | Purpose |
| --- | --- |
| [Markdown.tsx](Markdown.tsx) | Renders markdown returned by the analytics agent. |

`Markdown.tsx` renders model-generated content, so its sanitisation configuration is a
security boundary rather than a styling choice — permitting raw HTML would turn agent
output into an XSS vector.

This is a copy of the renderer in
[Frontend/src/components/common/Markdown.tsx](../../../../../Frontend/src/components/common/Markdown.tsx).
A sanitisation fix applied there does **not** reach this file; change both.
