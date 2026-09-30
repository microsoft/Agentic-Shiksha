"""Legacy session transport; active-account authorization remains in auth.py."""

from starlette.requests import Request
from starlette.responses import Response


SESSION_COOKIE_NAME = "session"
SESSION_COOKIE_MAX_AGE = 86400 * 7


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=SESSION_COOKIE_MAX_AGE,
        path="/",
    )


def get_session_token(request: Request) -> str | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        return token
    # This legacy transport is deliberately case-sensitive and does not strip
    # the credential. The newer active-account dependency has its own contract.
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None
