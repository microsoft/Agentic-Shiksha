// src/lib/userStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type UserRole, DEFAULT_ROLE } from "./roles";

const TEMP_USER_KEY = "ekalaiva.temp.userId";

function generateTempUserId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now().toString(36);
  return `temp_${random}_${timestamp}`;
}

export interface UserState {
  userId: string | null;
  displayName: string;
  email: string | null;
  authProvider: "temp" | "oauth" | "azure-ad" | "microsoft" | "google";
  role: UserRole;
  isAuthenticated: boolean;
  initializeTempUser: () => string;
  setDisplayName: (name: string) => void;
  setEmail: (email: string | null) => void;
  setRole: (role: UserRole) => void;
  logout: () => void;
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
        if (state.userId) return state.userId;
        const existingTempId = localStorage.getItem(TEMP_USER_KEY);
        if (existingTempId) {
          set({ userId: existingTempId, authProvider: "temp", isAuthenticated: true });
          return existingTempId;
        }
        const newUserId = generateTempUserId();
        localStorage.setItem(TEMP_USER_KEY, newUserId);
        set({ userId: newUserId, authProvider: "temp", isAuthenticated: true });
        return newUserId;
      },

      setDisplayName: (name) => set({ displayName: name }),
      setEmail: (email) => set({ email }),
      setRole: (role) => set({ role }),

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

      loginWithOAuth: (userId, displayName, email, provider) => {
        localStorage.removeItem(TEMP_USER_KEY);
        set({ userId, displayName, email, authProvider: provider, isAuthenticated: true });
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

export function useCurrentUserId(): string {
  const { userId, initializeTempUser } = useUserStore();
  if (!userId) return initializeTempUser();
  return userId;
}
