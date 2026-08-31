// src/lib/chatStore.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StoreApi, UseBoundStore } from "zustand";
import type { ChatContext, ChatMessage, ChatThread, Project, Mode, BuilderKind, ResearchData } from "./types";
import { chatApi } from "./chatApi";
import { useUserStore } from "./userStore";

function uid() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `id_${Math.random().toString(36).slice(2)}_${Date.now()}`
  );
}
const now = () => Date.now();

/**
 * Compute a simple hash of the user's profile fields used for agent injection.
 * Returns a short numeric string. When the profile changes, the hash changes,
 * signaling that the profile needs to be re-injected into the conversation.
 */
export function computeProfileHash(state: {
  userName: string;
  userNickname: string;
  userFullName: string;
  userWorkFunction: string;
  userPreferences: string;
  userCustomInstructions: string;
  userDepartment: string;
  userCollege: string;
}): string {
  const raw = [
    state.userFullName,
    state.userName,
    state.userNickname,
    state.userWorkFunction,
    state.userPreferences,
    state.userCustomInstructions,
    state.userDepartment,
    state.userCollege,
  ].join("|");
  // Simple djb2 hash
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
  }
  return String(Math.abs(hash));
}

// Lock to prevent concurrent thread creation for the same agent
// Maps agentId -> threadId being created (or recently created)
const threadCreationLock = new Map<string, string>();

// Helper to delete from backend (fire and forget)
async function deleteThreadFromBackend(threadId: string) {
  try {
    const userId = useUserStore.getState().userId;
    if (!userId) {
      console.warn(`[deleteThread] No userId available, cannot delete thread ${threadId} from backend`);
      return;
    }
    const result = await chatApi.deleteThread(threadId, userId);
    if (result.success) {
      console.log(`[deleteThread] Deleted thread ${threadId} from backend`);
    } else {
      console.warn(`[deleteThread] Backend returned success=false for thread ${threadId}`);
    }
  } catch (error) {
    console.error(`[deleteThread] Failed to delete thread ${threadId} from backend:`, error);
  }
}

// Helper to update thread title in backend (fire and forget)
async function updateThreadTitleInBackend(threadId: string, title: string) {
  try {
    const userId = useUserStore.getState().userId;
    if (!userId) {
      console.warn(`[updateThreadTitle] No userId available, cannot update thread ${threadId} title`);
      return;
    }
    const result = await chatApi.updateThread(threadId, userId, { title });
    if (result.success) {
      console.log(`[updateThreadTitle] Updated thread ${threadId} title to "${title}" in backend`);
    } else {
      console.warn(`[updateThreadTitle] Backend returned success=false for thread ${threadId}`);
    }
  } catch (error) {
    console.error(`[updateThreadTitle] Failed to update thread ${threadId} title in backend:`, error);
  }
}

// Debounce timer for user profile sync
let userProfileSyncTimer: ReturnType<typeof setTimeout> | null = null;

// Helper to sync user profile to backend (debounced)
async function syncUserProfileToBackend() {
  // Clear any pending sync
  if (userProfileSyncTimer) {
    clearTimeout(userProfileSyncTimer);
  }
  
  // Debounce: wait 1 second before syncing to avoid too many API calls
  userProfileSyncTimer = setTimeout(async () => {
    try {
      const userId = useUserStore.getState().userId;
      if (!userId) return;
      
      const state = useChatStore.getState();
      const userState = useUserStore.getState();
      await chatApi.updateUserProfile(userId, {
        fullName: state.userFullName,
        displayName: state.userName,
        nickname: state.userNickname,
        workFunction: state.userWorkFunction,
        preferences: state.userPreferences,
        customInstructions: state.userCustomInstructions,
        learningProfile: state.userLearningProfile,
        department: state.userDepartment,
        college: state.userCollege,
        language: state.userLanguage,
        currentLocation: state.userCurrentLocation,
        interests: state.userInterests,
        passionateAbout: state.userPassionateAbout,
        onboardingCompleted: state.onboardingCompleted,
        // Include authProvider from user store to preserve it
        authProvider: userState.authProvider,
      });
      console.log("[UserProfile] Synced to Cosmos DB");
    } catch (error) {
      console.error("[UserProfile] Failed to sync to Cosmos DB:", error);
    }
  }, 1000);
}

/**
 * Flush any pending debounced profile sync immediately.
 * Call this when you need to guarantee the profile is saved
 * before navigating away (e.g., after onboarding).
 */
export async function flushUserProfileSync(): Promise<void> {
  if (userProfileSyncTimer) {
    clearTimeout(userProfileSyncTimer);
    userProfileSyncTimer = null;
  }
  try {
    const userId = useUserStore.getState().userId;
    if (!userId) return;
    const state = useChatStore.getState();
    const userState = useUserStore.getState();
    const result = await chatApi.updateUserProfile(userId, {
      fullName: state.userFullName,
      displayName: state.userName,
      nickname: state.userNickname,
      workFunction: state.userWorkFunction,
      preferences: state.userPreferences,
      customInstructions: state.userCustomInstructions,
      learningProfile: state.userLearningProfile,
      department: state.userDepartment,
      college: state.userCollege,
      language: state.userLanguage,
      currentLocation: state.userCurrentLocation,
      interests: state.userInterests,
      passionateAbout: state.userPassionateAbout,
      onboardingCompleted: state.onboardingCompleted,
      authProvider: userState.authProvider,
    });
    // Update userStatus from backend response (e.g., promoted from "invited" → "active")
    if (result.success && result.profile?.status) {
      useChatStore.setState({ userStatus: result.profile.status });
    }
    console.log("[UserProfile] Flushed sync to Cosmos DB, status:", result.profile?.status);
  } catch (error) {
    console.error("[UserProfile] Failed to flush sync to Cosmos DB:", error);
  }
}

