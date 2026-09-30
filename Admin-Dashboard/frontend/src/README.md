# src

Application source for the admin dashboard client.

| Path | Purpose |
| --- | --- |
| [App.tsx](App.tsx) | Routes `/overview`, `/analytics`, `/user-directory` and `/feedback` to `DashboardView`; other paths redirect to `/overview`. |
| [main.tsx](main.tsx) | Browser entry point; mounts `App`. |
| [index.css](index.css) | Tailwind layers and global styles. |
| [pages](pages/README.md) | Dashboard composition and all-course overview. |
| [features](features/README.md) | Analytics chat message rendering. |
| [components](components/README.md) | Chat shell, assignment editor, quota editor and UI primitives. |
| [lib](lib/README.md) | Two API boundaries, session/permission hooks, directory state, caching and helpers. |
| [hooks](hooks/README.md) | Reserved; current shared hooks are in `lib`. |

The `@` alias resolves to this directory. Pages currently own much of the
orchestration, including the logging-agent SSE client. The chat shell in
`components` composes message components from `features`, which in turn use the
shared Markdown renderer; there is no enforced one-way import layering rule.
Keep data/permission handling out of primitive UI components when extending this
structure.

Routes are not an authentication boundary. The app synchronizes session state,
but the legacy admin API and directory's cosmetic role flags are not protected
by that synchronization. See [routing and access limitations](../README.md#configuration-and-routing)
and [validation commands](../README.md#validation).
