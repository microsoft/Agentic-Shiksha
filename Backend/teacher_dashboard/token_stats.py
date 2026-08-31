"""Persist token usage in Cosmos DB.

Live chat streams write immutable response-level usage events immediately.
One startup reconciliation reads only Foundry responses newer than the Cosmos
watermark, recovering any events missed during a process failure. Dashboard
requests read Cosmos exclusively.
"""

import os
import logging
import threading
from datetime import date, datetime, timezone
from typing import Dict, Any, Optional

from azure.ai.projects import AIProjectClient
from azure.core.rest import HttpRequest

from common_azure_auth import get_sync_credential

logger = logging.getLogger(__name__)

PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
API_VERSION = "2025-11-15-preview"

MAX_PAGES = 50   # Hard cap: 50 pages × 100 = 5000 responses max
_sync_lock = threading.Lock()


def _get_client() -> AIProjectClient:
    return AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=get_sync_credential())


def _fetch_responses_since(
    client: AIProjectClient,
    stop_after_id: Optional[str] = None,
) -> tuple[list, bool]:
    """Fetch newest responses until a persisted watermark is reached."""
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
            return all_responses, False

        if resp.status_code != 200:
            logger.error(f"Foundry API HTTP {resp.status_code} on page {page}")
            return all_responses, False

        body = resp.json()
        data = body.get("data", [])
        if not data:
            break

        for response in data:
            if stop_after_id and response.get("id") == stop_after_id:
                return all_responses, True
            all_responses.append(response)
        logger.debug(
            "Token usage reconciliation page %s: %s responses",
            page,
            len(data),
        )

        if not body.get("has_more", False):
            return all_responses, True
        if page >= MAX_PAGES:
            logger.warning(f"Token usage: reached page limit ({MAX_PAGES}), stopping. Total: {len(all_responses)}")
            return all_responses, False
        after = body.get("last_id")

    return all_responses, True


def _fetch_all_responses(client: AIProjectClient) -> list:
    responses, _ = _fetch_responses_since(client)
    return responses


def _response_agent_name(response: Dict[str, Any]) -> Optional[str]:
    agent_ref = response.get("agent_reference") or response.get("agent")
    if isinstance(agent_ref, dict):
        return agent_ref.get("name") or agent_ref.get("id")
    return agent_ref if isinstance(agent_ref, str) else None


def _response_created_at(response: Dict[str, Any]) -> Optional[datetime]:
    value = response.get("created_at") or response.get("createdAt")
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _foundry_response_to_event(response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    from . import cosmos_queries as cq

    agent_id = _response_agent_name(response)
    created_at = _response_created_at(response)
    usage = response.get("usage")
    response_id = response.get("id")
    if not agent_id or created_at is None or not response_id or not isinstance(usage, dict):
        return None
    total_tokens = int(usage.get("total_tokens", 0) or 0)
    if total_tokens <= 0:
        return None
    conversation = response.get("conversation")
    conversation_id = conversation.get("id") if isinstance(conversation, dict) else conversation
    return cq.build_token_usage_event(
        agent_id=agent_id,
        source_event_id=response_id,
        created_at=created_at.isoformat(),
        input_tokens=int(usage.get("input_tokens", 0) or 0),
        output_tokens=int(usage.get("output_tokens", 0) or 0),
        total_tokens=total_tokens,
        source="foundry",
        conversation_id=conversation_id,
    )


def build_stream_usage_events(
    *,
    agent_id: str,
    student_user_id: Optional[str],
    conversation_id: Optional[str],
    usage_event_id: Optional[str],
    usage: Dict[str, Any],
    created_at: Optional[str] = None,
) -> list[Dict[str, Any]]:
    """Normalize a streamed aggregate into response-level persisted events."""
    from . import cosmos_queries as cq

    timestamp = created_at or datetime.now(timezone.utc).isoformat()
    rounds = usage.get("per_round")
    events = []
    if isinstance(rounds, list) and rounds:
        for index, round_usage in enumerate(rounds, start=1):
            if not isinstance(round_usage, dict):
                continue
            input_tokens = int(round_usage.get("input_tokens", 0) or 0)
            output_tokens = int(round_usage.get("output_tokens", 0) or 0)
            source_event_id = round_usage.get("response_id") or (
                f"{usage_event_id}:{index}" if usage_event_id else None
            )
            if not source_event_id or input_tokens + output_tokens <= 0:
                continue
            events.append(
                cq.build_token_usage_event(
                    agent_id=agent_id,
                    source_event_id=str(source_event_id),
                    created_at=timestamp,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    total_tokens=input_tokens + output_tokens,
                    source="stream",
                    student_user_id=student_user_id,
                    conversation_id=conversation_id,
                )
            )
        if events:
            return events

    input_tokens = int(usage.get("input_tokens", 0) or 0)
    output_tokens = int(usage.get("output_tokens", 0) or 0)
    total_tokens = int(usage.get("total_tokens", 0) or 0)
    source_event_id = usage_event_id or (
        f"{conversation_id}:{timestamp}" if conversation_id else None
    )
    if not source_event_id or total_tokens <= 0:
        return []
    return [
        cq.build_token_usage_event(
            agent_id=agent_id,
            source_event_id=source_event_id,
            created_at=timestamp,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            source="stream",
            student_user_id=student_user_id,
            conversation_id=conversation_id,
        )
    ]


def persist_stream_usage(**kwargs: Any) -> Dict[str, int]:
    """Persist stream usage synchronously before forwarding the SSE event."""
    from . import cosmos_queries as cq

    events = build_stream_usage_events(**kwargs)
    stored = sum(1 for event in events if cq.store_token_usage_event(event))
    return {"stored": stored, "existing": len(events) - stored}


def sync_foundry_usage_to_cosmos() -> Dict[str, int]:
    """Reconcile missed responses once at startup, resuming from Cosmos state."""
    from . import cosmos_queries as cq

    if not _sync_lock.acquire(blocking=False):
        return {"fetched": 0, "stored": 0, "existing": 0, "skipped": 1}
    try:
        state = cq.get_token_usage_sync_state() or {}
        watermark = state.get("newestResponseId")
        responses, complete = _fetch_responses_since(_get_client(), watermark)
        events = [event for response in responses if (event := _foundry_response_to_event(response))]
        persisted = cq.store_token_usage_events(events)
        if complete and responses:
            cq.save_token_usage_sync_state(
                {
                    "newestResponseId": responses[0].get("id"),
                    "lastSyncAt": datetime.now(timezone.utc).isoformat(),
                    "initialBackfillComplete": True,
                }
            )
        logger.info(
            "Token usage reconciliation: fetched=%s stored=%s existing=%s",
            len(responses),
            persisted["stored"],
            persisted["existing"],
        )
        return {"fetched": len(responses), **persisted, "skipped": 0}
    finally:
        _sync_lock.release()


def get_token_usage_events(
    agent_ids: list[str], start_date: date, end_date: date
) -> list[Dict[str, Any]]:
    """Return persisted Cosmos usage facts; dashboard reads never call Foundry."""
    from . import cosmos_queries as cq

    return cq.get_persisted_token_usage_events(agent_ids, start_date, end_date)


def get_token_stats() -> Dict[str, Dict[str, Any]]:
    """
    Return persisted per-agent token + round stats from Cosmos DB.
    Returns: { agentId: { total_tokens, input_tokens, output_tokens, rounds, conversations } }
    """
    from . import cosmos_queries as cq

    agents = cq.list_agents()
    agent_ids = [agent.get("agentId") or agent.get("id") for agent in agents]
    return cq.get_persisted_token_stats(agent_ids)
