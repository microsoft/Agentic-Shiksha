# azure_services/tools/search

Azure AI Search index management and the query paths behind course retrieval.

| Module | Purpose |
| --- | --- |
| [course_index_manager.py](course_index_manager.py) | Per-course index lifecycle: data source, skillset, index and indexer. |
| [bing_custom_search.py](bing_custom_search.py) | Domain-restricted web search over teacher-curated sites. |
| [azure_ai_search.py](azure_ai_search.py) | Reference snippet for creating a Foundry search connection. See the warning below. |

## Indexing pipeline

Blob data source → skillset → index. The skillset runs the Document Intelligence Layout
skill for structure-aware chunking — splitting at markdown headings so tables and lists
stay intact — then embeds each chunk.

Queries are hybrid vector plus keyword over an HNSW index, fused with Reciprocal Rank
Fusion and re-scored by the semantic ranker.

Each course gets its own dedicated index, alongside the shared `COMMON_*` resources
configured in [../../../.env.example](../../../.env.example).

## `azure_ai_search.py` is not runnable

It is an illustrative snippet, not wired into the application: it references an
`ml_client` that is never defined and would raise `NameError` if imported. Nothing
imports it. It is also the only reason `AZURE_SEARCH_CONNECTION_NAME` appears in
`.env.example`. Treat it as documentation, or delete it.
