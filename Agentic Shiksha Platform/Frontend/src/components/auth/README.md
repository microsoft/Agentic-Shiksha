# components/auth

Sign-in, sign-out and route protection.

| Component | Purpose |
| --- | --- |
| [LoginPage.tsx](LoginPage.tsx) | Sign-in screen. |
| [SignInButton.tsx](SignInButton.tsx) | Starts the OAuth flow. |
| [AuthCallback.tsx](AuthCallback.tsx) | Handles provider-return navigation and invalidates cached agent data; the backend owns the session exchange. |
| [AuthGuard.tsx](AuthGuard.tsx) | Wraps protected routes and redirects unauthenticated users. |
| [SignOutPage.tsx](SignOutPage.tsx) | Requests server logout and clears local account state. |
| [UserMenu.tsx](UserMenu.tsx) | Signed-in user menu. |

Microsoft Entra ID and Google sign-in are mediated by the backend.
[useAuth.ts](../../lib/useAuth.ts) starts the login flow through `VITE_API_URL`
and reads the resulting HttpOnly session with `/auth/me`. The backend
([auth.py](../../../../Backend/auth.py)) owns provider exchange and session handling.

## `AuthGuard` is not a security boundary

It controls what the UI *shows*. It does not establish that every API called by a
protected screen verifies a session or enforces the same role restrictions.
Enforcement is endpoint-specific; the
[workflow audit](../../../../../docs/workflows/README.md) records the actual
checks, scope and legacy gaps. Server-side checks remain necessary because a
client-side guard can be bypassed.

Roles resolved through [../../hooks/useUserRole.ts](../../hooks/useUserRole.ts)
are likewise presentational. Logout clears local state even if the server request
fails, so a signed-out screen alone is not proof of server-session revocation.

The frontend [msalConfig.ts](../../lib/msalConfig.ts) is now a compatibility stub.
Historical `VITE_AZURE_*` values in the example do not replace the backend's OAuth
configuration. Everything prefixed `VITE_` is inlined into the browser bundle at
build time and is therefore **public**; never put a client secret in one.
See [installation](../../../../../INSTALL.md#main-frontend) for origin/cookie setup.
