# Part 1: Memory Store

[Two-part memory README](README.md) / [Part 2: custom structure](overview.md)

**Source snapshot: 2026-09-30; Unreleased.** This describes the implemented
Foundry integration, not a claim that a live agent has it enabled.

## What does the store remember?

The Memory Store answers **"What useful context should the agent recall from
previous conversations?"** Its configuration supports user-profile information
and conversation summaries. It is not the custom curriculum graph, evidence
ledger, misconception policy, or threshold-crossing mechanism.

The distinction is semantic as well as physical: the
[custom learner-memory structure](overview.md) has its own typed records and
Cosmos/Blob persistence. Its state is not stored as a verdict inside this hosted
Memory Store.

## How does the mechanism work?

```mermaid
flowchart LR
    Input("Conversation input") --> Process("Hosted memory processing")
    Process --> Store("Profile and summary memory")
    Store --> Search("Scoped retrieval")
    Search --> Context("Context for the agent")
    classDef memory fill:#eef4fb,stroke:#345eb4,color:#203047
    class Input,Process,Store,Search,Context memory
```

This is the configured service mechanism, not a claim that the application calls
every management helper on every turn.

| Step | Current implementation |
| --- | --- |
| Create or recover a store | The [manager][manager] uses a per-agent `<agent-name>-memory` naming convention. The durable [creation workflow][creation] separately creates/recovers its job-owned store and checks ownership metadata. |
| Configure what is remembered | `MemoryStoreDefaultDefinition` supplies the chat and embedding deployments. `MemoryStoreDefaultOptions` enables profile and chat-summary memory; the manager can also supply extraction guidance. |
| Attach the agent-facing tool | The [hosted builder][builder] receives the store name, user scope, and update delay. The durable creation path requests a 300-second delay. This is a hosted setting, not the graph-memory worker's polling interval. |
| Update through the SDK | The manager's `add_memories` helper sends supplied strings as user-role items to `begin_update_memories`, waits for the result, and returns memory operations. Its default explicit update delay is zero, separate from the hosted-tool delay. |
| Recall relevant context | `search_memories` submits a query plus store and scope. `get_static_memories` exposes scope-based retrieval without a query; the helper alone does not establish automatic injection into every conversation. |

The integration uses `AIProjectClient(allow_preview=True)` and
`beta.memory_stores`. The tool is `MemorySearchPreviewTool`, executed by Foundry,
not the backend's local custom-tool dispatcher.

## What keeps learners separate?

Both the **agent/store boundary** and the **learner scope** matter. One store
must not become a shared pool of learner facts across courses or students.

The default `{{$userId}}` expression is tool configuration, **not proof that the
server's identity resolves to the intended learner**. Verify the actual remote
agent definition and scope behavior before relying on hosted memory isolation.
Never treat an agent name or conversation ID as authorization.

## When is this path used?

| Configuration boundary | Current behavior |
| --- | --- |
| Graph-memory feature disabled | The durable course-creation path prepares a hosted store and passes it to the tool builder. A configured store does not guarantee successful attachment or a deployed tool version. |
| Graph-memory feature enabled | `prepare_memory` skips hosted-store creation, and `AgentToolBuilder._add_memory` skips the hosted tool. This does not itself activate graph memory for every course. |
| Existing remote agents | Local flag or documentation changes do not delete their stores or edit their published tool definitions. |
| Authoritative graph mode | [Integration checks][integration] require the selected remote agent to have no hosted memory tool and pin the verified version. They reject an attached tool or an unverifiable definition rather than silently combining memory authorities. |

For graph `off`, `shadow`, and `authoritative` modes, see the
[configuration guide](overview.md#opt-in-configuration-and-modes).
Neither creating a store nor saving a graph draft establishes enabled,
authoritative learner memory.

## What must not be inferred?

- A remembered statement about progress is not evidence-backed misconception
  clearance, concept mastery, or threshold crossing.
- A search miss is not proof that a learner has no history. Some management
  helpers log failures and return empty results; inspect operational errors.
- The hosted builder can return no tool when configuration is absent or
  construction fails. Source presence is not successful tool attachment.
- Preview-service availability, retention, deletion, and scope behavior need
  deliberate operational verification. This guide performs no live operation.

Continue with [the custom structure and update mechanism](overview.md),
[misconception state](misconception-state.md), and
[evidence provenance](evidence-model.md).

[manager]: <../../Agentic Shiksha Platform/Backend/azure_services/tools/memory/memory_store_manager.py>
[creation]: <../../Agentic Shiksha Platform/Backend/utils/course_creation.py>
[builder]: <../../Agentic Shiksha Platform/Backend/agent_tools/hosted/memory_search/builder.py>
[integration]: <../../Agentic Shiksha Platform/Backend/learner_memory/integration.py>
