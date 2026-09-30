# Frontend features

Domain-specific UI and behavior, composed by [routes](../router.tsx) and
[pages](../pages/README.md).

| Feature | Entry points and responsibilities |
| --- | --- |
| [agents](agents/README.md) | Agent list-row presentation |
| [chat](chat/README.md) | `useAgentChat`, message blocks, quizzes, slides and simulations |
| [create](create/README.md) | `CreateView`, `SetupPhase`, durable materials/creation and Course Companion |
| [edit](edit/README.md) | `EditView`, existing-TA configuration and explicit Update |
| [dashboard](dashboard/README.md) | Embedded teacher dashboard and its analytics chat/API layer |
| [memory](memory/README.md) | Opt-in Graph Memory evidence views, cohort inspection and versioned curriculum-graph authoring |
| [projects](projects/README.md) | Conversation thread lists |

Creation configures one course TA. Old `ChoosePhase`/`BuilderPhase` and separate
Learning/Exam-agent instructions do not describe the current route flow.
The create and edit features share form controls and conflict-aware companion
patching, but must not share material sessions or implicitly save assistant changes.

Use [components](../components/README.md) for reusable UI, and
[lib](../lib/README.md) for cross-feature stores, contracts and clients. Avoid
moving domain logic into generic UI primitives.

Tests live at the [frontend root](../../README.md#verification); update the nearest
feature README with any changed behavior or new validation command.
