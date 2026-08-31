# src/layouts

Route-level page composition.

| Module | Purpose |
| --- | --- |
| [MainLayout.tsx](MainLayout.tsx) | Application shell. Exports `MainLayout`, `AppContextType`, `useAppContext` and `CreateFormState`. |

`MainLayout` arranges the chrome from
[../components/layout/](../components/layout) around the routed page, and hosts the app
context that `useAppContext` reads.

That context is shared mutable state for the whole tree, so adding to it is easy and
removing it is not — anything only two sibling components need is better passed as props
or held in the feature that owns it.
