"""
File Search hosted tool builder (DEPRECATED / not currently wired).

``FileSearchTool`` lets an agent search over files uploaded to a vector store.
This project does not currently attach a file-search tool to any agent -- RAG
is handled via :mod:`azure_ai_search` instead. This module is kept as a
reference stub so the hosted-tool inventory is complete.

To enable, construct and attach the tool at agent-creation time, e.g.::

    from azure.ai.projects.models import FileSearchTool
    tool = FileSearchTool(vector_store_ids=[vector_store_id])
"""

import logging

logger = logging.getLogger(__name__)


def build_file_search_tool(*args, **kwargs):  # pragma: no cover - deprecated stub
    """Not implemented: file search is not currently used in this project."""
    raise NotImplementedError(
        "FileSearchTool is not wired in this project. Use azure_ai_search instead."
    )
