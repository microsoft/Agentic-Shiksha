# src

Application source for the admin dashboard client.

| Path | Purpose |
| --- | --- |
| [App.tsx](App.tsx) | Root component and routing. |
| [main.tsx](main.tsx) | Entry point; mounts `App`. |
| [index.css](index.css) | Tailwind layers and global styles. |
| [pages/](pages) | Top-level screens. |
| [features/](features) | Feature-scoped modules. |
| [components/](components) | Shared and primitive components. |
| [lib/](lib) | API clients, auth, types and helpers. |
| `hooks/` | Reserved for shared hooks; currently empty. |

Dependencies run one way: `pages` → `features` → `components` → `lib`. Keeping that
direction is what stops a UI primitive from acquiring a dependency on an API client.
