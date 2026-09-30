// src/lib/useAuth.ts
// Hook for Microsoft authentication via backend Entra ID (MSAL Python).
// Replaces the previous frontend-only MSAL.js implementation.

import { useState, useCallback, useEffect } from "react";
import { useUserStore } from "./userStore";
import { useChatStore } from "./chatStore";
import { chatApi } from "./chatApi";
import { BYPASS_AUTH } from "@/components/auth/AuthGuard";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface MicrosoftUser {
  id: string;
  displayName: string;
  email: string;
  username: string;
  provider: "microsoft" | "google" | "azure-ad" | "oauth";
}

export type AuthMode = "signin" | "signup" | "continue";

// ── Token management ──────────────────────────────────
// Session token now lives in an HttpOnly cookie set by the backend.
// These stubs remain for backward-compat imports; they no longer touch localStorage.

/** @deprecated Token is now in HttpOnly cookie — this is a no-op. */
export function storeAuthToken(_token: string) {
  // Cookie is set by the backend redirect — nothing to do client-side.
}

/** Clear session by calling the backend logout endpoint (which deletes the cookie). */
export function clearAuthToken() {
  // Call backend to delete the cookie; fire-and-forget.
  fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
}

/**
 * @deprecated Token lives in HttpOnly cookie and is not readable by JS.
 * Returns null — callers should use credentials: "include" on fetch instead.
 */
export function getAuthToken(): string | null {
  return null;
}

// Module-level tracking to prevent multiple sync attempts
let globalSyncInProgress = false;
let globalSyncCompletedForToken: string | null = null;
let globalJustLoggedOut = false;

