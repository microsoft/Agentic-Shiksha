"""Three clickable follow-up queries rendered at the end of a response."""

import logging
from typing import Any, Dict, List

from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

SUGGEST_NEXT_QUERIES_TOOL_DEFINITION = load_tool_definition("suggest_next_queries")

REQUIRED_QUERY_COUNT = 3
_MAX_QUERY_CHARS = 160


class SuggestNextQueriesTool(CustomTool):
    """Suggest follow-up questions the user can send with one click."""

    name = "suggest_next_queries"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        raw_queries = arguments.get("queries") or []
        if not isinstance(raw_queries, list):
            raise ValueError("suggest_next_queries 'queries' must be a list of strings.")

        queries: List[str] = []
        for query in raw_queries:
            if not isinstance(query, str):
                continue
            cleaned = query.strip()[:_MAX_QUERY_CHARS]
            if cleaned and cleaned.lower() not in {existing.lower() for existing in queries}:
                queries.append(cleaned)

        if len(queries) != REQUIRED_QUERY_COUNT:
            raise ValueError(
                f"suggest_next_queries requires exactly {REQUIRED_QUERY_COUNT} distinct, "
                f"non-empty queries (got {len(queries)})."
            )

        logger.info(f"suggest_next_queries called with {len(queries)} suggestions")

        return {"type": "suggested_queries", "queries": queries}

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        return (
            f"{len(result.get('queries', []))} follow-up suggestions shown to the user as buttons. "
            "Do NOT repeat them in text."
        )
