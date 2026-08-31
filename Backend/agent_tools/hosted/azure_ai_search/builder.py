"""
Azure AI Search hosted tool builder.

Constructs an ``AzureAISearchAgentTool`` that lets an agent retrieve grounded
context (RAG) from an Azure AI Search index. Executed server-side by Azure AI
Foundry.
"""

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


def build_azure_ai_search_tool(
    index_name: str,
    connection_id: str,
    query_type: str = "vector_semantic_hybrid",
    *,
    filter: Optional[str] = None,
    top_k: Optional[int] = None,
) -> Any:
    """Build an ``AzureAISearchAgentTool`` for the given index.

    Args:
        index_name: The name of the search index.
        connection_id: The project connection id for the search service.
        query_type: One of ``simple``, ``semantic``, ``vector``,
            ``vector_simple_hybrid``, ``vector_semantic_hybrid``.
        filter: Optional OData filter applied to the index.
        top_k: Optional number of chunks to retrieve.

    Returns:
        An ``AzureAISearchAgentTool`` instance ready to attach to an agent.
    """
    from azure.ai.projects.models import (
        AzureAISearchAgentTool,
        AzureAISearchToolResource,
        AISearchIndexResource,
        AzureAISearchQueryType,
    )

    query_type_map = {
        "simple": AzureAISearchQueryType.SIMPLE,
        "semantic": AzureAISearchQueryType.SEMANTIC,
        "vector": AzureAISearchQueryType.VECTOR,
        "vector_simple_hybrid": AzureAISearchQueryType.VECTOR_SIMPLE_HYBRID,
        "vector_semantic_hybrid": AzureAISearchQueryType.VECTOR_SEMANTIC_HYBRID,
    }
    qt = query_type_map.get(query_type.lower(), AzureAISearchQueryType.VECTOR_SEMANTIC_HYBRID)

    index_kwargs: dict = {
        "project_connection_id": connection_id,
        "index_name": index_name,
        "query_type": qt,
    }
    if filter is not None:
        index_kwargs["filter"] = filter
    if top_k is not None:
        index_kwargs["top_k"] = top_k

    return AzureAISearchAgentTool(
        azure_ai_search=AzureAISearchToolResource(
            indexes=[AISearchIndexResource(**index_kwargs)]
        )
    )
