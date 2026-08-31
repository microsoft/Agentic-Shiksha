# Admin-Dashboard/frontend

React + TypeScript + Vite client for the institution-wide admin dashboard. Talks to the
Admin Dashboard server on port 8050, not to the main backend.

```bash
npm install
npm run dev
npx tsc -p tsconfig.json --noEmit
```

| Path | Purpose |
| --- | --- |
| [src/](src) | Application source. |
| [index.html](index.html) | Vite entry document. |
| [Dockerfile](Dockerfile), [nginx.conf](nginx.conf) | Container build; nginx serves the built assets. |
| `*.config.cjs`, [vite.config.ts](vite.config.ts) | Tailwind, PostCSS and Vite configuration. |

Variables prefixed `VITE_` are inlined into the browser bundle at build time and are
therefore **public**. Never put a credential in one — including
`VITE_SUPER_ADMIN_EMAIL`, which is cosmetic only; the server enforces the actual
privilege.

This is a separate app from [Frontend/](../../Frontend), which contains the student and
teacher experience. Several components here are stripped copies of components there;
fixes do not propagate automatically between the two.
