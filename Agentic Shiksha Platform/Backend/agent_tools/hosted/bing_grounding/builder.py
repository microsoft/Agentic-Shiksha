"""
Bing Grounding hosted tool builder.

Constructs a ``BingGroundingTool`` for general web search, grounded through a
project Bing connection. Executed server-side by Azure AI Foundry.
"""

import logging
from typing import Any, Optional

from azure.ai.projects.models import (
    BingGroundingSearchToolParameters,
    BingGroundingSearchConfiguration,
)

# SDK version compatibility: newer SDK renamed this class.
try:
    from azure.ai.projects.models import BingGroundingTool
except ImportError:  # pragma: no cover - depends on installed SDK version
    from azure.ai.projects.models import BingGroundingAgentTool as BingGroundingTool

logger = logging.getLogger(__name__)


def build_bing_grounding_tool(connection_id: Optional[str]) -> Optional[Any]:
    """Build a ``BingGroundingTool`` for the given project connection.

    Returns ``None`` when no connection id is supplied or construction fails, so
    a missing/misconfigured tool never blocks agent creation.
    """
    if not connection_id:
        return None
    try:
        return BingGroundingTool(
            bing_grounding=BingGroundingSearchToolParameters(
                search_configurations=[
                    BingGroundingSearchConfiguration(project_connection_id=connection_id)
                ]
            )
        )
    except Exception as e:  # noqa: BLE001 - never block agent creation
        logger.warning(f"Failed to build BingGroundingTool: {e}")
        return None
