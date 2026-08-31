// src/lib/useAuth.ts
// Simplified auth hook for the Dashboard frontend.
// Uses HttpOnly cookies with the main backend /auth/me endpoint.
// No chatStore dependency — all user state lives in userStore.

import { useState, useCallback, useEffect } from "react";
import { useUserStore } from "./userStore";
import { chatApi } from "./chatApi";

/** Auth calls go through Vite proxy → main backend (port 8000). */
const AUTH_BASE = "";

/** Set to true to bypass auth entirely during local development */
export const BYPASS_AUTH = false;

export interface MicrosoftUser {
  id: string;
  displayName: string;
  email: string;
  username: string;
  provider: "microsoft" | "google" | "azure-ad" | "oauth";
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

  const {
    loginWithOAuth,
    logout: logoutStore,
    isAuthenticated: isStoreAuthenticated,
    userId: currentStoredUserId,
    setDisplayName,
  } = useUserStore();

  const [isRegistered, setIsRegistered] = useState<boolean | null>(() => {
    if (isStoreAuthenticated) return true;
    if (globalSyncCompletedForToken) return true;
    if (globalJustLoggedOut) return false;
    return null;
  });

  // Fetch user profile from backend /auth/me
  const fetchAuthMe = useCallback(async (): Promise<MicrosoftUser | null> => {
    try {
      const response = await fetch(`${AUTH_BASE}/auth/me`, { credentials: "include" });
      if (!response.ok) {
        if (response.status === 401) return null;
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

  // Check if user is registered in Cosmos DB
  const checkUserRegistration = useCallback(async (userId: string): Promise<{ registered: boolean; backendError: boolean }> => {
    if (!userId) return { registered: false, backendError: true };
    try {
      const result = await chatApi.getUserProfile(userId);
      return { registered: result.success && result.profile !== null, backendError: false };
    } catch {
      return { registered: false, backendError: true };
    }
  }, []);

  // Register a new user in Cosmos DB
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

  // Sync auth state on mount
  useEffect(() => {
    const syncAuthState = async () => {
      if (globalSyncInProgress) return;
      if (globalSyncCompletedForToken === "cookie") return;
      if (isRegistered === true) return;

      globalSyncInProgress = true;
      setIsLoading(true);

      try {
        const profile = await fetchAuthMe();
        if (!profile) {
          if (isStoreAuthenticated && !BYPASS_AUTH) {
            globalSyncCompletedForToken = null;
            logoutStore();
            setUser(null);
          }
          setIsRegistered(false);
          setIsLoading(false);
          globalSyncInProgress = false;
          return;
        }

        // Check registration
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
          try {
            await registerUser(profile);
          } catch {
            setError("Failed to create account. Please try again.");
            globalSyncInProgress = false;
            setIsLoading(false);
            return;
          }
        }

        // Handle different user login
        if (currentStoredUserId && currentStoredUserId !== profile.id) {
          // Different user — clear store
          logoutStore();
        }

        // Complete login
        setUser(profile);
        setIsRegistered(true);
        loginWithOAuth(profile.id, profile.displayName, profile.email, profile.provider);
        setDisplayName(profile.displayName);
        globalSyncCompletedForToken = "cookie";
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
  }, [isStoreAuthenticated, isRegistered, fetchAuthMe, checkUserRegistration, registerUser, loginWithOAuth, logoutStore, setDisplayName, retryCount]);

  // Login: redirect to backend /auth/login
  const continueWithMicrosoft = useCallback(() => {
    setIsLoading(true);
    setError(null);
    globalJustLoggedOut = false;
    window.location.href = `${AUTH_BASE}/auth/login`;
  }, []);

  const continueWithGoogle = useCallback(() => {
    setIsLoading(true);
    setError(null);
    globalJustLoggedOut = false;
    window.location.href = `${AUTH_BASE}/auth/google/login`;
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      await fetch(`${AUTH_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
    } catch {
      // Ignore
    }
    logoutStore();
    globalSyncCompletedForToken = null;
    globalSyncInProgress = false;
    globalJustLoggedOut = true;
    setUser(null);
    setIsRegistered(false);
    setError(null);
  }, [logoutStore]);

  const clearError = useCallback(() => setError(null), []);

  const retryAuth = useCallback(() => {
    setError(null);
    globalSyncInProgress = false;
    globalSyncCompletedForToken = null;
    setIsRegistered(null);
    setRetryCount(c => c + 1);
  }, []);

  const pendingSync = isRegistered === null && !error && !isLoading;
  const isBusy = !BYPASS_AUTH && (pendingSync || isLoading);

  return {
    user,
    isAuthenticated: BYPASS_AUTH || isRegistered === true,
    isRegistered: BYPASS_AUTH ? true : isRegistered,
    isLoading: isBusy,
    error,
    continueWithMicrosoft,
    continueWithGoogle,
    logout,
    clearError,
    retryAuth,
  };
}
