# Frontend source

[main.tsx](main.tsx) mounts React with the theme provider, notifications and
[router.tsx](router.tsx). The active app does not have an `App.tsx` or a
`TcaLacaBuilderApp.tsx` entry point.

| Area | Ownership |
| --- | --- |
| [pages](pages/README.md) | Route screens |
| [layouts](layouts/README.md) | Protected shell, navigation and shared create/edit context |
| [features](features/README.md) | Teaching chat, TA creation/editing and teacher analytics |
| [components](components/README.md) | Reusable UI and layout/auth/chat/artifact components |
| [lib](lib/README.md) | Stores, API clients, typed payloads and shared helpers |
| [hooks](hooks/README.md) | Cross-feature React hooks |
| [assets](assets/README.md) | Bundler-managed images/icons |
| [types](types/README.md) | Reserved ambient/shared declaration area |

[index.css](index.css) provides Tailwind and global visual behavior.

Keep feature-specific state close to its owner. Browser state and role-based
visibility are not authorization; protected API operations must validate callers
server-side. Treat model-generated content as untrusted at rendering/parsing
boundaries.

Install and run commands belong in the [frontend guide](../README.md) and
[installation guide](../../../INSTALL.md). Run builds and tests from the frontend
root, not this source directory.
