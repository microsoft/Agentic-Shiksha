# azure_ai_search (hosted)

Builds an `AzureAISearchAgentTool` that lets an agent retrieve grounded context from an
Azure AI Search index. This is the retrieval path behind course Teaching Assistants.

| | |
|---|---|
| Builder | [builder.py](builder.py) → `build_azure_ai_search_tool()` |
| Executed by | Azure AI Foundry, server-side |

## Configuration

| Variable | Purpose |
|---|---|
| `AZURE_AI_SEARCH_CONNECTION_ID` | Foundry connection to the search service |
| `AZURE_AI_SEARCH_INDEX_NAME` | Index to query, when not passed explicitly |

The default query type is `vector_semantic_hybrid`: vector plus keyword search fused with
Reciprocal Rank Fusion, then re-scored by the semantic ranker.

Index lifecycle — data source, skillset, indexer — is managed separately in
[azure_services/tools/search/course_index_manager.py](../../../azure_services/tools/search/course_index_manager.py).
This builder only points an agent at an index that already exists.
