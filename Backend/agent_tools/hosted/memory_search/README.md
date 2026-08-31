# memory_search (hosted)

Builds a `MemorySearchTool` giving an agent access to a persistent memory store —
per-scope conversation memory that survives across sessions.

| | |
|---|---|
| Builder | [builder.py](builder.py) → `build_memory_search_tool()` |
| Executed by | Azure AI Foundry, server-side |

Stores are managed by
[azure_services/tools/memory/memory_store_manager.py](../../../azure_services/tools/memory/memory_store_manager.py).
Each agent gets its own store, and memories inside a store are partitioned by user.

Both boundaries are load-bearing: one student's memories must never appear in another
student's conversation, and a course agent must not read memories written for a different
course. Widening the scope passed to this builder breaks that isolation.

Optional tuning: `MEMORY_CHAT_MODEL`, `MEMORY_EMBEDDING_MODEL`, `MEMORY_UPDATE_DELAY`.
