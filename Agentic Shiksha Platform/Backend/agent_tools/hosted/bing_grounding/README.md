# bing_grounding (hosted)

Builds a `BingGroundingTool` for general web search, grounded through a project Bing
connection.

| | |
|---|---|
| Builder | [builder.py](builder.py) → `build_bing_grounding_tool()` |
| Executed by | Azure AI Foundry, server-side |
| Configuration | `AZURE_BING_CONNECTION_ID` |

The connection id is read at **import time** by
[azure_services/agents/agent_creation.py](../../../azure_services/agents/agent_creation.py),
so the variable must be set or that module fails to import.

Use this for open-ended current-events lookups. For teaching against a fixed set of
teacher-approved sites, use [../bing_custom_search/](../bing_custom_search) instead —
course answers should stay grounded in curated material rather than the open web.
