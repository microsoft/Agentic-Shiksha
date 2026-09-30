// src/components/auth/AuthGuard.tsx
// Wraps the app to require authentication before showing content

import { ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/useAuth";
import { useUserStore } from "@/lib/userStore";
import { useChatStore } from "@/lib/chatStore";
import { PENDING_JOIN_CODE_KEY } from "@/pages/JoinAgentPage";
import { Loader2 } from "lucide-react";

// ⚠️ TEMPORARY: Set to true to bypass authentication for testing
export const BYPASS_AUTH = false;

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading, error, retryAuth, isMsalAuthenticated } = useAuth();
  const initializeTempUser = useUserStore((s) => s.initializeTempUser);
  const userId = useUserStore((s) => s.userId);
  const onboardingCompleted = useChatStore((s) => s.onboardingCompleted);
  const userStatus = useChatStore((s) => s.userStatus);
  const location = useLocation();
  
  // If bypassing auth, initialize temp user automatically (only once on mount)
  useEffect(() => {
    if (BYPASS_AUTH) {
      const id = initializeTempUser();
      console.log("[AuthGuard] Bypass auth - initialized temp user:", id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount
  
  // If bypassing auth, just show children after temp user is ready
  if (BYPASS_AUTH) {
    // Check store directly in case component hasn't re-rendered yet
    const storeUserId = useUserStore.getState().userId;
    if (!userId && !storeUserId) {
      return (
        <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-neutral-400 text-sm">Initializing...</p>
          </div>
        </div>
      );
    }
    return <>{children}</>;
  }

  // Show loading spinner during initial auth check
  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-neutral-400 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // If token exists but sync failed, show error with retry
  if (error && isMsalAuthenticated) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center px-4">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <p className="text-neutral-300 text-sm">{error}</p>
          <button
            onClick={retryAuth}
            className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-medium rounded-lg border border-neutral-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Redirect to auth page if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  // Redirect to onboarding if the user hasn't completed it yet
  // (skip this check when already on the /onboarding page)
  if (!onboardingCompleted && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  // After onboarding, wait for the backend to promote the user to "active".
  // While status is still "invited" (sync in progress), show a brief spinner.
  // An empty string means the status hasn't been loaded yet — allow through
  // so the normal app flow / profile load can proceed.
  if (userStatus === "invited" && onboardingCompleted && location.pathname !== "/onboarding") {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-neutral-400 text-sm">Setting up your account…</p>
        </div>
      </div>
    );
  }

  // Signing in from an invite link lands here, not back on the link itself.
  // Runs after onboarding so a brand-new account is set up before it joins.
  const pendingJoinCode = sessionStorage.getItem(PENDING_JOIN_CODE_KEY);
  if (pendingJoinCode && !location.pathname.startsWith("/join/")) {
    return <Navigate to={`/join/${pendingJoinCode}`} replace />;
  }

  // Show the app if authenticated
  return <>{children}</>;
}
