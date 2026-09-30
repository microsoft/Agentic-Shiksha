import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response

from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.schemas.speech import SpeechTokenResponse
from common_azure_auth import get_token_with_retry
from utils.slide_speech import SPEECH_SCOPE, get_speech_settings


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/speech", tags=["Speech"])
CurrentUser = Annotated[ActiveUser, Depends(get_current_active_user)]


@router.get("/token", response_model=SpeechTokenResponse)
def get_speech_token(user: CurrentUser, response: Response) -> SpeechTokenResponse:
    settings = get_speech_settings()
    if settings is None or not settings.region:
        raise HTTPException(
            status_code=503,
            detail="Voice input is not configured. Set AZURE_SPEECH_RESOURCE_NAME and AZURE_SPEECH_REGION.",
        )
    try:
        token = get_token_with_retry(SPEECH_SCOPE)
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            result = client.post(
                f"https://{settings.resource_name}.cognitiveservices.azure.com/sts/v1.0/issueToken",
                content=b"",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Ocp-Apim-Subscription-Region": settings.region,
                },
            )
        if result.status_code != 200 or not result.text.strip() or len(result.content) > 16384:
            raise ValueError("Speech token exchange was unsuccessful")
        response.headers["Cache-Control"] = "private, no-store"
        return SpeechTokenResponse(token=result.text, region=settings.region)
    except Exception as error:
        logger.warning("Voice input token request failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Voice input is unavailable. Please retry.") from None
