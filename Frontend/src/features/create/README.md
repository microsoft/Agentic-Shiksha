# features/create

The creation flow for a new Teaching Assistant.

| Module | Purpose |
| --- | --- |
| [CreateView.tsx](CreateView.tsx) | Entry point for the flow; creates a single teaching assistant. |
| [SetupPhase.tsx](SetupPhase.tsx) | Setup step UI. |
| [CapabilityControls.tsx](CapabilityControls.tsx) | Shared capability switches and bulk controls for the creation form and review dialog. |
| [ReviewMaterialsDialog.tsx](ReviewMaterialsDialog.tsx) | Pre-creation file review and optional capability controls. |
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

The **Build Teaching Assistant** form includes a **Capabilities** section directly
below **Course Details**. Teachers can enable or disable documents, interactive
quizzes, flashcards, challenges, and image generation individually or with
**Enable all** / **Disable all**, before clicking **Create**. All are enabled by
default. Turning every optional capability off is supported; chat, course search,
memory, and learning progress are unchanged.

**Create** opens a confirmation dialog before uploads or creation start. It lists
selected course, textbook, and description files and includes the same capability
controls. The form and dialog share state: changes in either appear in the other.
**Confirm and create** submits the final selection to the backend.

Selections remain in the create-form context when returning to editing or navigating
away, are submitted as `capabilities` to `POST /api/agents/create-async`, and are
saved with the agent setup. Successful creation resets the next form to the defaults.
Editing an existing agent preserves these choices; these controls configure new agents,
not existing ones.