// Load user profile from backend on startup
export async function loadUserProfileFromBackend(overrideUserId?: string): Promise<void> {
  try {
    const userId = overrideUserId || useUserStore.getState().userId;
    if (!userId) return;
    
    const response = await chatApi.getUserProfile(userId);
    if (response.success && response.profile) {
      const profile = response.profile;
      const isStudent = profile.role === "student";
      // For students, name fields are stored as "student_name" placeholder in Cosmos (privacy).
      // Only overwrite local name cache from backend for non-students.
      const nameUpdates = isStudent
        ? {}  // keep whatever is in browser localStorage
        : {
            userFullName: profile.fullName || "",
            userName: profile.displayName || "User",
            userNickname: profile.nickname || "",
          };
      useChatStore.setState({
        ...nameUpdates,
        userWorkFunction: profile.workFunction || "",
        userPreferences: profile.preferences || "",
        userCustomInstructions: profile.customInstructions || "",
        userLearningProfile: profile.learningProfile || "",
        userDepartment: profile.department || "",
        userCollege: profile.college || "",
        userLanguage: profile.language || "",
        userCurrentLocation: profile.currentLocation || "",
        userInterests: profile.interests || "",
        userPassionateAbout: profile.passionateAbout || "",
        onboardingCompleted: profile.onboardingCompleted || false,
        userStatus: (profile as any).status || "",
      });
      // Sync role from backend profile to userStore
      if (profile.role) {
        useUserStore.getState().setRole(profile.role as import("./roles").UserRole);
      }
      console.log("[UserProfile] Loaded from Cosmos DB:", profile.fullName || profile.displayName, "role:", profile.role, "status:", (profile as any).status);
    }
  } catch (error) {
    console.error("[UserProfile] Failed to load from Cosmos DB:", error);
  }
}

function defaultProject(): Project {
  const t = now();
  return { id: "my-project-1", name: "My Project - 1", createdAt: t, updatedAt: t };
}

function defaultContext(projectId = "my-project-1"): ChatContext {
  return {
    projectId,
    mode: "course",
    courseSlug: "",
    agentName: "",  // Will be set when a course is selected
  };
}

export type ChatState = {
  projects: Record<string, Project>;
  threads: Record<string, ChatThread>;
  messagesByThreadId: Record<string, ChatMessage[]>;
  
  // Active research sessions by thread ID (persisted for navigation)
  activeResearchByThreadId: Record<string, ResearchData>;

  // Profile hash tracking: maps threadId -> last injected profile hash
  // Used to avoid re-injecting profile on every message
  profileHashByThreadId: Record<string, string>;

  activeProjectId: string;
  activeContext: ChatContext;
  activeThreadId: string | null;

  // User profile
  userFullName: string;  // Full name (e.g., "Swapnik Katkoori")
  userName: string;      // Display name (e.g., "Swapnik")
  userNickname: string;
  userWorkFunction: string;  // Communication tone/style
  userPreferences: string;   // "More about you" - background, interests
  userCustomInstructions: string;  // Custom instructions for agent behavior
  userLearningProfile: string;  // JSON string with proficiency, goals, skills
  userDepartment: string;  // Academic department
  userCollege: string;  // College or university
  userLanguage: string;  // Mother tongue / most spoken language other than English
  userCurrentLocation: string;
  userInterests: string;
  userPassionateAbout: string;
  onboardingCompleted: boolean;
  userStatus: "invited" | "active" | "";  // Directory status — platform gated on "active"
  userAffiliations: Array<{ institute: string; department: string; role: string }>;
  userActiveAffiliation: number;
  uiLanguage: string;  // UI language ("default" = browser locale)
  responseLanguage: string;  // AI response language ("auto" = detect input)
  setUiLanguage: (lang: string) => void;
  setResponseLanguage: (lang: string) => void;
  setUserFullName: (name: string) => void;
  setUserName: (name: string) => void;
  setUserNickname: (nickname: string) => void;
  setUserDepartment: (department: string) => void;
  setUserCollege: (college: string) => void;
  setUserLanguage: (language: string) => void;
  setUserCurrentLocation: (location: string) => void;
  setUserInterests: (interests: string) => void;
  setUserPassionateAbout: (about: string) => void;
  setOnboardingCompleted: (completed: boolean) => void;
  setUserWorkFunction: (fn: string) => void;
  setUserPreferences: (prefs: string) => void;
  setUserCustomInstructions: (instructions: string) => void;
  setUserLearningProfile: (profile: string) => void;

  ensureBootstrap: () => void;
  setActiveProject: (projectId: string) => void;
  setActiveContext: (patch: Partial<ChatContext> & { mode?: Mode }) => void;

  createProject: (name: string) => string;
  renameProject: (projectId: string, name: string) => void;

  // ✅ Agent project management
  getOrCreateAgentProject: (agentId: string, agentName: string, agentKind?: "course") => string;
  getProjectByAgentId: (agentId: string) => Project | undefined;
  getProjectByAgentName: (agentName: string) => Project | undefined;
  updateProjectAgentId: (projectId: string, newAgentId: string) => void;
  getThreadsForAgent: (agentId: string) => ChatThread[];
  createThreadForAgent: (agentId: string, title?: string, forceNew?: boolean) => string;

  createThread: (overrides?: Partial<ChatContext>, title?: string) => string;

  // ✅ new
  ensureThreadWithId: (threadId: string, overrides?: Partial<ChatContext>, title?: string) => string;
  migrateThreadId: (fromId: string, toId: string, opts?: { keepTitle?: boolean }) => void;
  clearThreadMessages: (threadId: string) => void;
  updateMessageAt: (threadId: string, index: number, patch: Partial<Pick<ChatMessage, "content" | "createdAt" | "imageUrls">>) => void;
  // Mark messages from a given index onwards as not latest (for edit functionality)
  markMessagesNotLatest: (threadId: string, fromIndex: number) => void;
  replaceLastAssistant: (
    threadId: string,
    msg: Omit<ChatMessage, "id" | "createdAt">
  ) => void;
  // Truncate messages after a given index (exclusive - keeps messages up to and including index)
  truncateMessagesAfter: (threadId: string, keepUpToIndex: number) => void;

  setActiveThread: (threadId: string | null) => void;
  setThreadSessionUuid: (threadId: string, sessionUuid: string) => void;
  renameThread: (threadId: string, title: string) => void;
  deleteThread: (threadId: string) => void;
  shareThread: (threadId: string) => Promise<string | null>; // Returns share token or null
  unshareThread: (threadId: string) => Promise<boolean>;
  deleteProject: (projectId: string) => void;
  cleanupEmptyThreads: () => void;
  cleanupDuplicateProjects: () => void;
  cleanupDuplicateThreads: () => void;
  cleanupStaleAgents: () => Promise<void>;
  
  // Clear all user-specific data (call on logout)
  clearUserData: () => void;

  appendMessage: (threadId: string, msg: Omit<ChatMessage, "id"> & { createdAt?: number }) => void;
  
  // Active research management (survives navigation)
  setActiveResearch: (threadId: string, research: ResearchData) => void;
  updateActiveResearch: (threadId: string, updates: Partial<ResearchData>) => void;
  clearActiveResearch: (threadId: string) => void;
  getActiveResearch: (threadId: string) => ResearchData | undefined;

  // Profile hash per thread (for injection optimization)
  setProfileHashForThread: (threadId: string, hash: string) => void;
  getProfileHashForThread: (threadId: string) => string | undefined;
  shouldInjectProfile: (threadId: string | null) => boolean;
};

