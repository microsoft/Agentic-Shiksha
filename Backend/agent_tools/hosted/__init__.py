"""
Hosted tools.

Hosted tools are executed *server-side* by Azure AI Foundry (not by this
backend). They have no local ``handle_*`` handler; instead they are attached to
an agent at creation time via SDK builder classes and connection IDs.

This package is the canonical home for the small builder functions that
construct each hosted tool object, so the (previously duplicated / inline)
construction logic lives in one place:

    * :mod:`bing_grounding.builder`      - ``BingGroundingTool`` (general web search)
    * :mod:`bing_custom_search.builder`  - ``BingCustomSearchPreviewTool`` (curated sites)
    * :mod:`azure_ai_search.builder`     - ``AzureAISearchAgentTool`` (RAG over an index)
    * :mod:`memory_search.builder`       - ``MemorySearchTool`` (agent memory)
    * :mod:`deep_research.builder`       - ``DeepResearchTool`` (long-running research)

Deprecated / not currently wired (kept as stubs for reference):

    * :mod:`file_search.builder`         - ``FileSearchTool``
    * :mod:`mcp.builder`                 - ``MCPTool``
"""
