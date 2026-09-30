import logging
from typing import Literal

from fastapi import HTTPException, Request
from pydantic import BaseModel, ValidationError


logger = logging.getLogger(__name__)


class ActiveUser(BaseModel):
    id: str
    role: Literal["student", "teacher", "admin", "superadmin"]
    status: Literal["active"]


def verify_token(token: str) -> dict | None:
    from auth import verify_session_token
    return verify_session_token(token)


def load_profile(user_id: str) -> dict | None:
    from azure_services.persistence.cosmos_db import get_user_profile
    return get_user_profile(user_id)


def get_current_active_user(request: Request) -> ActiveUser:
    token = request.cookies.get("session")
    if not token:
        scheme, _, credentials = request.headers.get("Authorization", "").partition(" ")
        if scheme.lower() == "bearer":
            token = credentials.strip()
    claims = verify_token(token) if token else None
    if not claims or not isinstance(claims.get("sub"), str) or not claims["sub"].strip():
        raise HTTPException(status_code=401, detail="Sign in required")
    try:
        profile = load_profile(claims["sub"])
    except Exception:
        logger.exception("Unable to verify active account")
        raise HTTPException(status_code=503, detail="Account access could not be verified. Please retry.") from None
    try:
        user = ActiveUser.model_validate(profile)
    except ValidationError:
        raise HTTPException(status_code=403, detail="An active account is required") from None
    if user.id != claims["sub"]:
        raise HTTPException(status_code=403, detail="Account identity does not match")
    return user