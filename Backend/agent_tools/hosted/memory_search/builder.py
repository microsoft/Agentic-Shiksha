"""
Memory Search hosted tool builder.

Constructs a ``MemorySearchTool`` that gives an agent access to a persistent
memory store (per-scope conversation memory). Executed server-side by Azure AI
Foundry.

Note: the *management* of memory stores (provisioning, indexing, retention)
lives in ``azure_services.tools.memory.memory_store_manager``. This module only
builds the tool object attached to an agent.
"""

import logging
from typing import Any, Optional

# SDK version compatibility: newer SDK renamed this class.
try:
    from azure.ai.projects.models import MemorySearchPreviewTool
except ImportError:  # pragma: no cover - depends on installed SDK version
    from azure.ai.projects.models import MemorySearchTool as MemorySearchPreviewTool

logger = logging.getLogger(__name__)


def build_memory_search_tool(
    memory_store_name: Optional[str],
    scope: str,
    update_delay: int,
) -> Optional[Any]:
    """Build a ``MemorySearchTool`` for the given store.

    Returns ``None`` when no store name is supplied or construction fails, so it
    never blocks agent creation.
    """
    if not memory_store_name:
        return None
    try:
        return MemorySearchPreviewTool(
            memory_store_name=memory_store_name,
            scope=scope,
            update_delay=update_delay,
        )
    except Exception as e:  # noqa: BLE001 - never block agent creation
        logger.warning(f"Failed to build MemorySearchTool: {e}")
        return None
