# azure_services/tools/memory

Per-agent memory with user-scoped isolation.

This is **Part 1: the hosted Memory Store**, for conversational recall. It is
separate from the project's custom learner-memory structure and its evidence/state
policy. See the [two-part memory README](../../../../../docs/memory/README.md)
and [store mechanism](../../../../../docs/memory/memory-store.md).

| Module | Purpose |
| --- | --- |
| [memory_store_manager.py](memory_store_manager.py) | Creates and queries the memory store for an agent. |

Each agent gets its own store, and within a store memories are partitioned by user. Both
boundaries matter: one student's memories must never surface in another student's
conversation, and a course agent must not read memories written for a different course.

The agent-facing side is the hosted tool in
[agent_tools/hosted/memory_search/](../../../agent_tools/hosted/memory_search), which is
executed by Foundry rather than by this backend.

With the stable Projects SDK, hosted memory remains a preview service feature.
The manager opts in with `allow_preview=True` and calls
`AIProjectClient.beta.memory_stores`; it exposes `MemorySearchPreviewTool` through
the existing `MemorySearchTool` alias. Search/update inputs retain explicit user
roles, and every memory operation retains its store and user scope.

The configured `{{$userId}}` expression is not proof of per-learner isolation in
a service-credential runtime. Current graph-enabled creation skips hosted memory;
authoritative graph turns require a remote agent without a hosted memory tool.
The [custom-memory guide](../../../../../docs/memory/overview.md) explains those
separate configuration and authority boundaries.
