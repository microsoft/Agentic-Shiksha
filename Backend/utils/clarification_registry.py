"""In-memory registry for clarifications the agent is blocking on.

The ``ask_clarification`` tool emits its questions to the client and then waits
here for the student's answers, so the agent can finish the same turn instead of
ending it and waiting for a new message. Entries are process-local and
short-lived, which is fine because a wait only spans a single streaming request.
"""

import logging
import os
import threading
import time
import uuid
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = float(os.getenv("CLARIFY_TIMEOUT_SECONDS", "60"))


class _PendingClarification:
    __slots__ = ("event", "answers", "created_at")

    def __init__(self) -> None:
        self.event = threading.Event()
        self.answers: Optional[List[Dict[str, str]]] = None
        self.created_at = time.monotonic()


_lock = threading.Lock()
_pending: Dict[str, _PendingClarification] = {}


def _sweep_locked() -> None:
    """Drop entries whose stream died before it ever reached the wait."""
    cutoff = time.monotonic() - (DEFAULT_TIMEOUT_SECONDS * 5)
    stale = [key for key, entry in _pending.items() if entry.created_at < cutoff]
    for key in stale:
        _pending.pop(key, None)
    if stale:
        logger.info(f"[clarify] swept {len(stale)} abandoned clarification(s)")


def register() -> str:
    """Create a pending clarification and return its id."""
    clarify_id = f"clarify-{uuid.uuid4().hex[:12]}"
    with _lock:
        _sweep_locked()
        _pending[clarify_id] = _PendingClarification()
    return clarify_id


def submit(clarify_id: str, answers: List[Dict[str, str]]) -> bool:
    """Deliver answers to a waiting agent. Returns False if nothing was waiting."""
    with _lock:
        entry = _pending.get(clarify_id)
    if entry is None:
        logger.warning(f"[clarify] submit for unknown or expired id: {clarify_id}")
        return False
    entry.answers = answers
    entry.event.set()
    return True


def wait(
    clarify_id: str,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> Optional[List[Dict[str, str]]]:
    """Block until answers arrive or ``timeout`` elapses. None means timed out."""
    with _lock:
        entry = _pending.get(clarify_id)
    if entry is None:
        return None
    try:
        if not entry.event.wait(timeout):
            logger.info(f"[clarify] {clarify_id} timed out after {timeout}s")
            return None
        return entry.answers
    finally:
        with _lock:
            _pending.pop(clarify_id, None)


def cancel(clarify_id: str) -> None:
    with _lock:
        _pending.pop(clarify_id, None)
