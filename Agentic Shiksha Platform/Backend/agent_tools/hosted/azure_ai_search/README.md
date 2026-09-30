# azure_ai_search (hosted)

Builds an `AzureAISearchTool` that lets an agent retrieve grounded context from an
Azure AI Search index. This is the retrieval path behind course Teaching Assistants.
This is the class name in the stable Projects SDK; course filters, query type and
retrieval limits are preserved.

| | |
|---|---|
| Builder | [builder.py](builder.py) → `build_azure_ai_search_tool()` |
| Executed by | Azure AI Foundry, server-side |

## Configuration

| Variable | Purpose |
|---|---|
| `AZURE_AI_SEARCH_CONNECTION_ID` | Foundry connection available to higher-level configuration |
| Course index name | Passed explicitly with the connection ID to `build_azure_ai_search_tool` |

The builder itself does not read environment variables and has no implicit index
fallback. `AgentToolBuilder` requires **both** an index and a connection when
retrieval is requested; providing only one is an error.

The default query type is `vector_semantic_hybrid`: vector plus keyword search fused with
Reciprocal Rank Fusion, then re-scored by the semantic ranker.

Index lifecycle — data source, skillset, indexer — is managed separately in
[azure_services/tools/search/course_index_manager.py](../../../azure_services/tools/search/course_index_manager.py).
This builder only points an agent at an index that already exists.
