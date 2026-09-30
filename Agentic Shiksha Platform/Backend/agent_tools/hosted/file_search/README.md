# file_search (hosted) — deprecated

Builds a `FileSearchTool`, which lets an agent search over files uploaded to a vector
store.

> **Not currently wired.** Retrieval in this project is handled by
> [../azure_ai_search/](../azure_ai_search) instead. The module is kept as a reference
> implementation; calling into it raises rather than silently doing nothing.

Azure AI Search was chosen over vector-store file search because course material needs the
structure-aware chunking, hybrid vector-plus-keyword query path and semantic re-ranking
described in
[azure_services/tools/search/](../../../azure_services/tools/search).

If you are looking for how an agent reads course material, you are in the wrong folder.