export const useChatStore: UseBoundStore<StoreApi<ChatState>> = create<ChatState>()(
  persist(
    (set, get) => ({
      projects: {},
      
      // Active research sessions (not persisted to localStorage, but survives component unmount)
      activeResearchByThreadId: {},

      // Profile hash tracking per thread
      profileHashByThreadId: {},

      // User profile
      userName: "User",
      userNickname: "",
      userFullName: "",
      userWorkFunction: "",
      userPreferences: "",
      userCustomInstructions: "",
      userLearningProfile: "",
      userDepartment: "",
      userCollege: "",
      userLanguage: "",
      userCurrentLocation: "",
      userInterests: "",
      userPassionateAbout: "",
      onboardingCompleted: false,
      userStatus: "",
      userAffiliations: [],
      userActiveAffiliation: 0,
      uiLanguage: "default",
      responseLanguage: "auto",
      setUiLanguage: (lang) => {
        set({ uiLanguage: lang });
        syncUserProfileToBackend();
      },
      setResponseLanguage: (lang) => {
        set({ responseLanguage: lang });
        syncUserProfileToBackend();
      },
      setUserFullName: (name) => {
        set({ userFullName: name });
        // Sync to Cosmos DB (fire and forget)
        syncUserProfileToBackend();
      },
      setUserName: (name) => {
        set({ userName: name });
        // Sync to Cosmos DB (fire and forget)
        syncUserProfileToBackend();
      },
      setUserNickname: (nickname) => {
        set({ userNickname: nickname });
        syncUserProfileToBackend();
      },
      setUserWorkFunction: (fn) => {
        set({ userWorkFunction: fn });
        syncUserProfileToBackend();
      },
      setUserPreferences: (prefs) => {
        set({ userPreferences: prefs });
        syncUserProfileToBackend();
      },
      setUserCustomInstructions: (instructions) => {
        set({ userCustomInstructions: instructions });
        syncUserProfileToBackend();
      },
      setUserDepartment: (department) => {
        set({ userDepartment: department });
        syncUserProfileToBackend();
      },
      setUserCollege: (college) => {
        set({ userCollege: college });
        syncUserProfileToBackend();
      },
      setUserLanguage: (language) => {
        set({ userLanguage: language });
        syncUserProfileToBackend();
      },
      setUserCurrentLocation: (location) => {
        set({ userCurrentLocation: location });
        syncUserProfileToBackend();
      },
      setUserInterests: (interests) => {
        set({ userInterests: interests });
        syncUserProfileToBackend();
      },
      setUserPassionateAbout: (about) => {
        set({ userPassionateAbout: about });
        syncUserProfileToBackend();
      },
      setOnboardingCompleted: (completed) => {
        set({ onboardingCompleted: completed });
        syncUserProfileToBackend();
      },
      setUserLearningProfile: (profile) => {
        set({ userLearningProfile: profile });
        syncUserProfileToBackend();
      },
      threads: {},
      messagesByThreadId: {},

      activeProjectId: "my-project-1",
      activeContext: defaultContext("my-project-1"),
      activeThreadId: null,

      ensureBootstrap: () => {
        const s = get();
        if (Object.keys(s.projects).length === 0) {
          const p = defaultProject();
          set({
            projects: { [p.id]: p },
            activeProjectId: p.id,
            activeContext: defaultContext(p.id),
            activeThreadId: null,
          });
        }
        // Cleanup on app load
        get().cleanupEmptyThreads();
        get().cleanupDuplicateProjects();
        get().cleanupDuplicateThreads();
        // Async cleanup of stale agents (fire and forget)
        get().cleanupStaleAgents();
      },

      setActiveProject: (projectId) => {
        set((st) => ({
          activeProjectId: projectId,
          activeContext: { ...st.activeContext, projectId },
          activeThreadId: null,
        }));
      },

      setActiveContext: (patch) => {
        set((st) => ({
          activeContext: { ...st.activeContext, ...patch },
          activeThreadId: null,
        }));
      },

      createProject: (name) => {
        const id = uid();
        const t = now();
        const p: Project = { id, name, createdAt: t, updatedAt: t };
        set((st) => ({
          projects: { ...st.projects, [id]: p },
          activeProjectId: id,
          activeContext: defaultContext(id),
          activeThreadId: null,
        }));
        return id;
      },

      renameProject: (projectId, name) => {
        set((st) => {
          const p = st.projects[projectId];
          if (!p) return st;
          return {
            projects: { ...st.projects, [projectId]: { ...p, name, updatedAt: now() } },
          };
        });
      },

      // ✅ Get or create a project for a specific agent
      getOrCreateAgentProject: (agentId, agentName, agentKind) => {
        const st = get();
        const currentUserId = useUserStore.getState().userId;
        
        // Check if project already exists for this agent AND this user
        const existingProject = Object.values(st.projects).find((p) => 
          p.agentId === agentId && 
          (!p.userId || p.userId === currentUserId) // Match if no userId or matching userId
        );
        if (existingProject) {
          return existingProject.id;
        }

        // Create new project for this agent
        const id = uid();
        const t = now();
        const p: Project = {
          id,
          name: agentName,
          agentId,
          agentName,
          agentKind,
          userId: currentUserId || undefined, // Track which user owns this project
          createdAt: t,
          updatedAt: t,
        };
        set((s) => ({
          projects: { ...s.projects, [id]: p },
        }));
        return id;
      },

      // ✅ Get project by agent ID
      getProjectByAgentId: (agentId) => {
        const st = get();
        const currentUserId = useUserStore.getState().userId;
        return Object.values(st.projects).find((p) => 
          p.agentId === agentId &&
          (!p.userId || p.userId === currentUserId) // Match if no userId or matching userId
        );
      },

      // ✅ Get project by agent name (for finding stale projects)
      getProjectByAgentName: (agentName) => {
        const st = get();
        const currentUserId = useUserStore.getState().userId;
        const lowerName = agentName.toLowerCase();
        return Object.values(st.projects).find((p) => 
          (p.name?.toLowerCase() === lowerName || 
           p.agentName?.toLowerCase() === lowerName) &&
          (!p.userId || p.userId === currentUserId) // Match if no userId or matching userId
        );
      },

      // ✅ Update project's agent ID (when agent is recreated in Azure)
      updateProjectAgentId: (projectId, newAgentId) => {
        set((st) => {
          const p = st.projects[projectId];
          if (!p) return st;
          return {
            projects: { 
              ...st.projects, 
              [projectId]: { ...p, agentId: newAgentId, updatedAt: now() } 
            },
          };
        });
      },

      // ✅ Get all threads for a specific agent
      getThreadsForAgent: (agentId) => {
        const st = get();
        return Object.values(st.threads)
          .filter((t) => t.agentId === agentId)
          .sort((a, b) => b.updatedAt - a.updatedAt);
      },

      // ✅ Create a new thread for an agent
      createThreadForAgent: (agentId, title, forceNew) => {
        const st = get();
        const currentUserId = useUserStore.getState().userId;
        
        // Debug: log caller stack trace
        console.log(`[createThreadForAgent] Called for agent ${agentId}, title=${title}, forceNew=${forceNew}, userId=${currentUserId}`);
        
        // Check if there's a thread being created right now for this agent (race condition prevention)
        const lockThreadId = threadCreationLock.get(agentId);
        if (lockThreadId && !forceNew) {
          console.log(`[createThreadForAgent] Thread ${lockThreadId} is being created for agent ${agentId}, returning that instead`);
          set({ activeThreadId: lockThreadId });
          return lockThreadId;
        }
        
        // Check if there's already an empty thread for this agent AND this user - reuse it
        // Skip reuse when forceNew is true (explicit "New Chat" click)
        if (!forceNew) {
          const existingEmptyThread = Object.values(st.threads).find((t) => {
            if (t.agentId !== agentId) return false;
            // Only match threads belonging to current user (or no userId for backwards compat)
            if (t.userId && t.userId !== currentUserId) return false;
            const msgs = st.messagesByThreadId[t.id] ?? [];
            return msgs.length === 0;
          });
          
          if (existingEmptyThread) {
            // Reuse the existing empty thread
            console.log(`[createThreadForAgent] Reusing existing empty thread ${existingEmptyThread.id}`);
            set({ activeThreadId: existingEmptyThread.id });
            return existingEmptyThread.id;
          }
        }
        
        // Get count of existing threads for this agent for naming
        const existingThreads = Object.values(st.threads).filter((t) => t.agentId === agentId);
        const threadNumber = existingThreads.length + 1;
        const threadTitle = title ?? "New Chat";

        const id = uid();
        const t = now();
        const thread: ChatThread = {
          id,
          title: threadTitle,
          agentId,
          userId: currentUserId || undefined, // Track which user owns this thread
          createdAt: t,
          updatedAt: t,
          context: st.activeContext,
        };

        console.log(`[createThreadForAgent] Creating NEW thread ${id} for agent ${agentId}, userId=${currentUserId}`);
        
        // Set lock BEFORE creating thread
        threadCreationLock.set(agentId, id);
        
        // Clear lock after a short delay (allows state to propagate)
        setTimeout(() => {
          threadCreationLock.delete(agentId);
        }, 500);
        
        set((s2) => ({
          threads: { ...s2.threads, [id]: thread },
          messagesByThreadId: { ...s2.messagesByThreadId, [id]: [] },
          activeThreadId: id,
        }));

        return id;
      },

      createThread: (overrides, title) => {
        const st = get();
        const currentUserId = useUserStore.getState().userId;
        const ctx: ChatContext = { ...st.activeContext, ...(overrides ?? {}) };
        const id = uid();
        const t = now();
        const thread: ChatThread = {
          id,
          title: title ?? "New chat",
          userId: currentUserId || undefined, // Track which user owns this thread
          createdAt: t,
          updatedAt: t,
          context: ctx,
        };

        set((s2) => ({
          threads: { ...s2.threads, [id]: thread },
          messagesByThreadId: { ...s2.messagesByThreadId, [id]: s2.messagesByThreadId[id] ?? [] },
          activeThreadId: id,
        }));

        return id;
      },

      // ✅ ensure thread with a specific id (draft id OR remote thread_id)
      ensureThreadWithId: (threadId, overrides, title) => {
        const st = get();
        const existing = st.threads[threadId];
        const t = now();

        const ctx: ChatContext = { ...st.activeContext, ...(overrides ?? {}) };

        if (existing) {
          set((s2) => ({
            threads: {
              ...s2.threads,
              [threadId]: {
                ...existing,
                title: title ?? existing.title,
                updatedAt: t,
                context: { ...existing.context, ...ctx },
              },
            },
            messagesByThreadId: {
              ...s2.messagesByThreadId,
              [threadId]: s2.messagesByThreadId[threadId] ?? [],
            },
            activeThreadId: threadId,
          }));
          return threadId;
        }

        const thread: ChatThread = {
          id: threadId,
          title: title ?? "New chat",
          createdAt: t,
          updatedAt: t,
          context: ctx,
        };

        set((s2) => ({
          threads: { ...s2.threads, [threadId]: thread },
          messagesByThreadId: { ...s2.messagesByThreadId, [threadId]: [] },
          activeThreadId: threadId,
        }));

        return threadId;
      },

      // ✅ move draft thread -> remote thread_id
      migrateThreadId: (fromId, toId, opts) => {
        set((st) => {
          if (fromId === toId) return st;

          const fromThread = st.threads[fromId];
          const fromMsgs = st.messagesByThreadId[fromId] ?? [];

          if (!fromThread) return st;

          const toThread = st.threads[toId];
          const toMsgs = st.messagesByThreadId[toId] ?? [];

          const mergedMsgs = toThread ? [...toMsgs, ...fromMsgs] : fromMsgs;

          const { [fromId]: _dropT, ...restThreads } = st.threads;
          const { [fromId]: _dropM, ...restMsgs } = st.messagesByThreadId;
          // Carry over profile hash from old thread ID to new one
          const fromProfileHash = st.profileHashByThreadId[fromId];
          const { [fromId]: _dropPH, ...restProfileHashes } = st.profileHashByThreadId;
          const nextProfileHashes = fromProfileHash
            ? { ...restProfileHashes, [toId]: fromProfileHash }
            : restProfileHashes;

          const nextThread: ChatThread = toThread
            ? {
                ...toThread,
                title: opts?.keepTitle ? toThread.title : fromThread.title,
                updatedAt: now(),
                context: { ...toThread.context, ...fromThread.context },
              }
            : {
                ...fromThread,
                id: toId,
                updatedAt: now(),
              };

          return {
            threads: { ...restThreads, [toId]: nextThread },
            messagesByThreadId: { ...restMsgs, [toId]: mergedMsgs },
            profileHashByThreadId: nextProfileHashes,
            activeThreadId: st.activeThreadId === fromId ? toId : st.activeThreadId,
          };
        });
      },

      clearThreadMessages: (threadId) => {
        set((st) => {
          const th = st.threads[threadId];
          if (!th) return st;
          return {
            messagesByThreadId: { ...st.messagesByThreadId, [threadId]: [] },
            threads: { ...st.threads, [threadId]: { ...th, updatedAt: now() } },
          };
        });
      },

      updateMessageAt: (threadId, index, patch) => {
        set((st) => {
          const th = st.threads[threadId];
          const msgs = st.messagesByThreadId[threadId];
          if (!th || !msgs || !msgs[index]) return st;
          const next = [...msgs];
          next[index] = { ...next[index], ...patch };
          return {
            messagesByThreadId: { ...st.messagesByThreadId, [threadId]: next },
            threads: { ...st.threads, [threadId]: { ...th, updatedAt: now() } },
          };
        });
      },

      markMessagesNotLatest: (threadId, fromIndex) => {
        set((st) => {
          const th = st.threads[threadId];
          const msgs = st.messagesByThreadId[threadId];
          if (!th || !msgs) return st;
          
          // Mark all messages from fromIndex onwards as isLatest: false
          const next = msgs.map((msg, i) => 
            i >= fromIndex ? { ...msg, isLatest: false } : msg
          );
          
          return {
            messagesByThreadId: { ...st.messagesByThreadId, [threadId]: next },
            threads: { ...st.threads, [threadId]: { ...th, updatedAt: now() } },
          };
        });
      },

      replaceLastAssistant: (threadId, msg) => {
        set((st) => {
          const th = st.threads[threadId];
          const msgs = st.messagesByThreadId[threadId];
          if (!th || !msgs) return st;

          let idx = -1;
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === "assistant") {
              idx = i;
              break;
            }
          }

          const next = [...msgs];
          const m: ChatMessage = { id: uid(), createdAt: now(), ...msg };

          if (idx === -1) next.push(m);
          else next[idx] = m;

          return {
            messagesByThreadId: { ...st.messagesByThreadId, [threadId]: next },
            threads: { ...st.threads, [threadId]: { ...th, updatedAt: now() } },
          };
        });
      },

      truncateMessagesAfter: (threadId, keepUpToIndex) => {
        set((st) => {
          const th = st.threads[threadId];
          const msgs = st.messagesByThreadId[threadId];
          if (!th || !msgs) return st;

          // Keep messages from 0 to keepUpToIndex (inclusive)
          const truncated = msgs.slice(0, keepUpToIndex + 1);

          return {
            messagesByThreadId: { ...st.messagesByThreadId, [threadId]: truncated },
            threads: { ...st.threads, [threadId]: { ...th, updatedAt: now() } },
          };
        });
      },

      setActiveThread: (threadId) => set({ activeThreadId: threadId }),

      // Save Azure thread ID to thread context for persistence across sessions
      setThreadSessionUuid: (threadId, sessionUuid) => {
        set((st) => {
          const th = st.threads[threadId];
          if (!th) return st;
          return {
            threads: {
              ...st.threads,
              [threadId]: {
                ...th,
                context: { ...th.context, sessionUuid },
                updatedAt: now(),
              },
            },
          };
        });
      },

      renameThread: (threadId, title) => {
        // Update in backend (fire and forget)
        updateThreadTitleInBackend(threadId, title);
        
        // Update in local store
        set((st) => {
          const th = st.threads[threadId];
          if (!th) return st;
          return {
            threads: { ...st.threads, [threadId]: { ...th, title, updatedAt: now() } },
          };
        });
      },

      deleteThread: (threadId) => {
        // Delete from backend (fire and forget)
        deleteThreadFromBackend(threadId);
        
        // Delete from local store
        set((st) => {
          const { [threadId]: _t, ...restThreads } = st.threads;
          const { [threadId]: _m, ...restMsgs } = st.messagesByThreadId;
          const { [threadId]: _ph, ...restProfileHashes } = st.profileHashByThreadId;
          const nextActive = st.activeThreadId === threadId ? null : st.activeThreadId;
          return { threads: restThreads, messagesByThreadId: restMsgs, profileHashByThreadId: restProfileHashes, activeThreadId: nextActive };
        });
      },

      shareThread: async (threadId) => {
        const thread = get().threads[threadId];
        if (!thread) return null;
        
        // If already shared, return existing token
        if (thread.shareToken) return thread.shareToken;
        
        const userId = useUserStore.getState().userId;
        if (!userId) {
          console.warn('[shareThread] No userId available');
          return null;
        }
        
        try {
          const result = await chatApi.createShareLink(threadId, userId);
          if (result.success && result.share_token) {
            // Update local store with share token
            set((st) => {
              const th = st.threads[threadId];
              if (!th) return st;
              return {
                threads: { ...st.threads, [threadId]: { ...th, shareToken: result.share_token, updatedAt: now() } },
              };
            });
            return result.share_token;
          }
        } catch (error) {
          console.error('[shareThread] Failed to create share link:', error);
        }
        return null;
      },

      unshareThread: async (threadId) => {
        const thread = get().threads[threadId];
        if (!thread) return false;
        
        const userId = useUserStore.getState().userId;
        if (!userId) {
          console.warn('[unshareThread] No userId available');
          return false;
        }
        
        try {
          const result = await chatApi.revokeShareLink(threadId, userId);
          if (result.success) {
            // Update local store to remove share token
            set((st) => {
              const th = st.threads[threadId];
              if (!th) return st;
              const { shareToken: _, ...rest } = th;
              return {
                threads: { ...st.threads, [threadId]: { ...rest, updatedAt: now() } },
              };
            });
            return true;
          }
        } catch (error) {
          console.error('[unshareThread] Failed to revoke share link:', error);
        }
        return false;
      },

      deleteProject: (projectId) => {
        set((st) => {
          const project = st.projects[projectId];
          if (!project) return st;

          // Delete the project
          const { [projectId]: _p, ...restProjects } = st.projects;

          // Delete all threads associated with this project's agent
          const threadsToDelete = Object.values(st.threads)
            .filter((t) => t.agentId === project.agentId)
            .map((t) => t.id);

          // Delete threads from backend
          threadsToDelete.forEach((tid) => deleteThreadFromBackend(tid));

          let restThreads = { ...st.threads };
          let restMsgs = { ...st.messagesByThreadId };

          for (const tid of threadsToDelete) {
            const { [tid]: _t, ...remaining } = restThreads;
            restThreads = remaining;
            const { [tid]: _m, ...remainingMsgs } = restMsgs;
            restMsgs = remainingMsgs;
          }

          const nextActive = threadsToDelete.includes(st.activeThreadId ?? "")
            ? null
            : st.activeThreadId;

          return {
            projects: restProjects,
            threads: restThreads,
            messagesByThreadId: restMsgs,
            activeThreadId: nextActive,
          };
        });
      },

      // ✅ Cleanup empty threads (threads with no messages)
      cleanupEmptyThreads: () => {
        set((st) => {
          const emptyThreadIds = Object.keys(st.threads).filter((tid) => {
            // Don't delete the currently active thread
            if (tid === st.activeThreadId) return false;
            // Check if thread has no messages
            const msgs = st.messagesByThreadId[tid] ?? [];
            return msgs.length === 0;
          });

          if (emptyThreadIds.length === 0) return st;

          let restThreads = { ...st.threads };
          let restMsgs = { ...st.messagesByThreadId };

          for (const tid of emptyThreadIds) {
            const { [tid]: _t, ...remaining } = restThreads;
            restThreads = remaining;
            const { [tid]: _m, ...remainingMsgs } = restMsgs;
            restMsgs = remainingMsgs;
          }

          return {
            threads: restThreads,
            messagesByThreadId: restMsgs,
          };
        });
      },

      // ✅ Cleanup duplicate projects with the same course name
      // Keeps the most recently updated project and merges threads
      cleanupDuplicateProjects: () => {
        set((st) => {
          // Normalize course name for comparison
          const getNormalizedName = (name: string) => {
            return name
              .replace(/^course[-_]/i, "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
          };

          // Group projects by normalized name
          const projectsByName = new Map<string, typeof st.projects[string][]>();
          Object.values(st.projects).forEach((project) => {
            const normalizedName = getNormalizedName(project.agentName || project.name);
            if (!projectsByName.has(normalizedName)) {
              projectsByName.set(normalizedName, []);
            }
            projectsByName.get(normalizedName)!.push(project);
          });

          // Find duplicates and merge
          let newProjects = { ...st.projects };
          let newThreads = { ...st.threads };
          const projectsToDelete: string[] = [];

          projectsByName.forEach((duplicates) => {
            if (duplicates.length <= 1) return;

            // Sort by updatedAt descending - keep the most recent
            duplicates.sort((a, b) => b.updatedAt - a.updatedAt);
            const primaryProject = duplicates[0];

            // Merge threads from duplicate projects into the primary
            for (let i = 1; i < duplicates.length; i++) {
              const dupProject = duplicates[i];
              projectsToDelete.push(dupProject.id);

              // Reassign threads from duplicate to primary project
              Object.values(newThreads).forEach((thread) => {
                if (thread.agentId === dupProject.agentId) {
                  newThreads[thread.id] = {
                    ...thread,
                    agentId: primaryProject.agentId,
                  };
                }
              });
            }
          });

          // Remove duplicate projects
          projectsToDelete.forEach((pid) => {
            const { [pid]: _, ...rest } = newProjects;
            newProjects = rest;
          });

          if (projectsToDelete.length === 0) return st;

          console.log(`Cleaned up ${projectsToDelete.length} duplicate project(s)`);
          return {
            projects: newProjects,
            threads: newThreads,
          };
        });
      },

      // ✅ Cleanup duplicate threads (threads with same agentId)
      // For empty threads or threads with only assistant messages, keeps only one per agent
      // For threads with user messages, groups by agentId + first user message
      cleanupDuplicateThreads: () => {
        set((st) => {
          // First pass: Find all empty or assistant-only threads per agent
          const emptyThreadsByAgent = new Map<string, string[]>();
          const threadsWithUserMessages = new Map<string, string[]>();
          
          Object.entries(st.threads).forEach(([threadId, thread]) => {
            const agentId = thread.agentId || 'unknown';
            const msgs = st.messagesByThreadId[threadId] ?? [];
            const hasUserMessage = msgs.some(m => m.role === 'user');
            
            if (!hasUserMessage) {
              // Empty or assistant-only thread
              if (!emptyThreadsByAgent.has(agentId)) {
                emptyThreadsByAgent.set(agentId, []);
              }
              emptyThreadsByAgent.get(agentId)!.push(threadId);
            } else {
              // Thread with user messages - group by first user message
              const firstUserMsg = msgs.find(m => m.role === 'user');
              const key = `${agentId}:${firstUserMsg?.content?.slice(0, 50)?.toLowerCase() ?? ''}`;
              if (!threadsWithUserMessages.has(key)) {
                threadsWithUserMessages.set(key, []);
              }
              threadsWithUserMessages.get(key)!.push(threadId);
            }
          });

          const threadsToDelete: string[] = [];

          // Keep only one empty thread per agent (the most recent)
          emptyThreadsByAgent.forEach((threadIds, agentId) => {
            if (threadIds.length <= 1) return;
            
            const sorted = threadIds
              .map(id => ({ id, thread: st.threads[id] }))
              .filter(t => t.thread)
              .sort((a, b) => b.thread.updatedAt - a.thread.updatedAt);

            // Keep the first (most recent), delete the rest
            for (let i = 1; i < sorted.length; i++) {
              if (sorted[i].id !== st.activeThreadId) {
                threadsToDelete.push(sorted[i].id);
                console.log(`[cleanupDuplicateThreads] Will delete empty thread ${sorted[i].id} for agent ${agentId}`);
              }
            }
          });

          // Keep only one thread per first-user-message key
          threadsWithUserMessages.forEach((threadIds, key) => {
            if (threadIds.length <= 1) return;

            const sorted = threadIds
              .map(id => ({ id, thread: st.threads[id] }))
              .filter(t => t.thread)
              .sort((a, b) => b.thread.updatedAt - a.thread.updatedAt);

            for (let i = 1; i < sorted.length; i++) {
              if (sorted[i].id !== st.activeThreadId) {
                threadsToDelete.push(sorted[i].id);
                console.log(`[cleanupDuplicateThreads] Will delete duplicate thread ${sorted[i].id} for key ${key}`);
              }
            }
          });

          if (threadsToDelete.length === 0) return st;

          // Remove duplicate threads
          let restThreads = { ...st.threads };
          let restMsgs = { ...st.messagesByThreadId };

          for (const tid of threadsToDelete) {
            const { [tid]: _t, ...remaining } = restThreads;
            restThreads = remaining;
            const { [tid]: _m, ...remainingMsgs } = restMsgs;
            restMsgs = remainingMsgs;
            
            // Also delete from backend
            deleteThreadFromBackend(tid);
          }

          console.log(`Cleaned up ${threadsToDelete.length} duplicate thread(s)`);
          return {
            threads: restThreads,
            messagesByThreadId: restMsgs,
          };
        });
      },

      // Validate agents against backend and remove stale ones from localStorage
      cleanupStaleAgents: async () => {
        try {
          // Dynamically import to avoid circular dependencies
          const { listAgents } = await import("./api");
          const agents = await listAgents();
          // API returns array directly, not {value: [...]}
          const validAgentIds = new Set((agents || []).map((a: { id: string }) => a.id));
          
          const st = get();
          const projectsToDelete: string[] = [];
          const threadsToDelete: string[] = [];
          
          // Find projects with agentIds that don't exist in the backend
          Object.values(st.projects).forEach((project) => {
            if (project.agentId && !validAgentIds.has(project.agentId)) {
              console.log(`[cleanupStaleAgents] Stale agent found: ${project.name} (${project.agentId})`);
              projectsToDelete.push(project.id);
            }
          });
          
          // Find threads belonging to stale agents
          Object.values(st.threads).forEach((thread) => {
            if (thread.agentId && !validAgentIds.has(thread.agentId)) {
              threadsToDelete.push(thread.id);
            }
          });
          
          if (projectsToDelete.length === 0 && threadsToDelete.length === 0) {
            console.log("[cleanupStaleAgents] No stale agents found");
            return;
          }
          
          set((s) => {
            let newProjects = { ...s.projects };
            let newThreads = { ...s.threads };
            let newMessages = { ...s.messagesByThreadId };
            
            // Remove stale projects
            for (const pid of projectsToDelete) {
              const { [pid]: _, ...rest } = newProjects;
              newProjects = rest;
            }
            
            // Remove stale threads and their messages
            for (const tid of threadsToDelete) {
              const { [tid]: _t, ...restThreads } = newThreads;
              newThreads = restThreads;
              const { [tid]: _m, ...restMsgs } = newMessages;
              newMessages = restMsgs;
            }
            
            console.log(`[cleanupStaleAgents] Removed ${projectsToDelete.length} stale project(s) and ${threadsToDelete.length} thread(s)`);
            return {
              projects: newProjects,
              threads: newThreads,
              messagesByThreadId: newMessages,
            };
          });
        } catch (error) {
          console.error("[cleanupStaleAgents] Failed to validate agents:", error);
        }
      },

      appendMessage: (threadId, msg) => {
        set((st) => {
          const th = st.threads[threadId];
          if (!th) return st;

          // Use provided createdAt or default to now()
          const m: ChatMessage = { ...msg, id: uid(), createdAt: msg.createdAt ?? now() };
          const existing = st.messagesByThreadId[threadId] ?? [];

          // Log research message storage for debugging
          if (m.isResearch || m.research) {
            console.log("[ChatStore] appendMessage with research:", {
              threadId,
              isResearch: m.isResearch,
              hasResearch: !!m.research,
              researchStatus: m.research?.status,
              researchId: m.research?.id,
            });
          }

          return {
            messagesByThreadId: { ...st.messagesByThreadId, [threadId]: [...existing, m] },
            threads: { ...st.threads, [threadId]: { ...th, updatedAt: now() } },
          };
        });
      },
      
      // Active research management (survives navigation between threads)
      setActiveResearch: (threadId, research) => {
        set((st) => ({
          activeResearchByThreadId: { ...st.activeResearchByThreadId, [threadId]: research },
        }));
      },
      
      updateActiveResearch: (threadId, updates) => {
        set((st) => {
          const existing = st.activeResearchByThreadId[threadId];
          if (!existing) return st;
          return {
            activeResearchByThreadId: {
              ...st.activeResearchByThreadId,
              [threadId]: { ...existing, ...updates },
            },
          };
        });
      },
      
      clearActiveResearch: (threadId) => {
        set((st) => {
          const { [threadId]: _, ...rest } = st.activeResearchByThreadId;
          return { activeResearchByThreadId: rest };
        });
      },
      
      getActiveResearch: (threadId) => {
        return get().activeResearchByThreadId[threadId];
      },

      // Profile hash per thread — tracks when profile was last injected
      setProfileHashForThread: (threadId, hash) => {
        set((st) => ({
          profileHashByThreadId: { ...st.profileHashByThreadId, [threadId]: hash },
        }));
      },

      getProfileHashForThread: (threadId) => {
        return get().profileHashByThreadId[threadId];
      },

      /**
       * Determine if profile should be injected for this thread.
       * Returns true when:
       * - threadId is null (new chat, always inject)
       * - thread has never had profile injected
       * - profile has changed since last injection in this thread
       */
      shouldInjectProfile: (threadId) => {
        if (!threadId) return true; // new chat
        const storedHash = get().profileHashByThreadId[threadId];
        if (!storedHash) return true; // never injected for this thread
        const currentHash = computeProfileHash(get());
        return storedHash !== currentHash;
      },

      // Clear all user-specific data (call on logout to prevent data leakage between users)
      clearUserData: () => {
        set({
          projects: {},
          threads: {},
          messagesByThreadId: {},
          activeResearchByThreadId: {},
          profileHashByThreadId: {},
          // Keep state shape valid; ensureBootstrap() will recreate default project if needed.
          activeProjectId: "my-project-1",
          activeThreadId: null,
          activeContext: defaultContext("my-project-1"),
          userFullName: "",
          userName: "User",
          userNickname: "",
          userWorkFunction: "",
          userPreferences: "",
          userCustomInstructions: "",
          userStatus: "",
          onboardingCompleted: false,
        });
        console.log("[ChatStore] Cleared user data on logout");
      },
    }),
    {
      name: "ekalaiva.chat.v1",
      version: 2,
      // A full quota must never take the app down — this store is a cache, and the
      // server holds the authoritative history.
      storage: createJSONStorage(() => ({
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => {
          try {
            localStorage.setItem(key, value);
          } catch (error) {
            console.warn("[chatStore] State not persisted:", error);
          }
        },
        removeItem: (key) => localStorage.removeItem(key),
      })),
      partialize: (s) => {
        // Limit messages per thread to only keep the most recent ones
        // This keeps localStorage small while Cosmos DB stores the full history
        // Headroom for anything not yet confirmed synced. Image payloads are
        // stripped below, so this costs little space.
        const MAX_LOCAL_MESSAGES = 50;

        // A single generated image is megabytes of base64 — far past the quota.
        // Opening a thread refetches every message, so the server restores them.
        const stripImageData = (messages: ChatMessage[]): ChatMessage[] =>
          messages.map((message) => {
            const blocks = message.contentBlocks;
            if (!blocks?.some((b) => "imageData" in b && b.imageData)) return message;
            return {
              ...message,
              contentBlocks: blocks.map((b) =>
                "imageData" in b && b.imageData ? { ...b, imageData: "" } : b,
              ),
            };
          });

        const trimmedMessages: Record<string, ChatMessage[]> = {};
        for (const [threadId, messages] of Object.entries(s.messagesByThreadId)) {
          if (messages.length <= MAX_LOCAL_MESSAGES) {
            trimmedMessages[threadId] = stripImageData(messages);
          } else {
            // Sort by timestamp descending, take most recent, then re-sort chronologically
            const sorted = [...messages].sort((a, b) => b.createdAt - a.createdAt);
            const recent = sorted.slice(0, MAX_LOCAL_MESSAGES);
            trimmedMessages[threadId] = stripImageData(
              recent.sort((a, b) => a.createdAt - b.createdAt),
            );
          }
        }
        
        return {
          projects: s.projects,
          threads: s.threads,
          messagesByThreadId: trimmedMessages,
          activeProjectId: s.activeProjectId,
          activeContext: s.activeContext,
          activeThreadId: s.activeThreadId,
          userFullName: s.userFullName,
          userName: s.userName,
          userNickname: s.userNickname,
          userWorkFunction: s.userWorkFunction,
          userPreferences: s.userPreferences,
          userCustomInstructions: s.userCustomInstructions,
          userDepartment: s.userDepartment,
          userCollege: s.userCollege,
          userLanguage: s.userLanguage,
          userCurrentLocation: s.userCurrentLocation,
          userInterests: s.userInterests,
          userPassionateAbout: s.userPassionateAbout,
          userLearningProfile: s.userLearningProfile,
          uiLanguage: s.uiLanguage,
          responseLanguage: s.responseLanguage,
          onboardingCompleted: s.onboardingCompleted,
          userStatus: s.userStatus,
        };
      },
    }
  )
);