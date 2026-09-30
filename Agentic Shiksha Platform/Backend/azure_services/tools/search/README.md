# azure_services/tools/search

Azure AI Search index management and the query paths behind course retrieval.

| Module | Purpose |
| --- | --- |
| [course_index_manager.py](course_index_manager.py) | Per-course index lifecycle: data source, skillset, index and indexer. |
| [bing_custom_search.py](bing_custom_search.py) | Domain-restricted web search over teacher-curated sites. |
| [azure_ai_search.py](azure_ai_search.py) | Optional, explicit Azure ML workspace connection setup helper; not called by the application. |

## Indexing pipeline

Blob data source → skillset → index. The skillset runs the Document Intelligence Layout
skill for structure-aware chunking — splitting at markdown headings so tables and lists
stay intact — then embeds each chunk.

Queries are hybrid vector plus keyword over an HNSW index, fused with Reciprocal Rank
Fusion and re-scored by the semantic ranker.

Each course gets its own dedicated index, alongside the shared `COMMON_*` resources
configured in [../../../.env.example](../../../.env.example).

## Optional search connection setup

`azure_ai_search.create_search_connection(ml_client, name=..., endpoint=...)`
creates or updates an Entra-authenticated search connection in the Azure ML
workspace selected by the supplied, authenticated `MLClient`. It is a management
helper, not part of the runtime indexing pipeline or a Foundry data-plane client.
Calling it explicitly changes that workspace's connection configuration.

Importing this module reads no environment variables, creates no clients, and
performs no Azure operations. The optional `azure-ai-ml` SDK is imported only
inside the helper and remains excluded from the application's runtime
requirements. A separate management environment must provide it when invoking
the helper; connection names and endpoints must be supplied explicitly.
