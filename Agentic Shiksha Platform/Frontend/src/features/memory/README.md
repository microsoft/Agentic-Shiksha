# Graph Memory UI

Opt-in course/learner evidence views and curriculum-graph authoring. This feature
is integrated into existing screens rather than registered as a standalone page.
UI presence does not enable Graph Memory, provision storage or establish live
readiness. Consult the [backend feature guide](../../../../Backend/learner_memory/README.md)
before enabling it.

## Modules

| Module | Responsibility |
| --- | --- |
| [GraphMemoryPanel.tsx](GraphMemoryPanel.tsx) | Learner snapshot, mastery/crossing distinctions, freshness, evidence citations and bounded graph context; also exports `TeacherGraphMemoryPanel` for course-cohort inspection |
| [CurriculumGraphEditor.tsx](CurriculumGraphEditor.tsx) | Typed node/edge editing, policy and full-graph JSON, draft revisions, reviewed publication and course-mode configuration |
| [curriculumGraphValidation.ts](curriculumGraphValidation.ts) | Parsing and local graph/policy checks before saving or publishing |
| [useMemoryConfig.ts](useMemoryConfig.ts) | Per-agent configuration lookup, loading/error state, cancellation and explicit refresh |
| [learnerMemoryApi.ts](../../lib/learnerMemoryApi.ts) | Shared contracts and authenticated API calls used by this feature |

## Integration

- [ChatView.tsx](../../pages/ChatView.tsx) hosts the learner-memory view and the
  non-student curriculum graph editor in its curriculum pane.
- [LearnerProfileDialog.tsx](../../components/chat/LearnerProfileDialog.tsx) uses
  the graph panel in its memory tab when enabled. Authoritative mode also replaces
  the legacy overview presentation.
- [TeacherDashboardPage.tsx](../dashboard/TeacherDashboardPage.tsx) uses the
  teacher panel for an enabled course, with a stable-concept filter and learner
  selection from the supplied course roster.

The server configuration distinguishes `off`, `shadow` and `authoritative`.
Shadow output is labelled experimental and not authoritative. The learner panel
does not render when disabled/off. Browser role checks and `can_manage` control
presentation only; the server must verify authorization, course scope and versions
for every read and write.

## Reading learning evidence

The learner panel distinguishes concept mastery from threshold crossing and
unassessed prerequisites from assessed struggles. It displays the last committed
snapshot, pending-event count and curriculum/policy revalidation status rather
than inventing mastery from missing data.

Refresh re-reads the selected learner/course. Pending events schedule another
snapshot read after five seconds; `learner-memory-updated` refreshes matching
agent/user views. Selecting a stable concept fetches its bounded context, and
opening an evidence reference performs a separate authenticated read. Partial
context, unavailable reads and stale curriculum bindings have explicit messages.
The teacher panel reports partial cohort results rather than claiming full coverage.

The API client uses the main `VITE_API_BASE_URL`, session credentials and
`cache: "no-store"`. It calls `/api/agents/{agentId}/memory/config`, the
learner-scoped memory/context/evidence routes, and
`/api/teacher-dashboard/memory/cohorts/{agentId}`. These are not requests to the
standalone admin API or the hosted Foundry memory-store manager.

## Authoring and publication

Editing nodes, edges or JSON first changes local state. **Save graph draft**
persists a draft with `expected_revision`; it does not publish it. **Publish
reviewed graph** requires a saved, unchanged draft and sends its revision plus
an idempotency key. A conflict asks for a server-draft reload rather than silently
overwriting another revision. Reloading replaces the local editor state.

Local validation checks typed relation endpoints, stable/unique IDs, prerequisite
cycles, explicit required mappings and policy constraints. Publication additionally
requires reviewed policy and required misconception/transfer mappings. Client
validation is an aid, not a replacement for server validation. Graph/policy changes
require learner-state revalidation; old crossings are not automatically carried
forward.

**Save course configuration** is a separate explicit write for mode and approved
scope. These actions are not deferred to the general TA **Update** button and
must not run automatically when opening the editor.

## Verification

Use the [frontend verification guide](../../../README.md#verification). Run commands
from the frontend root, not this feature directory. The existing learner-profile
browser suite covers its surrounding screen; it is not proof of Graph Memory
worker/storage readiness.

For feature changes, use synthetic intercepted APIs to exercise disabled, shadow
and authoritative states, empty/pending/stale evidence, access errors, partial
cohorts, invalid graphs, revision conflicts and explicit save/publish actions.
Do not enable a live course, publish a curriculum or use real learner evidence
as a documentation or UI smoke test.

Return to the [feature index](../README.md).