export function useAuth() {
  const [user, setUser] = useState<MicrosoftUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const { loginWithOAuth, logout: logoutStore, isAuthenticated: isStoreAuthenticated, userId: currentStoredUserId } = useUserStore();
  const { setUserName, setUserFullName, clearUserData } = useChatStore();

  const [isRegistered, setIsRegistered] = useState<boolean | null>(() => {
    if (isStoreAuthenticated) return true;
    if (globalSyncCompletedForToken) return true;
    if (globalJustLoggedOut) return false;
    return null;
  });

  // With HttpOnly cookies we can't check for a token client-side.
  // We rely on the syncAuthState effect to probe /auth/me on mount.

  // ── Fetch user profile from backend /auth/me ──
  const fetchAuthMe = useCallback(async (): Promise<MicrosoftUser | null> => {
    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401) {
          // No valid session cookie
          return null;
        }
        throw new Error(`Auth API error: ${response.status}`);
      }
      const data = await response.json();
      return {
        id: data.id,
        displayName: data.displayName || "User",
        email: data.email || "",
        username: data.username || data.email || "",
        provider: (data.provider || "microsoft") as MicrosoftUser["provider"],
      };
    } catch (err) {
      console.error("[Auth] Failed to fetch /auth/me:", err);
      return null;
    }
  }, []);

  // Check if user is registered in our backend (Cosmos DB)
  const checkUserRegistration = useCallback(async (userId: string): Promise<{ registered: boolean; backendError: boolean }> => {
    if (!userId) return { registered: false, backendError: true };
    try {
      const result = await chatApi.getUserProfile(userId);
      return { registered: result.success && result.profile !== null, backendError: false };
    } catch {
      return { registered: false, backendError: true };
    }
  }, []);

  // Register a new user in our backend
  const registerUser = useCallback(async (profile: MicrosoftUser): Promise<boolean> => {
    try {
      const result = await chatApi.updateUserProfile(profile.id, {
        fullName: profile.displayName,
        displayName: profile.displayName,
        nickname: profile.displayName.split(" ")[0],
        email: profile.email,
        authProvider: profile.provider,
      });
      return result.success;
    } catch {
      return false;
    }
  }, []);

  // ── Sync auth state: probe /auth/me (cookie auto-sent) + register user ──
  useEffect(() => {
    const syncAuthState = async () => {
      if (globalSyncInProgress) return;
      if (globalSyncCompletedForToken === "cookie") return;
      if (isRegistered !== null) return;

      console.log("[Auth] Starting auth sync...");
      globalSyncInProgress = true;
      setIsLoading(true);

      try {
        // Validate session with backend (cookie is sent automatically)
        const profile = await fetchAuthMe();
        if (!profile) {
          // No valid session — ensure we're logged out
          if (isStoreAuthenticated && !BYPASS_AUTH) {
            globalSyncCompletedForToken = null;
            logoutStore();
            setUser(null);
          }
          setIsRegistered(false);   // mark as "checked, not authenticated"
          setIsLoading(false);
          globalSyncInProgress = false;
          return;
        }

        console.log("[Auth] Got profile:", profile.displayName);

        // Directory gate is now enforced by the backend auth callback.
        // If the user got a valid session cookie, they are in the directory.

        // Check registration in Cosmos DB
        let registered = false;
        let backendError = false;
        try {
          const result = await checkUserRegistration(profile.id);
          registered = result.registered;
          backendError = result.backendError;
        } catch {
          backendError = true;
        }

        if (backendError) {
          setError("Unable to connect to the server. Please check if the backend is running and try again.");
          globalSyncInProgress = false;
          setIsLoading(false);
          return;
        }

        // Auto-register new users
        if (!registered) {
          console.log("[Auth] User not registered, auto-registering...");
          try {
            await registerUser(profile);
            setUserName(profile.displayName.split(" ")[0]);
            setUserFullName(profile.displayName);
          } catch {
            setError("Failed to create account. Please try again.");
            globalSyncInProgress = false;
            setIsLoading(false);
            return;
          }
        } else {
          // Load existing profile from database
          // Pass profile.id explicitly because loginWithOAuth hasn't set
          // userId in userStore yet (cleared on logout).
          try {
            const { loadUserProfileFromBackend } = await import("./chatStore");
            await loadUserProfileFromBackend(profile.id);
          } catch {
            // ignore — will fall through to OAuth fallback below
          }

          // If Cosmos profile had no fullName (e.g. invited without a name),
          // fall back to the OAuth display name from /auth/me.
          const { useChatStore } = await import("./chatStore");
          const loadedName = useChatStore.getState().userFullName;
          if (!loadedName && profile.displayName) {
            setUserFullName(profile.displayName);
            setUserName(profile.displayName.split(" ")[0]);
          }
        }

        // Handle different user login
        if (currentStoredUserId && currentStoredUserId !== profile.id) {
          clearUserData();
        }

        // Complete login
        setUser(profile);
        setIsRegistered(true);
        loginWithOAuth(profile.id, profile.displayName, profile.email, profile.provider);
        globalSyncCompletedForToken = "cookie";
        console.log("[Auth] Login completed successfully");
      } catch (err) {
        console.error("[Auth] Auth sync failed:", err);
        setError("Authentication failed. Please try again.");
      } finally {
        setIsLoading(false);
        globalSyncInProgress = false;
      }
    };

    if (BYPASS_AUTH) return;
    syncAuthState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStoreAuthenticated, isRegistered, fetchAuthMe, checkUserRegistration, registerUser, loginWithOAuth, logoutStore, setUserName, setUserFullName, clearUserData, retryCount]);

  // ── Login: redirect to backend /auth/login ──
  const continueWithMicrosoft = useCallback(() => {
    setIsLoading(true);
    setError(null);
    globalJustLoggedOut = false;
    // Redirect to backend auth endpoint
    window.location.href = `${API_BASE}/auth/login`;
  }, []);

  // ── Login with Google: redirect to backend /auth/google/login ──
  const continueWithGoogle = useCallback(() => {
    setIsLoading(true);
    setError(null);
    globalJustLoggedOut = false;
    window.location.href = `${API_BASE}/auth/google/login`;
  }, []);

  // Legacy aliases
  const signIn = continueWithMicrosoft;
  const signUp = continueWithMicrosoft;
  const loginWithPopup = continueWithMicrosoft;
  const loginWithRedirect = continueWithMicrosoft;

  // ── Logout ──
  const logout = useCallback(async () => {
    try {
      // Notify backend (stateless, but good practice)
      // Call backend to delete the session cookie
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
    } catch {
      // Ignore
    }
    // Clear local state
    logoutStore();
    clearUserData();
    globalSyncCompletedForToken = null;
    globalSyncInProgress = false;       // reset in case it was stuck
    globalJustLoggedOut = true;          // prevent pendingSync spinner on LoginPage
    setUser(null);
    setIsRegistered(false);             // false (not null) to avoid pendingSync spinner
    setError(null);
  }, [logoutStore, clearUserData]);

  const logoutWithRedirect = logout;

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Retry auth sync
  const retryAuth = useCallback(() => {
    setError(null);
    globalSyncInProgress = false;
    globalSyncCompletedForToken = null;
    setIsRegistered(null);
    setRetryCount(c => c + 1);
  }, []);

  // Consider us "loading" on initial mount before syncAuthState completes
  const pendingSync = isRegistered === null && !error && !isLoading;
  const isBusy = !BYPASS_AUTH && (pendingSync || isLoading);

  return {
    user,
    isAuthenticated: BYPASS_AUTH || isRegistered === true,
    isRegistered: BYPASS_AUTH ? true : isRegistered,
    isLoading: isBusy,
    error,
    isMsalAuthenticated: isRegistered === true, // Kept for backward compat
    continueWithMicrosoft,
    continueWithGoogle,
    signIn,
    signUp,
    loginWithPopup,
    loginWithRedirect,
    logout,
    logoutWithRedirect,
    clearError,
    retryAuth,
    accounts: [],        // Stub — no MSAL accounts
    activeAccount: null,  // Stub
  };
}
