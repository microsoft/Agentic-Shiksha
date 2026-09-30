// src/lib/userStore.ts
// Temporary user identification - will be replaced with OAuth later
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type UserRole, DEFAULT_ROLE } from "./roles";
import { randomToken } from "./secureId";

const TEMP_USER_KEY = "ekalaiva.temp.userId";

function generateTempUserId(): string {
  // Generate a temporary user ID
  // Format: temp_<random>_<timestamp>
  const random = randomToken(8);
  const timestamp = Date.now().toString(36);
  return `temp_${random}_${timestamp}`;
}

export interface UserState {
  // Current user ID (temp key for now, will be OAuth user ID later)
  userId: string | null;
  
  // Display name (user can set this)
  displayName: string;
  
  // Email (will come from OAuth later)
  email: string | null;
  
  // Auth provider (temp, oauth, azure-ad, microsoft, google)
  authProvider: "temp" | "oauth" | "azure-ad" | "microsoft" | "google";
  
  // User role (student, teacher, admin)
  role: UserRole;
  
  // Whether user is "logged in" (has a userId)
  isAuthenticated: boolean;
  
  // Actions
  initializeTempUser: () => string;
  setDisplayName: (name: string) => void;
  setEmail: (email: string | null) => void;
  setRole: (role: UserRole) => void;
  logout: () => void;
  
  // For future OAuth integration
  loginWithOAuth: (userId: string, displayName: string, email: string, provider: "oauth" | "azure-ad" | "microsoft" | "google") => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      userId: null,
      displayName: "Guest User",
      email: null,
      authProvider: "temp",
      role: DEFAULT_ROLE,
      isAuthenticated: false,

      initializeTempUser: () => {
        const state = get();
        
        // If already has a user ID, return it
        if (state.userId) {
          return state.userId;
        }
        
        // Check if there's an existing temp ID in localStorage (migration)
        const existingTempId = localStorage.getItem(TEMP_USER_KEY);
        if (existingTempId) {
          set({
            userId: existingTempId,
            authProvider: "temp",
            isAuthenticated: true,
          });
          return existingTempId;
        }
        
        // Generate new temp user ID
        const newUserId = generateTempUserId();
        localStorage.setItem(TEMP_USER_KEY, newUserId);
        
        set({
          userId: newUserId,
          authProvider: "temp",
          isAuthenticated: true,
        });
        
        return newUserId;
      },

      setDisplayName: (name) => {
        set({ displayName: name });
      },

      setEmail: (email) => {
        set({ email });
      },

      setRole: (role) => {
        set({ role });
      },

      logout: () => {
        localStorage.removeItem(TEMP_USER_KEY);
        set({
          userId: null,
          displayName: "Guest User",
          email: null,
          authProvider: "temp",
          role: DEFAULT_ROLE,
          isAuthenticated: false,
        });
      },

      // For future OAuth integration
      // Call this when OAuth login succeeds
      loginWithOAuth: (userId, displayName, email, provider) => {
        const state = get();
        const previousUserId = state.userId;
        
        // Clear any temp user ID
        localStorage.removeItem(TEMP_USER_KEY);
        
        // If a DIFFERENT user is logging in, we need to clear chat data
        // This will be handled by the auth hook which calls clearUserData
        // We just need to track if this is a different user
        const isDifferentUser = previousUserId && previousUserId !== userId;
        if (isDifferentUser) {
          console.log(`[UserStore] Different user logging in: ${previousUserId} -> ${userId}`);
          // The chat store's clearUserData should be called by the auth hook
        }
        
        set({
          userId,
          displayName,
          email,
          authProvider: provider,
          isAuthenticated: true,
        });
      },
    }),
    {
      name: "ekalaiva.user.v1",
      version: 1,
      partialize: (s) => ({
        userId: s.userId,
        displayName: s.displayName,
        email: s.email,
        authProvider: s.authProvider,
        role: s.role,
        isAuthenticated: s.isAuthenticated,
      }),
    }
  )
);

// Helper hook to get current user ID (auto-initializes if needed)
export function useCurrentUserId(): string {
  const { userId, initializeTempUser } = useUserStore();
  
  if (!userId) {
    return initializeTempUser();
  }
  
  return userId;
}
