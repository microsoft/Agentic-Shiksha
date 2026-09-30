import logging
from typing import Annotated

from azure.core.exceptions import AzureError
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Response

from azure_services.persistence import cosmos_db
from backend.dependencies.agent_access import require_agent_access
from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.schemas.learner_profile import (
    LearnerLearningProgress,
    LearnerLearningResponse,
    LearnerProfileResponse,
    LearnerProfileUpdate,
    StoredLearnerLearningState,
    StoredLearnerPreferences,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/learner-profile", tags=["Learner profile"])
CurrentUser = Annotated[ActiveUser, Depends(get_current_active_user)]


def _profile_response(profile: dict, user_id: str) -> LearnerProfileResponse:
    if profile["id"] != user_id:
        raise ValueError("Unexpected learner profile identity")
    instructions = profile.get("customInstructions")
    return LearnerProfileResponse.model_validate({
        "customInstructions": "" if instructions is None else instructions,
        "updatedAt": profile.get("updatedAt"),
    })


@router.get("", response_model=LearnerProfileResponse)
def get_learner_profile(user: CurrentUser, response: Response) -> LearnerProfileResponse:
    response.headers["Cache-Control"] = "private, no-store"
    try:
        return _profile_response(cosmos_db.read_learner_profile(user.id), user.id)
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Learner profile not found") from None
    except Exception as error:
        logger.warning("Learner profile read failed (%s)", type(error).__name__)
        raise HTTPException(
            status_code=503, detail="Learner profile could not be loaded. Please retry.",
        ) from None


@router.put("", response_model=LearnerProfileResponse)
def update_learner_profile(
    body: LearnerProfileUpdate, user: CurrentUser, response: Response,
) -> LearnerProfileResponse:
    response.headers["Cache-Control"] = "private, no-store"
    try:
        saved = cosmos_db.update_user_custom_instructions(user.id, body.customInstructions)
        if "customInstructions" not in saved or "updatedAt" not in saved:
            raise ValueError("Incomplete learner profile acknowledgement")
        result = _profile_response(saved, user.id)
        if result.customInstructions != body.customInstructions or not result.updatedAt:
            raise ValueError("Unexpected learner profile acknowledgement")
        return result
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Learner profile not found") from None
    except Exception as error:
        logger.warning("Learner profile update failed (%s)", type(error).__name__)
        raise HTTPException(
            status_code=503, detail="Learner profile could not be saved. Please retry.",
        ) from None


@router.get(
    "/learning/{agent_id}", response_model=LearnerLearningResponse,
    dependencies=[Depends(require_agent_access)],
)
def get_learner_learning(
    agent_id: str, user: CurrentUser, response: Response,
) -> LearnerLearningResponse:
    response.headers["Cache-Control"] = "private, no-store"
    try:
        profile = StoredLearnerPreferences.model_validate(cosmos_db.read_learner_profile(user.id))
        if profile.id != user.id:
            raise ValueError("Unexpected learner profile identity")
        raw_state = cosmos_db.read_learner_learning_state(user.id, agent_id)
        progress = None
        if raw_state is not None:
            state = StoredLearnerLearningState.model_validate(raw_state)
            if (
                state.id != cosmos_db._learning_state_key(user.id, agent_id)
                or state.agent_id not in (None, agent_id)
                or state.partitionKey not in (None, user.id)
                or state.userId not in (None, user.id)
            ):
                raise ValueError("Unexpected learning state identity")
            progress = LearnerLearningProgress.model_validate(state.model_dump())
        preference = (profile.preferences or "").strip()
        return LearnerLearningResponse(
            user_id=user.id, agent_id=agent_id,
            status="ok" if progress is not None else "no_state",
            progress=progress, learning_preferences=[preference] if preference else [],
        )
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Learner profile not found") from None
    except (AzureError, ValueError) as error:
        logger.warning("Learner learning read failed (%s)", type(error).__name__)
        raise HTTPException(
            status_code=503, detail="Learner learning data could not be loaded. Please retry.",
        ) from None
