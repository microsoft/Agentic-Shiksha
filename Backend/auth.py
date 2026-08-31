# auth.py
# Server-side Microsoft Entra ID authentication using MSAL Python with PKCE.
# Replaces the frontend-only MSAL.js (@azure/msal-browser) implementation.

import msal
import jwt
import os
import time
import logging
from typing import Optional, Dict

logger = logging.getLogger(__name__)

# ===================== JWT Configuration =====================
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is required")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_SECONDS = 86400 * 7  # 7 days


class EntraAuth:
    """
    Server-side Microsoft Entra ID authentication using MSAL Python with PKCE.

    Flow:
      1. Frontend redirects to backend /auth/login
      2. Backend generates auth URL via get_login_url() and redirects to Microsoft
      3. Microsoft authenticates and redirects to backend /auth/callback
      4. Backend completes auth via complete_login(), creates JWT, redirects to frontend
    """

    def __init__(self, client_id: str, tenant_id: str, redirect_uri: str):
        self.client_id = client_id
        self.tenant_id = tenant_id
        self.redirect_uri = redirect_uri
        self._pending_flows: Dict[str, dict] = {}

        # Use "common" authority to allow both organizational AND personal
        # Microsoft accounts. If a specific tenant is supplied, restrict to it.
        authority = f"https://login.microsoftonline.com/{tenant_id}"
        logger.info("EntraAuth authority: %s", authority)

        self.app = msal.PublicClientApplication(
            client_id=client_id,
            authority=authority,
        )

    def get_login_url(self, state: Optional[str] = None) -> str:
        """Generate a Microsoft Entra ID login URL with PKCE."""
        flow = self.app.initiate_auth_code_flow(
            scopes=["User.Read"],
            redirect_uri=self.redirect_uri,
            state=state,
        )
        self._pending_flows[flow["state"]] = flow
        return flow["auth_uri"]

    def complete_login(self, auth_response: dict) -> dict:
        """Complete the PKCE auth code flow with the response from Microsoft."""
        state = auth_response.get("state")
        flow = self._pending_flows.pop(state, None)
        if not flow:
            raise ValueError("Unknown auth state — no matching auth flow found")

        result = self.app.acquire_token_by_auth_code_flow(flow, auth_response)
        if "error" in result:
            error_desc = result.get("error_description", result["error"])
            raise ValueError(f"Authentication error: {error_desc}")

        return result


# ===================== JWT Session Tokens =====================

def create_session_token(user_id: str, name: str, email: str, provider: str = "microsoft") -> str:
    """Create a JWT session token after successful authentication."""
    payload = {
        "sub": user_id,
        "name": name,
        "email": email,
        "provider": provider,
        "iat": int(time.time()),
        "exp": int(time.time()) + JWT_EXPIRY_SECONDS,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_session_token(token: str) -> Optional[dict]:
    """Verify and decode a JWT session token. Returns None on failure."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        logger.warning("Session token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning("Invalid session token: %s", e)
        return None
