# azure_services/tools/memory

Per-agent memory with user-scoped isolation.

| Module | Purpose |
| --- | --- |
| [memory_store_manager.py](memory_store_manager.py) | Creates and queries the memory store for an agent. |

Each agent gets its own store, and within a store memories are partitioned by user. Both
boundaries matter: one student's memories must never surface in another student's
conversation, and a course agent must not read memories written for a different course.

The agent-facing side is the hosted tool in
[agent_tools/hosted/memory_search/](../../../agent_tools/hosted/memory_search), which is
executed by Foundry rather than by this backend.
