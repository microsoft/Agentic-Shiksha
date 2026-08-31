# azure_services

Azure integration layer for the Ekalaiva backend (agents, search, storage,
persistence, evaluation). Shared configuration lives in `config.py`.

## Memory Store Manager

`memory_store_manager.py` provides per-agent memory with user-scoped isolation.
Each agent gets its own memory store; within a store, memories are partitioned
by `scope` so multiple students sharing an agent never see each other's memories.

### Architecture

```
Agent A  -->  MemoryStore "agent-A-memory"
                 |-- scope: user_1  (Student 1's memories)
                 |-- scope: user_2  (Student 2's memories)
                 +-- scope: user_3  (Student 3's memories)

Agent B  -->  MemoryStore "agent-B-memory"
                 |-- scope: user_1
                 +-- scope: user_4
```

### Usage

```python
from azure_services.tools.memory.memory_store_manager import MemoryStoreManager

mgr = MemoryStoreManager(project_endpoint=PROJECT_ENDPOINT)

# Create a dedicated memory store for an agent
store = mgr.create_memory_store_for_agent("my-agent-name")

# Get MemorySearchTool with dynamic user scope (attach to agent)
tool = mgr.get_memory_search_tool("my-agent-name-memory")

# Search memories for a specific user
results = mgr.search_memories("my-agent-name-memory", scope="user_123", query="What are my preferences?")

# Delete a specific user's memories
mgr.delete_user_memories("my-agent-name-memory", scope="user_123")
```

Reference: https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/memory-usage
