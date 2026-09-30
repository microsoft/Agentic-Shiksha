"""OAuth admission and session policy, independent of HTTP and SDK clients."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from backend.services.errors import AccessDenied, NotAuthenticated


logger = logging.getLogger(__name__)
Record = dict[str, Any]


class OAuthProvider(Protocol):
    def get_login_url(self) -> str: ...
    def complete_login(self, auth_response: dict[str, str]) -> Record: ...


class IdentityDirectory(Protocol):
    def get_invite_by_email(self, email: str) -> Record | None: ...
    def get_user_by_email(self, email: str) -> Record | None: ...
    def promote_invited_user(
        self, email: str, user_id: str, *, auth_provider: str, display_name: str
    ) -> Record | None: ...


class SessionIssuer(Protocol):
    def __call__(
        self, user_id: str, display_name: str, email: str, provider: str = "microsoft"
    ) -> str: ...


class LoginRejected(Exception):
    """An OAuth outcome that the client already expects as a redirect error."""


@dataclass(frozen=True)
class DirectoryCaller:
    email: str
    role: str
    is_super: bool


@dataclass
class IdentityService:
    entra: OAuthProvider
    google: OAuthProvider | None
    directory: IdentityDirectory
    issue_token: SessionIssuer
    verify_token: Callable[[str], Record | None]
    super_admin_email: str

    def complete_microsoft_login(self, auth_response: dict[str, str]) -> str:
        if "error" in auth_response:
            raise LoginRejected(auth_response.get("error_description", auth_response["error"]))
        result = self.entra.complete_login(auth_response)
        claims = result.get("id_token_claims", {})
        user_id = claims.get("oid", claims.get("sub", ""))
        name = claims.get("name", "")
        email = claims.get("preferred_username", claims.get("email", ""))
        return self._admit_user(user_id, name, email, "microsoft", ("temp", "", "microsoft", "azure-ad"))

    def complete_google_login(self, auth_response: dict[str, str]) -> str:
        if self.google is None:
            raise LoginRejected("google_auth_not_configured")
        result = self.google.complete_login(auth_response)
        user_id = result["user_id"] or result["email"]
        return self._admit_user(
            user_id, result["display_name"], result["email"], "google", ("temp", "", "google")
        )

    def _admit_user(
        self, user_id: str, name: str, email: str, provider: str, accepted_providers: tuple[str, ...]
    ) -> str:
        if not user_id:
            raise LoginRejected("missing_user_id")
        invite = self.directory.get_invite_by_email(email)
        existing = self.directory.get_user_by_email(email)
        if existing:
            existing_provider = existing.get("authProvider", "")
            if existing_provider and existing_provider not in accepted_providers:
                display_names = {"azure-ad": "Microsoft", "microsoft": "Microsoft", "google": "Google"}
                friendly = display_names.get(existing_provider, existing_provider)
                raise LoginRejected(
                    f"This email is already registered with {friendly}. Please use that login method instead."
                )
        elif invite:
            self.directory.promote_invited_user(
                email, user_id, auth_provider=provider, display_name=name
            )
        else:
            raise LoginRejected(
                "Access denied. Your account is not registered in the platform. Please contact an administrator."
            )
        return self.issue_token(user_id, name, email, provider=provider)

    def session_claims(self, token: str | None) -> Record:
        if not token:
            raise NotAuthenticated("Not authenticated")
        claims = self.verify_token(token)
        if not claims:
            raise NotAuthenticated("Invalid or expired session")
        return claims

    def session_profile(self, token: str | None) -> Record:
        claims = self.session_claims(token)
        return {
            "id": claims["sub"],
            "displayName": claims["name"],
            "email": claims["email"],
            "username": claims["email"],
            "provider": claims.get("provider", "microsoft"),
        }

    def resolve_caller(self, token: str | None) -> DirectoryCaller:
        claims = self.verify_token(token) if token else None
        if not claims:
            raise NotAuthenticated("Sign in required")
        email = (claims.get("email") or "").lower()
        is_super = bool(email) and email == self.super_admin_email.lower()
        if is_super:
            role = "admin"
        else:
            profile = self.directory.get_user_by_email(email) if email else None
            role = ((profile or {}).get("role") or "student").lower()
        return DirectoryCaller(email=email, role=role, is_super=is_super)

    def require_directory_admin(self, token: str | None) -> DirectoryCaller:
        caller = self.resolve_caller(token)
        if not caller.is_super and caller.role != "admin":
            raise AccessDenied("Admin access required")
        return caller

    def require_super_admin(self, token: str | None) -> None:
        claims = self.session_claims(token)
        if (claims.get("email") or "").lower() != self.super_admin_email.lower():
            raise AccessDenied("Only the super-admin can perform this action")
