"""
Bing Custom Search hosted tool builder.

Constructs a ``BingCustomSearchPreviewTool`` for domain-specific search over a
teacher-curated set of sites (a Bing Custom Search "instance"). Executed
server-side by Azure AI Foundry.
"""

import logging
from typing import Any, Optional

from azure.ai.projects.models import (
    BingCustomSearchToolParameters,
    BingCustomSearchConfiguration,
)

# SDK version compatibility: newer SDK renamed this class.
try:
    from azure.ai.projects.models import BingCustomSearchPreviewTool
except ImportError:  # pragma: no cover - depends on installed SDK version
    from azure.ai.projects.models import BingCustomSearchAgentTool as BingCustomSearchPreviewTool

logger = logging.getLogger(__name__)


def build_bing_custom_search_tool(
    connection_id: Optional[str],
    instance_name: Optional[str],
) -> Optional[Any]:
    """Build a ``BingCustomSearchPreviewTool``.

    Returns ``None`` when the connection id or instance name is missing, or when
    construction fails, so it never blocks agent creation.
    """
    if not (connection_id and instance_name):
        return None
    try:
        return BingCustomSearchPreviewTool(
            bing_custom_search_preview=BingCustomSearchToolParameters(
                search_configurations=[
                    BingCustomSearchConfiguration(
                        project_connection_id=connection_id,
                        instance_name=instance_name,
                    )
                ]
            )
        )
    except Exception as e:  # noqa: BLE001 - never block agent creation
        logger.warning(f"Failed to build BingCustomSearchPreviewTool: {e}")
        return None
