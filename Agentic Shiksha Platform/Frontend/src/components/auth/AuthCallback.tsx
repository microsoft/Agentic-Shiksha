// src/components/auth/AuthCallback.tsx
// Handles the redirect from backend /auth/callback.
// The session cookie is already set by the backend — just navigate to /home
// so useAuth's syncAuthState picks up the session via /auth/me.

import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const error = searchParams.get("error");

    if (error) {
      console.error("[AuthCallback] Auth error:", error);
      navigate(`/auth?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }

    // Session cookie was set by the backend redirect — go to /home
    // Invalidate agent cache so a fresh user-scoped list is fetched
    import("@/lib/api").then(({ invalidateAgentCache }) => invalidateAgentCache());
    console.log("[AuthCallback] Session cookie set, redirecting to /home");
    navigate("/home", { replace: true });
  }, [searchParams, navigate]);

  return (
    <div className="fixed inset-0 min-h-screen w-screen bg-neutral-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-neutral-400 text-sm">Completing sign in...</p>
      </div>
    </div>
  );
}
