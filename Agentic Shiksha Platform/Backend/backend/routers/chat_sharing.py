import logging
from typing import Annotated

from azure.core.exceptions import HttpResponseError
from fastapi import APIRouter, Depends, HTTPException

from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.schemas.chat_sharing import RevokeShareResult, ShareResult, ShareSelection


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat/thread", tags=["Chat Sharing"])
CurrentUser = Annotated[ActiveUser, Depends(get_current_active_user)]


@router.post("/{thread_id}/share", response_model=ShareResult)
def share_thread(thread_id: str, body: ShareSelection, user: CurrentUser, user_id: str | None = None):
    from azure_services.persistence.cosmos_db import create_share_token_for_thread

    if user_id and user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the conversation owner can share it")
    try:
        token = create_share_token_for_thread(
            thread_id, user.id, expected_message_ids=body.message_ids, refresh=body.refresh,
        )
        if not token:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return ShareResult(success=True, share_token=token, thread_id=thread_id)
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(status_code=409, detail="The selected conversation is not fully saved. Retry sharing after saving completes.") from None
    except HttpResponseError as error:
        if error.status_code == 412:
            raise HTTPException(status_code=409, detail="The conversation changed. Retry sharing.") from None
        logger.warning("Share write failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Sharing is unavailable. Please retry.") from None
    except Exception as error:
        logger.warning("Share write failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Sharing is unavailable. Please retry.") from None


@router.delete("/{thread_id}/share", response_model=RevokeShareResult)
def revoke_thread_share(thread_id: str, user: CurrentUser, user_id: str | None = None):
    from azure_services.persistence.cosmos_db import revoke_share_token

    if user_id and user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the conversation owner can change its share")
    try:
        return RevokeShareResult(success=revoke_share_token(thread_id, user.id))
    except Exception as error:
        logger.warning("Share revocation failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Sharing could not be disabled. Please retry.") from None