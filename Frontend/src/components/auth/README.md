# components/auth

Sign-in, sign-out and route protection.

| Component | Purpose |
| --- | --- |
| [LoginPage.tsx](LoginPage.tsx) | Sign-in screen. |
| [SignInButton.tsx](SignInButton.tsx) | Starts the OAuth flow. |
| [AuthCallback.tsx](AuthCallback.tsx) | Handles the provider redirect and establishes the session. |
| [AuthGuard.tsx](AuthGuard.tsx) | Wraps protected routes and redirects unauthenticated users. |
| [SignOutPage.tsx](SignOutPage.tsx) | Clears the session. |
| [UserMenu.tsx](UserMenu.tsx) | Signed-in user menu. |

Two providers are supported — Microsoft Entra ID and Google — both using the
authorization-code flow with PKCE. The backend
([Backend/auth.py](../../../../Backend/auth.py)) completes the exchange and issues an
HS256 session JWT.

## `AuthGuard` is not a security boundary

It controls what the UI *shows*. Every protected API route re-verifies the session
server-side, and it must stay that way: a client-side guard can be bypassed by anyone with
developer tools, so removing a server-side check because the guard exists reintroduces the
vulnerability. Roles resolved through [../../hooks/useUserRole.ts](../../hooks/useUserRole.ts)
are likewise presentational — the backend enforces the real permission.

Client ids come from `VITE_AZURE_CLIENT_ID` and `VITE_AZURE_TENANT_ID`. Everything
prefixed `VITE_` is inlined into the browser bundle at build time and is therefore
**public** — never put a client secret in one.
