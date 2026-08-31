# agent_tools/hosted

Tools executed **server-side by Azure AI Foundry**, not by this backend.

These modules only build the tool definition. There is no local `handle_*` handler and no
`CustomTool` subclass — compare [../custom/](../custom), whose tools run here in Python.

| Tool | Status | Purpose |
| --- | --- | --- |
| [azure_ai_search](azure_ai_search) | Active | Grounded retrieval (RAG) over a course index |
| [bing_grounding](bing_grounding) | Active | General web search through a project Bing connection |
| [bing_custom_search](bing_custom_search) | Active | Domain-specific search over teacher-curated sites |
| [memory_search](memory_search) | Active | Persistent per-scope conversation memory |
| [deep_research](deep_research) | Active | Long-running, multi-step research runs |
| [file_search](file_search) | **Deprecated / not wired** | Vector-store file search |
| [mcp](mcp) | **Deprecated / not wired** | Remote Model Context Protocol servers |

Each subpackage holds a `builder.py` exposing a `build_*_tool()` function that returns the
SDK tool object, which [azure_services/agents/agent_creation.py](../../azure_services/agents/agent_creation.py)
attaches when creating an agent.

## Consequences of running server-side

- **Nothing streams through this backend.** The tool executes inside Foundry, so there is
  no local hook to log, cache or post-process results.
- **The tool is fixed at agent creation.** Changing a builder does not affect existing
  agents; they must be re-provisioned.
- **Tools come back as SDK objects, not dictionaries.** Calling `tool.get("function")`
  when inspecting an agent silently yields nothing — read the attributes instead.
