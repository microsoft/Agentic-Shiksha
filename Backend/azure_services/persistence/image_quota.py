"""Weekly per-user, per-agent image generation quota.

Two document shapes live in the ``learning_states_v1`` container (already
partitioned by user id, so no new container is needed):

* usage  — ``{user_id}_{agent_id}_image_quota`` partitioned by user id
* config — ``__image_quota_config__`` partitioned by ``__config__``, holding the
  admin-editable weekly allowance shared by every user

Quotas reset weekly on Monday (UTC). The reset is lazy: a usage document whose
``weekStart`` is older than the current week is treated as empty rather than
being rewritten on a schedule.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from azure.cosmos.exceptions import CosmosResourceNotFoundError

logger = logging.getLogger(__name__)

# Qualities the image tool exposes, cheapest first.
QUALITIES = ("low", "medium")

# Weekly allowance applied when an admin has not set one.
DEFAULT_WEEKLY_QUOTA: Dict[str, int] = {"medium": 5, "low": 15}

_CONFIG_ID = "__image_quota_config__"
_CONFIG_PARTITION = "__config__"

_config_cache: Optional[Dict[str, int]] = None


def _container():
    from azure_services.persistence.cosmos_db import _get_learning_states_container

    return _get_learning_states_container()


def _week_start(now: Optional[datetime] = None) -> str:
    """ISO date of the current week's Monday, in UTC."""
    now = now or datetime.now(timezone.utc)
    return (now - timedelta(days=now.weekday())).date().isoformat()


def _usage_id(user_id: str, agent_id: str) -> str:
    return f"{user_id}_{agent_id}_image_quota"


def get_quota_config() -> Dict[str, int]:
    """Return the weekly allowance per quality, falling back to the defaults."""
    global _config_cache
    if _config_cache is not None:
        return dict(_config_cache)

    limits = dict(DEFAULT_WEEKLY_QUOTA)
    try:
        doc = _container().read_item(item=_CONFIG_ID, partition_key=_CONFIG_PARTITION)
        for quality in QUALITIES:
            value = doc.get("limits", {}).get(quality)
            if isinstance(value, int) and value >= 0:
                limits[quality] = value
    except CosmosResourceNotFoundError:
        logger.info("[image_quota] No admin config stored; using defaults")
    except Exception as error:
        logger.error(f"[image_quota] Falling back to defaults, config read failed: {error}")

    _config_cache = dict(limits)
    return limits


def set_quota_config(limits: Dict[str, int]) -> Dict[str, int]:
    """Persist the admin-set weekly allowance and return the stored values."""
    global _config_cache
    current = get_quota_config()
    merged = dict(current)
    for quality in QUALITIES:
        value = limits.get(quality)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            continue
        merged[quality] = value

    _container().upsert_item(body={
        "id": _CONFIG_ID,
        "partitionKey": _CONFIG_PARTITION,
        "type": "image_quota_config",
        "limits": merged,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    })
    _config_cache = dict(merged)
    logger.info(f"[image_quota] Admin set weekly quota to {merged}")
    return merged


def _read_usage(user_id: str, agent_id: str) -> Dict[str, int]:
    """Used counts for the current week; a stale week reads as unused."""
    try:
        doc = _container().read_item(
            item=_usage_id(user_id, agent_id), partition_key=user_id
        )
    except CosmosResourceNotFoundError:
        return {q: 0 for q in QUALITIES}
    except Exception as error:
        # Failing open would hand out unlimited images, so count it as spent.
        logger.error(f"[image_quota] Usage read failed for {user_id}/{agent_id}: {error}")
        raise

    if doc.get("weekStart") != _week_start():
        return {q: 0 for q in QUALITIES}
    used = doc.get("used") or {}
    return {q: int(used.get(q, 0) or 0) for q in QUALITIES}


def get_status(user_id: str, agent_id: str) -> Dict[str, Any]:
    """Remaining allowance per quality for this user on this agent."""
    limits = get_quota_config()
    try:
        used = _read_usage(user_id, agent_id)
    except Exception:
        used = {q: limits[q] for q in QUALITIES}

    return {
        "weekStart": _week_start(),
        "quotas": {
            q: {
                "limit": limits[q],
                "used": used[q],
                "remaining": max(0, limits[q] - used[q]),
            }
            for q in QUALITIES
        },
    }


def available_qualities(user_id: str, agent_id: str) -> list:
    status = get_status(user_id, agent_id)
    return [q for q in QUALITIES if status["quotas"][q]["remaining"] > 0]


def consume(user_id: str, agent_id: str, quality: str) -> bool:
    """Spend one image of *quality*. False when nothing is left.

    Recorded before the image is generated: a double-spend is worse than an
    occasional unused credit if generation then fails.
    """
    if quality not in QUALITIES:
        return False
    if not user_id or not agent_id:
        # No identity to meter against; let the call through rather than block it.
        logger.warning("[image_quota] Missing user/agent id, skipping quota check")
        return True

    limits = get_quota_config()
    try:
        used = _read_usage(user_id, agent_id)
    except Exception:
        return False

    if used[quality] >= limits[quality]:
        return False

    used[quality] += 1
    try:
        _container().upsert_item(body={
            "id": _usage_id(user_id, agent_id),
            "partitionKey": user_id,
            "type": "image_quota",
            "agent_id": agent_id,
            "weekStart": _week_start(),
            "used": used,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as error:
        logger.error(f"[image_quota] Failed to record usage: {error}")
        return False

    logger.info(
        f"[image_quota] {user_id}/{agent_id} spent 1 {quality} "
        f"({used[quality]}/{limits[quality]} used this week)"
    )
    return True
