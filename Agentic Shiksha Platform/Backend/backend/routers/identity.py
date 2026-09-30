"""HTTP redirects and cookie transport for the identity workflow."""

import logging
from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from backend.dependencies.service_errors import service_errors
from backend.dependencies.session import get_session_token, set_session_cookie
from backend.services.identity import IdentityService, LoginRejected


logger = logging.getLogger(__name__)


def create_identity_router(service: IdentityService, frontend_url: str) -> APIRouter:
    router = APIRouter()

    @router.get("/", include_in_schema=False)
    def root():
        """Redirect to frontend - allows cookie compliance scanner to find the HTML page."""
        return RedirectResponse(url=frontend_url, status_code=302)

    def login_redirect(callback, request: Request, provider: str):
        try:
            token = callback(dict(request.query_params))
        except LoginRejected as exc:
            logger.warning("%s login rejected: %s", provider, exc)
            return RedirectResponse(f"{frontend_url}/auth?error={quote(str(exc))}")
        except ValueError as exc:
            logger.error("%s auth callback ValueError", provider, exc_info=True)
            return RedirectResponse(f"{frontend_url}/auth?error={quote(str(exc))}")
        except Exception as exc:
            logger.exception("Unexpected %s auth callback error", provider)
            return RedirectResponse(f"{frontend_url}/auth?error={quote(str(exc))}")
        response = RedirectResponse(f"{frontend_url}/auth/callback", status_code=302)
        set_session_cookie(response, token)
        return response

    @router.get("/auth/login", tags=["auth"])
    def auth_login():
        """Redirect user to Microsoft Entra ID login page."""
        return RedirectResponse(service.entra.get_login_url())

    @router.get("/auth/callback", tags=["auth"])
    async def auth_callback(request: Request):
        """
        Handle the callback from Microsoft Entra ID after user authentication.
        Completes the PKCE auth code flow, creates a JWT session token,
        and redirects the user back to the frontend.
        """
        return login_redirect(service.complete_microsoft_login, request, "Microsoft")

    @router.get("/auth/google/login", tags=["auth"])
    def auth_google_login():
        """Redirect user to Google OAuth login page."""
        if service.google is None:
            logger.error("Google auth not configured (GOOGLE_CLIENT_ID not set)")
            return RedirectResponse(f"{frontend_url}/auth?error=google_auth_not_configured")
        return RedirectResponse(service.google.get_login_url())

    @router.get("/auth/google/callback", tags=["auth"])
    async def auth_google_callback(request: Request):
        """
        Handle the callback from Google OAuth after user authentication.
        Completes the OAuth flow, creates a JWT session token,
        and redirects the user back to the frontend.
        """
        return login_redirect(service.complete_google_login, request, "Google")

    @router.get("/auth/google/status", tags=["auth"])
    def auth_google_status():
        """Check if Google auth is configured and available."""
        return {"enabled": service.google is not None}

    @router.get("/auth/me", tags=["auth"])
    def auth_me(request: Request):
        """
        Return the authenticated user's profile from the JWT session token.
        Reads from HttpOnly 'session' cookie (preferred) or Authorization header (fallback).
        """
        with service_errors():
            return service.session_profile(get_session_token(request))

    @router.post("/auth/logout", tags=["auth"])
    def auth_logout():
        """
        Logout endpoint. Clears the HttpOnly session cookie.
        """
        response = JSONResponse(content={"status": "ok"})
        response.delete_cookie(key="session", path="/", samesite="none", secure=True)
        return response

    return router
