# features/create

The creation flow for a new Teaching Assistant.

| Module | Purpose |
| --- | --- |
| [CreateView.tsx](CreateView.tsx) | Entry point for the flow; creates a single teaching assistant. |
| [SetupPhase.tsx](SetupPhase.tsx) | Setup step UI. |
| [useSetupPhaseLogic.ts](useSetupPhaseLogic.ts) | State machine and side effects for the setup step. |
| [builderTypes.ts](builderTypes.ts) | Types shared across the flow. |
| [sharedUI.tsx](sharedUI.tsx) | Presentational pieces used by more than one step. |
| [designSystem.ts](designSystem.ts) | Tokens local to the creation flow. |
| [markdownUtils.ts](markdownUtils.ts) | Markdown helpers for curriculum text. |

Creation is where course material is uploaded and indexed, so it is the highest-leverage
step in the product: retrieval quality is bounded by what gets ingested here, and a gap in
the material becomes a gap in the teaching.

Editing an existing agent is a separate flow in [../edit/](../edit).

Because instructions and tool schemas are baked into a Foundry agent version at creation,
what this flow submits is what the agent will keep — later prompt changes do not
retroactively apply.
