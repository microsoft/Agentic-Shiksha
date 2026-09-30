"""
Google OAuth 2.0 authentication using Authorization Code flow with PKCE.

Same pattern as EntraAuth but pointed at Google's endpoints.
"""

import logging
import secrets
import hashlib
import base64
from urllib.parse import urlencode

import httpx

log = logging.getLogger("ekalaiva.google_auth")

# Google OAuth 2.0 endpoints
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


class GoogleAuth:
    """Google OAuth with PKCE (no client_secret needed for public clients)."""

    def __init__(self, client_id: str, redirect_uri: str, client_secret: str = ""):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

        # Store pending auth flows: state -> {code_verifier, ...}
        self._pending_flows: dict[str, dict] = {}
        log.info("Google Auth initialized (Authorization Code + PKCE)")

    @staticmethod
    def _generate_pkce() -> tuple[str, str]:
        """Generate a PKCE code_verifier and code_challenge."""
        code_verifier = secrets.token_urlsafe(64)  # 86 chars
        digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
        code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        return code_verifier, code_challenge

    def get_login_url(self, state: str = "") -> str:
        """Generate Google OAuth login URL with PKCE."""
        flow_state = state or secrets.token_urlsafe(32)
        code_verifier, code_challenge = self._generate_pkce()

        # Store the flow so we can verify it in the callback
        self._pending_flows[flow_state] = {
            "code_verifier": code_verifier,
            "state": flow_state,
        }

        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": flow_state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "access_type": "online",
            "prompt": "select_account",
        }

        url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
        log.info("Google auth flow created (state=%s..., %d pending)", flow_state[:8], len(self._pending_flows))
        return url

    def complete_login(self, query_params: dict) -> dict:
        """
        Complete the Google OAuth flow with the callback query params.
        Returns user info dict with keys: email, display_name, user_id.
        Raises ValueError on any failure.
        """
        state = query_params.get("state", "")
        error = query_params.get("error", "")

        if error:
            desc = query_params.get("error_description", error)
            raise ValueError(f"Google auth error: {desc}")

        log.info("Google auth callback (state=%s..., %d pending flows)", state[:8], len(self._pending_flows))
        flow = self._pending_flows.pop(state, None)
        if not flow:
            raise ValueError("Unknown auth state — no matching Google auth flow found")

        code = query_params.get("code", "")
        if not code:
            raise ValueError("No authorization code in Google callback")

        # Exchange the authorization code for tokens
        log.info("Exchanging Google auth code for token...")
        token_data = {
            "client_id": self.client_id,
            "code": code,
            "code_verifier": flow["code_verifier"],
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri,
        }
        # Google requires client_secret even for web apps
        if self.client_secret:
            token_data["client_secret"] = self.client_secret

        with httpx.Client(timeout=30) as client:
            token_resp = client.post(GOOGLE_TOKEN_URL, data=token_data)

        if token_resp.status_code != 200:
            raise ValueError(f"Google token exchange failed: {token_resp.status_code} {token_resp.text}")

        tokens = token_resp.json()

        if "error" in tokens:
            desc = tokens.get("error_description", tokens["error"])
            raise ValueError(f"Google token error: {desc}")

        access_token = tokens.get("access_token", "")
        if not access_token:
            raise ValueError("No access_token in Google token response")

        log.info("Google token acquired successfully")

        # Fetch user info from Google's userinfo endpoint
        with httpx.Client(timeout=15) as client:
            userinfo_resp = client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if userinfo_resp.status_code != 200:
            raise ValueError(f"Google userinfo request failed: {userinfo_resp.status_code}")

        userinfo = userinfo_resp.json()
        email = userinfo.get("email", "").lower()
        display_name = userinfo.get("name", email.split("@")[0])
        user_id = userinfo.get("sub", "")  # Google's unique user ID

        if not email:
            raise ValueError("No email in Google userinfo response")

        log.info("Google user identified: %s (%s)", display_name, email)
        return {
            "email": email,
            "display_name": display_name,
            "user_id": user_id,
        }
