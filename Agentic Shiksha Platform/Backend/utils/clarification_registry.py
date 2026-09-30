"""Owner-scoped, process-local clarification waits for a single streaming turn."""

from copy import deepcopy
from dataclasses import dataclass, field
import logging
import os
import threading
import time
import uuid


logger = logging.getLogger(__name__)
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("CLARIFY_TIMEOUT_SECONDS", "60"))
DECISION_TIMEOUT_SECONDS = 10.0


class ClarificationUnavailable(Exception):
    pass


class ClarificationNotOwned(Exception):
    pass


class ClarificationConflict(Exception):
    pass


@dataclass
class _PendingClarification:
    user_id: str
    question_count: int
    answer_window: float
    decision_window: float
    deadline: float
    revision: int = 0
    answers: list[dict[str, str]] = field(default_factory=list)
    submitted: bool = False


_changed = threading.Condition()
_pending: dict[str, _PendingClarification] = {}


def _sweep_locked() -> None:
    now = time.monotonic()
    stale = [
        key for key, entry in _pending.items()
        if now > entry.deadline + entry.decision_window + DEFAULT_TIMEOUT_SECONDS * 4
    ]
    for key in stale:
        del _pending[key]
    if stale:
        _changed.notify_all()
        logger.info("Swept %s abandoned clarifications", len(stale))


def register(
    user_id: str,
    question_count: int,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    decision_timeout: float = DECISION_TIMEOUT_SECONDS,
) -> str:
    if not user_id or not 1 <= question_count <= 3 or timeout <= 0 or decision_timeout <= 0:
        raise ValueError("Invalid clarification registration")
    clarify_id = f"clarify-{uuid.uuid4().hex}"
    with _changed:
        _sweep_locked()
        _pending[clarify_id] = _PendingClarification(
            user_id, question_count, timeout, decision_timeout, time.monotonic() + timeout,
        )
    return clarify_id


def _active_locked(clarify_id: str, user_id: str) -> _PendingClarification:
    entry = _pending.get(clarify_id)
    if entry is None:
        raise ClarificationUnavailable()
    if entry.user_id != user_id:
        raise ClarificationNotOwned()
    if entry.submitted or time.monotonic() >= entry.deadline + entry.decision_window:
        raise ClarificationUnavailable()
    return entry


def _snapshot(clarify_id: str, entry: _PendingClarification) -> dict:
    now = time.monotonic()
    server_now = round(time.time() * 1000)
    deadline = server_now + round((entry.deadline - now) * 1000)
    return {
        "clarify_id": clarify_id,
        "phase": "decision" if now >= entry.deadline else "answering",
        "answer_deadline_ms": deadline,
        "decision_deadline_ms": deadline + round(entry.decision_window * 1000),
        "server_now_ms": server_now,
        "answer_window_seconds": entry.answer_window,
        "decision_window_seconds": entry.decision_window,
        "revision": entry.revision,
        "answers": deepcopy(entry.answers),
    }


def status(clarify_id: str, user_id: str) -> dict:
    with _changed:
        return _snapshot(clarify_id, _active_locked(clarify_id, user_id))


def _save_answers(entry: _PendingClarification, answers: list[dict[str, str]]) -> None:
    if len(answers) != entry.question_count:
        raise ValueError("Provide one answer per question, using empty strings for unanswered questions")
    entry.answers = deepcopy(answers)


def save_draft(clarify_id: str, user_id: str, answers: list[dict[str, str]]) -> dict:
    with _changed:
        entry = _active_locked(clarify_id, user_id)
        _save_answers(entry, answers)
        return _snapshot(clarify_id, entry)


def submit(clarify_id: str, user_id: str, answers: list[dict[str, str]]) -> None:
    with _changed:
        entry = _active_locked(clarify_id, user_id)
        _save_answers(entry, answers)
        entry.submitted = True
        _changed.notify_all()


def extend(clarify_id: str, user_id: str, revision: int) -> dict:
    with _changed:
        entry = _active_locked(clarify_id, user_id)
        if revision != entry.revision or time.monotonic() < entry.deadline:
            raise ClarificationConflict()
        entry.deadline = time.monotonic() + entry.answer_window
        entry.revision += 1
        _changed.notify_all()
        return _snapshot(clarify_id, entry)


def wait(clarify_id: str) -> list[dict[str, str]] | None:
    with _changed:
        entry = _pending.get(clarify_id)
        if entry is None:
            return None
        try:
            while _pending.get(clarify_id) is entry and not entry.submitted:
                remaining = entry.deadline + entry.decision_window - time.monotonic()
                if remaining <= 0:
                    logger.info("Clarification expired after its answer and decision windows")
                    break
                _changed.wait(remaining)
            if _pending.get(clarify_id) is not entry:
                return None
            return deepcopy(entry.answers) or None
        finally:
            _pending.pop(clarify_id, None)


def cancel(clarify_id: str) -> None:
    with _changed:
        _pending.pop(clarify_id, None)
        _changed.notify_all()
