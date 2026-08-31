# components/ui

Primitives for the admin dashboard, vendored from [shadcn/ui](https://ui.shadcn.com) and
built on Radix.

| Component | Purpose |
| --- | --- |
| [dialog.tsx](dialog.tsx) | Modal dialog. |
| [select.tsx](select.tsx) | Select menu. |

Only the primitives this app actually uses are vendored, rather than the full set in
[Frontend/src/components/ui/](../../../../../Frontend/src/components/ui). Copy one across
when it is needed instead of importing across app boundaries — the two frontends build
independently.

Variants compose with `cn()` from [../../lib/utils.ts](../../lib/utils.ts).
