"""
teacher_auth.py
───────────────
Identity resolution for the Teacher Dashboard.

The main Backend (Backend/auth.py) issues an HS256 JWT *session token* after a
successful Microsoft Entra ID login. That same token is reused here: the teacher
dashboard verifies it with the shared JWT_SECRET, extracts the user id (`sub`),
looks the user up in Cosmos (users_v1), and confirms the role is `teacher` or
`admin`. This keeps a single, scalable source of truth for identity.

Dev fallback: when DASHBOARD_ALLOW_DEV_AUTH is explicitly enabled (off by
default), an `X-Teacher-Id` header or `?teacher_id=` query param may be used
instead of the session cookie. Keep it disabled in production so identity can
only come from the verified session cookie.
"""

from __future__ import annotations

import os
import logging
from typing import Optional, Dict, Any

import jwt
from fastapi import Header, Query, HTTPException, status, Request

from . import cosmos_queries as cq

logger = logging.getLogger("teacher-dashboard.auth")

# Shared with Backend/auth.py — MUST match (same JWT_SECRET env var), otherwise
# Backend-issued session tokens cannot be verified here.
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is required")
JWT_ALGORITHM = "HS256"

# Name of the HttpOnly session cookie set by the main Backend after login
# (Backend/backend/main.py -> SESSION_COOKIE_NAME). Because the dashboard is now
# served by the same backend, that cookie is sent automatically and is the
# primary way we identify the teacher.
SESSION_COOKIE_NAME = "session"

# Roles allowed to access the teacher dashboard.
ALLOWED_ROLES = {"teacher", "admin"}

# Allow header/query-param identity when no session cookie is present.
# Disabled by default: the merged app uses the same session cookie as the main
# app, so local dev already has an identity. Enable only for isolated testing.
ALLOW_DEV_AUTH = os.getenv("DASHBOARD_ALLOW_DEV_AUTH", "false").lower() in (
    "true",
    "1",
    "yes",
)


def _verify_session_token(token: str) -> Optional[dict]:
    """Verify and decode a Backend-issued JWT session token. None on failure."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        logger.warning("Session token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning("Invalid session token: %s", e)
        return None


def _resolve_profile(user_id: str, email: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Look up a user profile by id, then by email.

    The session `sub` is the identity-provider id, which does not always match the
    stored userId (e.g. seeded accounts), so the token's email claim is the fallback.
    """
    profile = cq.get_user_profile(user_id)
    if not profile and "@" in user_id:
        profile = cq.get_user_by_email(user_id)
    if not profile and email:
        profile = cq.get_user_by_email(email)
    return profile


def _shape(profile: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": profile.get("id") or profile.get("userId", ""),
        "role": (profile.get("role") or "").lower(),
        "name": profile.get("displayName") or profile.get("fullName") or "",
        "email": profile.get("email", ""),
        "institute": profile.get("institute", ""),
        "department": profile.get("department", ""),
    }


def get_current_teacher(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_teacher_id: Optional[str] = Header(default=None),
    teacher_id: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    """
    FastAPI dependency that resolves the current teacher/admin.

    Resolution order:
      1. HttpOnly `session` cookie (primary - same cookie the main app sets)
      2. Authorization: Bearer <session_jwt>   -> verified, `sub` -> user id
      3. X-Teacher-Id header / ?teacher_id=     -> only if DASHBOARD_ALLOW_DEV_AUTH

    Raises 401 if identity cannot be established and 403 if the user is not a
    teacher or admin.
    """
    resolved_id: Optional[str] = None
    resolved_email: Optional[str] = None

    # 1. Session cookie (primary - set by the main Backend on login)
    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    if cookie_token:
        claims = _verify_session_token(cookie_token)
        if claims:
            resolved_id = claims.get("sub") or claims.get("email")
            resolved_email = claims.get("email")

    # 2. Bearer token (backward-compat)
    if not resolved_id and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        claims = _verify_session_token(token)
        if not claims:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session token",
            )
        resolved_id = claims.get("sub") or claims.get("email")
        resolved_email = claims.get("email")

    # 3. Dev fallback
    if not resolved_id and ALLOW_DEV_AUTH:
        resolved_id = x_teacher_id or teacher_id

    if not resolved_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    profile = _resolve_profile(resolved_id, resolved_email)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    shaped = _shape(profile)
    if shaped["role"] not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher or admin role required to access this dashboard.",
        )
    return shaped
