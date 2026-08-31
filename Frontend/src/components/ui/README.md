# components/ui

Primitive, unstyled-by-default building blocks. These know nothing about Agentic Shiksha
— no course, agent or student concepts — which is what makes them reusable.

Most are [shadcn/ui](https://ui.shadcn.com) primitives built on Radix, vendored into the
repository so they can be edited directly rather than upgraded as a dependency.

| Component | Notes |
| --- | --- |
| `button`, `input`, `textarea`, `label` | Form primitives |
| `card`, `badge`, `separator`, `scroll-area` | Layout and presentation |
| `dialog`, `alert-dialog`, `dropdown-menu`, `select` | Radix overlays |
| `tabs`, [segmented-tabs.tsx](segmented-tabs.tsx) | Tab navigation |
| `sonner` | Toast notifications |
| [CreateButton.tsx](CreateButton.tsx), [SendButton.tsx](SendButton.tsx) | Project-specific action buttons |

Variants are composed with `cn()` from [../../lib/utils.ts](../../lib/utils.ts).

Anything that reaches for application state or an API client is not a UI primitive —
it belongs in [../](..) or in a feature folder under [../../features/](../../features).
