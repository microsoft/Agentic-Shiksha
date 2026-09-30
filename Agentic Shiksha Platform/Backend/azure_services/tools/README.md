# azure_services/tools

Agent-facing capabilities: search, retrieval and memory.

| Subpackage | Purpose |
| --- | --- |
| [search/](search) | Azure AI Search index management and query paths. |
| [retrieval/](retrieval) | Reserved namespace; currently no implementation beyond the package marker. |
| [memory/](memory) | Per-agent memory stores with user-scoped isolation. |

These are the *service-side* implementations. The tool definitions the model actually
sees — schemas, argument shapes and handlers — live in
[agent_tools/](../../agent_tools).
