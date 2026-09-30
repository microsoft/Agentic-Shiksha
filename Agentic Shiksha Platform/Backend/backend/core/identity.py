"""Construct OAuth clients once from the startup-validated settings."""

from typing import TYPE_CHECKING

from backend.services.identity import IdentityDirectory, IdentityService

if TYPE_CHECKING:
    from deployment_settings import ApplicationSettings


def create_identity_service(
    settings: "ApplicationSettings", directory: IdentityDirectory
) -> IdentityService:
    from auth import EntraAuth, create_session_token, verify_session_token
    from google_auth import GoogleAuth

    entra = EntraAuth(
        client_id=settings.AZURE_AUTH_CLIENT_ID,
        tenant_id=settings.AZURE_AUTH_TENANT_ID,
        redirect_uri=settings.AUTH_REDIRECT_URI or f"{settings.BACKEND_URL.rstrip('/')}/auth/callback",
    )
    google = None
    if settings.GOOGLE_CLIENT_ID:
        google = GoogleAuth(
            client_id=settings.GOOGLE_CLIENT_ID,
            redirect_uri=settings.GOOGLE_REDIRECT_URI or f"{settings.BACKEND_URL.rstrip('/')}/auth/google/callback",
            client_secret=settings.GOOGLE_CLIENT_SECRET.get_secret_value(),
        )
    return IdentityService(
        entra=entra,
        google=google,
        directory=directory,
        issue_token=create_session_token,
        verify_token=verify_session_token,
        super_admin_email=settings.SUPER_ADMIN_EMAIL,
    )
