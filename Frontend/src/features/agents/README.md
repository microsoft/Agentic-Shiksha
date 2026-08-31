# features/agents

Agent listing and selection.

| Component | Purpose |
| --- | --- |
| [AgentRow.tsx](AgentRow.tsx) | One agent in a list: name, course metadata and actions. |

The agent list is fetched through [../../lib/](../../lib). Concurrent requests for it are
collapsed into a single upstream call on the backend — see
[test_agent_list_singleflight.py](../../../../Backend/tests/test_agent_list_singleflight.py)
— so rendering many rows at once does not multiply Foundry calls.

Creating and editing agents live in [../create/](../create) and [../edit/](../edit).
