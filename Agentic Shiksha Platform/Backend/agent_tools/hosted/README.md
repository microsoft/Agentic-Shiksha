# agent_tools/hosted

Tools executed **server-side by Azure AI Foundry**, not by this backend.

These modules only build the tool definition. There is no local `handle_*` handler and no
`CustomTool` subclass — compare [../custom/](../custom), whose tools run here in Python.

| Tool | Status | Purpose |
| --- | --- | --- |
| [azure_ai_search](azure_ai_search) | Attached when course retrieval is configured | Grounded retrieval (RAG) over a course index |
| [bing_grounding](bing_grounding) | Optional agent capability | General web search through a project Bing connection |
| [bing_custom_search](bing_custom_search) | Optional agent capability | Domain-specific search over teacher-curated sites |
| [memory_search](memory_search) | Optional; requires a store | Persistent per-scope conversation memory |
| [deep_research](deep_research) | Builder for the separate research workflow | Long-running, multi-step research runs; not in the normal TA builder's tool list |
| [file_search](file_search) | **Deprecated / not wired** | Vector-store file search |
| [mcp](mcp) | **Deprecated / not wired** | Remote Model Context Protocol servers |

Each subpackage holds a `builder.py` exposing a `build_*_tool()` function.
The normal TA builder in
[azure_services/agents/agent_creation.py](../../azure_services/agents/agent_creation.py)
selects Search, Bing and optional memory tools. Deprecated file-search and MCP
builders raise `NotImplementedError`; their folders do not indicate enabled tools.

## Consequences of running server-side

- **No local `CustomTool.execute` handler runs.** The backend still receives and
  forwards response/tool/citation events through its runtime and streaming layer;
  server-side execution does not mean there is no backend-visible output.
- **The tool is fixed at agent creation.** Changing a builder does not affect existing
  agents; publishing a new agent version is a separate operation.
- **Tool types follow the installed SDK.** Use its typed attributes or explicit
  serialization rather than assuming the older nested `{"function": ...}` shape.
