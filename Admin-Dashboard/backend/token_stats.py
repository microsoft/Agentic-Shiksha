"""
Token usage stats from Azure AI Foundry.
Fetches stored responses and aggregates tokens + rounds per agent.
Results are cached for 10 minutes to avoid hammering the API.
"""

import os
import time
import logging
from typing import Dict, Any, Optional
from collections import defaultdict

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from azure.core.rest import HttpRequest

logger = logging.getLogger(__name__)

PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
API_VERSION = "2025-11-15-preview"

# In-memory cache
_cache: Optional[Dict[str, Any]] = None
_cache_ts: float = 0
CACHE_TTL = 600  # 10 minutes
MAX_PAGES = 50   # Hard cap: 50 pages × 100 = 5000 responses max


def _get_client() -> AIProjectClient:
    credential = DefaultAzureCredential()
    return AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)


def _fetch_all_responses(client: AIProjectClient) -> list:
    """Paginate through /openai/responses to get all stored responses."""
    all_responses = []
    after = None
    page = 0

    while True:
        page += 1
        params = f"api-version={API_VERSION}&limit=100&order=desc"
        if after:
            params += f"&after={after}"

        req = HttpRequest(method="GET", url=f"/openai/responses?{params}")
        try:
            resp = client.send_request(req)
        except Exception as e:
            logger.error(f"Foundry API error on page {page}: {e}")
            break

        if resp.status_code != 200:
            logger.error(f"Foundry API HTTP {resp.status_code} on page {page}")
            break

        body = resp.json()
        data = body.get("data", [])
        if not data:
            break

        all_responses.extend(data)
        logger.info(f"Token usage: page {page}, fetched {len(data)} (total {len(all_responses)})")

        if not body.get("has_more", False):
            break
        if page >= MAX_PAGES:
            logger.warning(f"Token usage: reached page limit ({MAX_PAGES}), stopping. Total: {len(all_responses)}")
            break
        after = body.get("last_id")

    return all_responses


def get_token_stats() -> Dict[str, Dict[str, Any]]:
    """
    Return per-agent token + round stats.
    Returns: { agentId: { total_tokens, input_tokens, output_tokens, rounds, conversations } }
    Cached for CACHE_TTL seconds.
    """
    global _cache, _cache_ts

    if _cache is not None and (time.time() - _cache_ts) < CACHE_TTL:
        return _cache

    logger.info("Fetching token usage from Foundry API...")
    try:
        client = _get_client()
        responses = _fetch_all_responses(client)
    except Exception as e:
        logger.error(f"Failed to fetch Foundry responses: {e}")
        return _cache or {}

    # Group by agent → conversation → responses
    agent_conv: Dict[str, Dict[str, list]] = defaultdict(lambda: defaultdict(list))

    for r in responses:
        agent_ref = r.get("agent_reference") or r.get("agent")
        if isinstance(agent_ref, dict):
            agent_name = agent_ref.get("name") or agent_ref.get("id", "unknown")
        elif isinstance(agent_ref, str):
            agent_name = agent_ref
        else:
            continue

        conv = r.get("conversation")
        if isinstance(conv, dict):
            conv_id = conv.get("id", "unknown")
        elif isinstance(conv, str):
            conv_id = conv
        else:
            conv_id = "no-conversation"

        agent_conv[agent_name][conv_id].append(r)

    # Aggregate
    result: Dict[str, Dict[str, Any]] = {}
    for agent_name, convs in agent_conv.items():
        total_in = 0
        total_out = 0
        total_tok = 0
        total_rounds = 0

        for conv_id, conv_responses in convs.items():
            total_rounds += len(conv_responses)
            for resp in conv_responses:
                usage = resp.get("usage", {})
                total_in += usage.get("input_tokens", 0) or 0
                total_out += usage.get("output_tokens", 0) or 0
                total_tok += usage.get("total_tokens", 0) or 0

        result[agent_name] = {
            "total_tokens": total_tok,
            "input_tokens": total_in,
            "output_tokens": total_out,
            "rounds": total_rounds,
            "conversations": len(convs),
        }

    _cache = result
    _cache_ts = time.time()
    logger.info(f"Token usage cached: {len(result)} agents, {sum(r['total_tokens'] for r in result.values()):,} total tokens")
    return result
