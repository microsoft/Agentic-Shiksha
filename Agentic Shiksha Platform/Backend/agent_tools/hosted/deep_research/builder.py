"""
Deep Research hosted tool builder.

Constructs a ``DeepResearchTool`` for long-running, multi-step research runs.
Executed server-side by Azure AI Foundry (via the Agents threads/runs API).

Note: this module only builds the tool object. The orchestration around
running a deep-research agent lives in ``backend/main.py``.
"""

import logging
from typing import Any

from azure.ai.agents.models import DeepResearchTool

logger = logging.getLogger(__name__)


def build_deep_research_tool(
    bing_grounding_connection_id: str,
    deep_research_model: str,
) -> Any:
    """Build a ``DeepResearchTool``.

    Args:
        bing_grounding_connection_id: Project connection id for the Bing
            grounding resource the deep-research model uses.
        deep_research_model: The deployment name of the deep-research model.
    """
    return DeepResearchTool(
        bing_grounding_connection_id=bing_grounding_connection_id,
        deep_research_model=deep_research_model,
    )
