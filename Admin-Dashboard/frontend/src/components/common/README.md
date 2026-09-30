# components/common

Shared presentational components for the admin dashboard.

| Component | Purpose |
| --- | --- |
| [Markdown.tsx](Markdown.tsx) | Renders markdown returned by the analytics agent. |

`Markdown.tsx` renders untrusted model-generated content. Its pipeline supports
GFM, explicit LaTeX delimiters, code blocks with copy controls and source
citations. `rehypeRaw` parses embedded HTML, **then `rehypeSanitize` applies the
custom allowlist**, before KaTeX, heading slugs and syntax highlighting. Raw
parsing is not permission to render unsanitized HTML; preserve that ordering
and review schema/URL changes as safety-sensitive behavior.

Citation preprocessing can synthesize links and spans, which is why the
sanitization schema allows selected styling attributes. Neither citation
formatting nor display-name substitution is a guarantee that output contains
no personal information.

This is an independently maintained adaptation of the renderer in
[Frontend/src/components/common/Markdown.tsx](<../../../../../Agentic Shiksha Platform/Frontend/src/components/common/Markdown.tsx>).
A sanitization fix applied there does **not** reach this file; assess both
renderers when changing that contract. Use synthetic Markdown/citations when
validating and run the [frontend checks](../../../README.md#validation).
