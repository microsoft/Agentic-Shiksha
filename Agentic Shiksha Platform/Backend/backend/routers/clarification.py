from collections.abc import Callable
import logging
from typing import TypeVar

from fastapi import APIRouter, HTTPException, Response

from backend.dependencies.agent_access import CurrentUser
from backend.schemas.clarification import (
    ClarificationAnswers, ClarificationExtension, ClarificationState, ClarificationSubmitted,
)
from utils import clarification_registry as registry


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/clarify", tags=["Clarification"])
T = TypeVar("T")


def clarification_action(action: Callable[[], T]) -> T:
    try:
        return action()
    except registry.ClarificationNotOwned:
        raise HTTPException(status_code=403, detail="This clarification belongs to another account") from None
    except registry.ClarificationUnavailable:
        raise HTTPException(status_code=410, detail="This clarification is no longer waiting for answers") from None
    except registry.ClarificationConflict:
        raise HTTPException(status_code=409, detail="The answer window changed. Recheck its timer before continuing.") from None
    except ValueError:
        raise HTTPException(status_code=422, detail="Provide one answer per question, using empty strings for unanswered questions") from None
    except Exception:
        logger.exception("Clarification request failed")
        raise HTTPException(status_code=503, detail="The clarification could not be updated. Please retry.") from None


@router.get("/{clarify_id}", response_model=ClarificationState)
def get_clarification(clarify_id: str, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return clarification_action(lambda: registry.status(clarify_id, user.id))


@router.patch("/{clarify_id}", response_model=ClarificationState)
def save_clarification_draft(clarify_id: str, body: ClarificationAnswers, user: CurrentUser):
    return clarification_action(lambda: registry.save_draft(
        clarify_id, user.id, [answer.model_dump() for answer in body.answers],
    ))


@router.post("/{clarify_id}", response_model=ClarificationSubmitted)
def submit_clarification(clarify_id: str, body: ClarificationAnswers, user: CurrentUser):
    clarification_action(lambda: registry.submit(
        clarify_id, user.id, [answer.model_dump() for answer in body.answers],
    ))
    return ClarificationSubmitted(answers=len(body.answers))


@router.post("/{clarify_id}/extend", response_model=ClarificationState)
def extend_clarification(clarify_id: str, body: ClarificationExtension, user: CurrentUser):
    return clarification_action(lambda: registry.extend(clarify_id, user.id, body.revision))
