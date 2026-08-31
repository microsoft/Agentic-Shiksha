// src/lib/useChatSync.ts
// Hook to sync chat data between local store and Cosmos DB

import { useEffect, useCallback, useRef } from "react";
import { useChatStore } from "./chatStore";
import { useUserStore } from "./userStore";
import { chatApi, type ApiThread, type ApiMessage } from "./chatApi";
import { listAzureAgents } from "./api";
import type { ChatRole, ChatMessage, Project, ResearchData, ContentBlock, QuizQuestion, FlashCard, ClarifyQuestion } from "./types";

// Debounce delay for syncing (ms). Anything still inside this window when the tab
// closes was never sent, and the local copy is capped, so keep it short and pair it
// with the visibility/pagehide flush below.
const SYNC_DEBOUNCE = 1000;

// Track last synced state to only sync changes
interface SyncedState {
  threads: Record<string, { id: string; updatedAt: number }>;
  messageCounts: Record<string, number>;
  // Track content fingerprints for each message to detect edits/retries
  messageFingerprints: Record<string, Record<string, string>>; // threadId -> msgId -> fingerprint
}

function messageFingerprint(message: ChatMessage): string {
  return `${message.content.length}:${message.isLatest ?? true}:${message.retryNumber ?? 0}:${message.content.slice(0, 64)}:${message.tokenUsage?.input_tokens ?? 0}:${message.tokenUsage?.output_tokens ?? 0}:${message.tokenUsage?.total_tokens ?? 0}:${message.tokenUsage?.rounds ?? 0}`;
}

// Convert local thread to API format
function toApiThread(
  thread: { id: string; title: string; agentId?: string; createdAt: number; updatedAt: number },
  userId: string
): ApiThread {
  return {
    id: thread.id,
    userId,
    agentId: thread.agentId || "unknown",
    name: thread.title,
    lastMessageAt: new Date(thread.updatedAt).toISOString(),
    createdAt: new Date(thread.createdAt).toISOString(),
  };
}

// Convert local message to API format
// Validates createdAt to prevent invalid timestamps from being sent to API
function toApiMessage(
  msg: { 
    id: string; 
    role: string; 
    content: string; 
    createdAt: number;
    generatedDocId?: string;
    generatedDocTitle?: string;
    generatedDocContent?: string;
    isResearch?: boolean;
    researchStartTime?: number;
    researchEndTime?: number;
    messageGroupId?: string;
    retryNumber?: number;
    imageUrls?: string[];
    isLatest?: boolean;
    contentBlocks?: ContentBlock[];
    docBlockContent?: string;
    tokenUsage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      rounds: number;
      per_round: Array<{ round: number; response_id?: string; tools: string[]; input_tokens: number; output_tokens: number }>;
    };
  },
  threadId: string,
  userId: string
): ApiMessage | null {
  // Validate createdAt - must be a valid number
  if (!msg.createdAt || isNaN(msg.createdAt) || msg.createdAt <= 0) {
    console.warn(`Invalid createdAt for message ${msg.id}:`, msg.createdAt);
    return null;
  }

  // Safely convert timestamp to ISO string
  let timestamp: string;
  try {
    timestamp = new Date(msg.createdAt).toISOString();
  } catch {
    console.warn(`Failed to convert timestamp for message ${msg.id}:`, msg.createdAt);
    return null;
  }

  // Build metadata for generated docs and research
  const metadata: Record<string, unknown> = {};
  if (msg.generatedDocId) {
    metadata.generatedDocId = msg.generatedDocId;
    if (msg.generatedDocTitle) metadata.generatedDocTitle = msg.generatedDocTitle;
    if (msg.generatedDocContent) metadata.generatedDocContent = msg.generatedDocContent;
  }
  if (msg.isResearch) {
    metadata.isResearch = true;
    // Also save research timing for display after reload
    if (msg.researchStartTime) metadata.researchStartTime = msg.researchStartTime;
    if (msg.researchEndTime) metadata.researchEndTime = msg.researchEndTime;
  }
  // Store the full research object for stopped/completed research (needed to show research card)
  if ((msg as { research?: Record<string, unknown> }).research) {
    metadata.research = (msg as { research?: Record<string, unknown> }).research;
  }
  // Store content blocks (structured text + document blocks) for multi-block responses
  if (msg.contentBlocks && msg.contentBlocks.length > 0) {
    // Strip isStreaming flag - not needed for persistence
    metadata.contentBlocks = msg.contentBlocks.map(b => {
      const { ...rest } = b;
      delete (rest as Record<string, unknown>).isStreaming;
      return rest;
    });
  }
  // Store document block follow-up text
  if (msg.docBlockContent) {
    metadata.docBlockContent = msg.docBlockContent;
  }
  // Store token usage for dashboard analytics
  if (msg.tokenUsage && msg.tokenUsage.total_tokens > 0) {
    metadata.tokenUsage = msg.tokenUsage;
  }

  return {
    id: msg.id,
    threadId,
    userId,
    role: msg.role as "user" | "assistant",
    content: msg.content,
    timestamp,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    messageGroupId: msg.messageGroupId,
    retryNumber: msg.retryNumber ?? 0,
    imageUrls: msg.imageUrls,
    isLatest: msg.isLatest ?? true,  // Default to true if not specified
  };
}

// Convert API thread to local format
// IMPORTANT: Validates timestamps to prevent NaN propagation which causes "Invalid Date"
// Handles both API format (name) and Cosmos DB format (title)
function fromApiThread(apiThread: ApiThread & { title?: string; userId?: string }): {
  id: string;
  title: string;
  agentId: string;
  userId?: string;
  createdAt: number;
  updatedAt: number;
} {
  const now = Date.now();
  
  // Parse and validate createdAt
  let createdAt = now;
  if (apiThread.createdAt) {
    const parsed = new Date(apiThread.createdAt).getTime();
    if (!isNaN(parsed) && parsed > 0) {
      createdAt = parsed;
    }
  }
  
  // Parse and validate updatedAt (lastMessageAt)
  let updatedAt = createdAt; // Default to createdAt if lastMessageAt is invalid
  if (apiThread.lastMessageAt) {
    const parsed = new Date(apiThread.lastMessageAt).getTime();
    if (!isNaN(parsed) && parsed > 0) {
      updatedAt = parsed;
    }
  }
  
  return {
    id: apiThread.id,
    // Handle both formats: API uses 'name', Cosmos DB uses 'title'
    title: apiThread.name || apiThread.title || "New Chat",
    agentId: apiThread.agentId,
    userId: apiThread.userId,
    createdAt,
    updatedAt,
  };
}

// Convert API message to local format
// IMPORTANT: Validates timestamp to prevent NaN propagation
function fromApiMessage(apiMessage: ApiMessage): ChatMessage | null {
  // Parse and validate timestamp - backend may return 'createdAt' or 'timestamp'
  const timestampStr = apiMessage.timestamp || apiMessage.createdAt;
  let createdAt: number;
  if (timestampStr) {
    const parsed = new Date(timestampStr).getTime();
    // Check for NaN - invalid timestamp
    if (isNaN(parsed)) {
      console.warn(`Invalid timestamp in message ${apiMessage.id}:`, timestampStr);
      createdAt = Date.now(); // Fallback to current time
    } else {
      createdAt = parsed;
    }
  } else {
    // No timestamp provided - use current time
    createdAt = Date.now();
  }

  // Extract metadata fields
  const metadata = apiMessage.metadata || {};

  // Fix content that was accidentally JSON-stringified (contains literal \n instead of newlines)
  let fixedContent = apiMessage.content;
  if (fixedContent.includes('\\n') || fixedContent.endsWith('"}')) {
    try {
      if (fixedContent.startsWith('"') && fixedContent.endsWith('"')) {
        fixedContent = JSON.parse(fixedContent);
      } else {
        fixedContent = fixedContent
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/"\}$/, '');
      }
    } catch {
      fixedContent = fixedContent
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/"\}$/, '');
    }
  }

  const result: ChatMessage = {
    id: apiMessage.id,
    role: apiMessage.role as ChatRole,
    content: fixedContent,
    createdAt,
    messageGroupId: apiMessage.messageGroupId,
    retryNumber: apiMessage.retryNumber ?? 0,
    imageUrls: apiMessage.imageUrls,
    isLatest: apiMessage.isLatest ?? true,
  };

  // Add generated doc metadata if present
  if (metadata.generatedDocId) {
    result.generatedDocId = metadata.generatedDocId as string;
  }
  if (metadata.generatedDocTitle) {
    result.generatedDocTitle = metadata.generatedDocTitle as string;
  }
  if (metadata.generatedDocContent) {
    result.generatedDocContent = metadata.generatedDocContent as string;
  }
  // Add research metadata if present
  if (metadata.isResearch) {
    result.isResearch = true;
    if (metadata.researchStartTime) result.researchStartTime = metadata.researchStartTime as number;
    if (metadata.researchEndTime) result.researchEndTime = metadata.researchEndTime as number;
  }
  // Restore full research object if present
  if (metadata.research) {
    result.research = metadata.research as ResearchData;
  }
  // Restore content blocks (structured text + document + quiz + flashcard + challenge blocks)
  if (metadata.contentBlocks && Array.isArray(metadata.contentBlocks)) {
    result.contentBlocks = (metadata.contentBlocks as Array<Record<string, unknown>>).map((b): ContentBlock | null => {
      if (b.type === 'text') {
        return { type: 'text' as const, content: (b.content as string) || '' };
      } else if (b.type === 'quiz') {
        return {
          type: 'quiz' as const,
          quizId: (b.quizId as string) || '',
          title: (b.title as string) || 'Quiz',
          assessmentType: b.assessmentType as "concept_inventory" | "practice_quiz" | undefined,
          thresholdConcept: b.thresholdConcept as string | undefined,
          questions: (b.questions as QuizQuestion[]) || [],
        };
      } else if (b.type === 'flashcard') {
        return {
          type: 'flashcard' as const,
          flashcardId: (b.flashcardId as string) || '',
          title: (b.title as string) || 'Flashcards',
          cards: (b.cards as FlashCard[]) || [],
        };
      } else if (b.type === 'challenge') {
        return {
          type: 'challenge' as const,
          challengeId: (b.challengeId as string) || '',
          title: (b.title as string) || 'Challenge',
          description: (b.description as string) || '',
          difficulty: (b.difficulty as string) || 'medium',
          hints: (b.hints as string[]) || [],
          solution: (b.solution as string) || '',
          challengeType: (b.challengeType as string) || 'problem',
        };
      } else if (b.type === 'generated_image') {
        return {
          type: 'generated_image' as const,
          generatedImageId: (b.generatedImageId as string) || '',
          title: (b.title as string) || 'Generated image',
          // imageData is megabytes of base64 and would exceed the 2 MB Cosmos
          // item limit; the bytes live in blob storage behind imageUrl.
          imageData: '',
          imageUrl: (b.imageUrl as string) || '',
          caption: (b.caption as string) || '',
          size: (b.size as string) || '',
          quality: (b.quality as string) || '',
        };
      } else if (b.type === 'tikz_image' || b.type === 'sympy_image') {
        return {
          type: 'tikz_image' as const,
          tikzImageId: (b.tikzImageId as string) || (b.sympyImageId as string) || '',
          title: (b.title as string) || 'Diagram',
          imageData: (b.imageData as string) || '',
          caption: (b.caption as string) || '',
          visualizationType: (b.visualizationType as string) || '',
        };
      } else if (b.type === 'clarify') {
        return {
          type: 'clarify' as const,
          clarifyId: (b.clarifyId as string) || '',
          questions: (b.questions as ClarifyQuestion[]) || [],
        };
      } else if (b.type === 'suggested_queries') {
        return {
          type: 'suggested_queries' as const,
          suggestionsId: (b.suggestionsId as string) || '',
          queries: (b.queries as string[]) || [],
        };
      } else if (b.type === 'tool_activity') {
        return {
          type: 'tool_activity' as const,
          activityId: (b.activityId as string) || '',
          label: (b.label as string) || 'Working',
          done: b.done !== false,
        };
      } else if (b.type === 'document') {
        return { type: 'document' as const, docId: (b.docId as string) || '', title: (b.title as string) || 'Document' };
      }
      return null;
    }).filter((block): block is ContentBlock => block !== null);
  }
  // Restore document block follow-up text
  if (metadata.docBlockContent) {
    result.docBlockContent = metadata.docBlockContent as string;
  }
  if (metadata.tokenUsage) {
    result.tokenUsage = metadata.tokenUsage as NonNullable<ChatMessage["tokenUsage"]>;
  }

  return result;
}

function syncedStateFromApi(apiThreads: ApiThread[], apiMessages: ApiMessage[]): SyncedState {
  const synced: SyncedState = {
    threads: {},
    messageCounts: {},
    messageFingerprints: {},
  };

  for (const apiThread of apiThreads) {
    const thread = fromApiThread(apiThread);
    synced.threads[thread.id] = { id: thread.id, updatedAt: thread.updatedAt };
  }

  for (const apiMessage of apiMessages) {
    const message = fromApiMessage(apiMessage);
    if (!message) continue;
    synced.messageCounts[apiMessage.threadId] =
      (synced.messageCounts[apiMessage.threadId] ?? 0) + 1;
    synced.messageFingerprints[apiMessage.threadId] ??= {};
    synced.messageFingerprints[apiMessage.threadId][message.id] = messageFingerprint(message);
  }

  return synced;
}

export function useChatSync() {
  const { userId, initializeTempUser, isAuthenticated } = useUserStore();
  const { threads, messagesByThreadId } = useChatStore();
  
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncedStateRef = useRef<SyncedState>({ threads: {}, messageCounts: {}, messageFingerprints: {} });
  const isLoadingRef = useRef(false);
  const hasLoadedUserProfileRef = useRef(false);
  const hasLoadedBackendRef = useRef(false);
  const debouncedSyncRef = useRef<(() => void) | null>(null);
  const isSyncingRef = useRef(false);
  // A failed sync used to be logged and forgotten, leaving those messages unsent
  // until localStorage evicted them.
  const syncToBackendRef = useRef<(() => Promise<void>) | null>(null);
  const syncRetryRef = useRef(0);
  const MAX_SYNC_RETRIES = 4;

  const scheduleSyncRetry = useCallback((reason: string) => {
    if (syncRetryRef.current >= MAX_SYNC_RETRIES) {
      console.error(`[Sync] Giving up after ${MAX_SYNC_RETRIES} retries (${reason})`);
      return;
    }
    const attempt = ++syncRetryRef.current;
    const delay = 2000 * 2 ** (attempt - 1);
    console.warn(`[Sync] ${reason} — retry ${attempt}/${MAX_SYNC_RETRIES} in ${delay}ms`);
    window.setTimeout(() => { void syncToBackendRef.current?.(); }, delay);
  }, []);

  // Initialize user on mount
  useEffect(() => {
    if (!userId) {
      initializeTempUser();
    }
  }, [userId, initializeTempUser]);

  // Load user profile from backend on initial load
  useEffect(() => {
    if (userId && !hasLoadedUserProfileRef.current) {
      hasLoadedUserProfileRef.current = true;
      // Dynamic import to avoid circular dependency
      import("./chatStore").then(({ loadUserProfileFromBackend }) => {
        loadUserProfileFromBackend();
      });
    }
  }, [userId]);

  // Load data from backend on initial load
  const loadFromBackend = useCallback(async () => {
    if (!userId || isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    hasLoadedBackendRef.current = false;
    
    // Clear stale local data if user changed (different user on same browser)
    const lastSyncUserId = localStorage.getItem("ekalaiva_last_sync_user");
    if (lastSyncUserId && lastSyncUserId !== userId) {
      console.log(`[Sync] User changed (${lastSyncUserId} → ${userId}), clearing local chat data`);
      const state = useChatStore.getState();
      // Clear all projects, threads, messages from previous user
      Object.keys(state.projects).forEach((pid) => state.deleteProject(pid));
      Object.keys(state.threads).forEach((tid) => state.deleteThread(tid));
    }
    localStorage.setItem("ekalaiva_last_sync_user", userId);

    try {
      const { threads: apiThreads, messages: apiMessages } = await chatApi.loadUserData(userId);
      lastSyncedStateRef.current = syncedStateFromApi(apiThreads, apiMessages);

      if (apiThreads.length === 0 && apiMessages.length === 0) {
        console.log("No data in backend, keeping local data");
        hasLoadedBackendRef.current = true;
        debouncedSyncRef.current?.();
        return;
      }

      // Merge backend data with local data
      // Backend data takes precedence for existing items
      const state = useChatStore.getState();
      
      const mergedThreads = { ...state.threads };
      const mergedMessages = { ...state.messagesByThreadId };

      // Add/update threads from backend
      for (const apiThread of apiThreads) {
        const localThread = fromApiThread(apiThread);
        const existingThread = mergedThreads[localThread.id];
        
        // Use backend version if it's newer or doesn't exist locally
        // BUT preserve local title if it was recently renamed (within last 10s)
        // to prevent title generation race condition overwriting the new title
        if (!existingThread || localThread.updatedAt > existingThread.updatedAt) {
          const preserveTitle = existingThread &&
            existingThread.title !== localThread.title &&
            (Date.now() - existingThread.updatedAt) < 10000;
          mergedThreads[localThread.id] = {
            ...existingThread,
            ...localThread,
            ...(preserveTitle && { title: existingThread.title }),
            context: existingThread?.context || state.activeContext,
          };
        }
      }

      // Group messages by thread
      const messagesByThread: Record<string, typeof apiMessages> = {};
      for (const msg of apiMessages) {
        if (!messagesByThread[msg.threadId]) {
          messagesByThread[msg.threadId] = [];
        }
        messagesByThread[msg.threadId].push(msg);
      }

      // Add/update messages from backend
      for (const [threadId, msgs] of Object.entries(messagesByThread)) {
        const localMsgs = mergedMessages[threadId] || [];
        const localMsgIds = new Set(localMsgs.map((m) => m.id));
        
        // Add backend messages that don't exist locally
        // Filter out null results from invalid messages
        const newMsgs = msgs
          .filter((m) => !localMsgIds.has(m.id))
          .map(fromApiMessage)
          .filter((m): m is NonNullable<typeof m> => m !== null);
        
        if (newMsgs.length > 0) {
          // Filter out any messages with invalid createdAt before sorting
          const validNewMsgs = newMsgs.filter(m => !isNaN(m.createdAt) && m.createdAt > 0);
          const validLocalMsgs = localMsgs.filter(m => !isNaN(m.createdAt) && m.createdAt > 0);
          
          mergedMessages[threadId] = [...validLocalMsgs, ...validNewMsgs].sort(
            (a, b) => a.createdAt - b.createdAt
          );
        }
      }

      // Update store with merged data
      useChatStore.setState({
        threads: mergedThreads,
        messagesByThreadId: mergedMessages,
      });

      console.log(`[Sync] Loaded ${apiThreads.length} threads and ${apiMessages.length} messages from backend`);
      
      // Reconstruct projects from threads (projects are not synced to backend)
      // This ensures the sidebar shows courses even after sign out/sign in
      const existingProjects = useChatStore.getState().projects;
      const agentIdsFromThreads = new Set<string>();
      
      // Collect unique agentIds from all loaded threads
      // Note: threads loaded from backend belong to current user (filtered by userId on backend)
      for (const thread of Object.values(mergedThreads)) {
        if (thread.agentId) {
          // Include if: thread has no userId (old data), OR userId matches current user
          if (!thread.userId || thread.userId === userId) {
            agentIdsFromThreads.add(thread.agentId);
          }
        }
      }
      
      console.log(`[Sync] Found ${agentIdsFromThreads.size} unique agents from threads:`, Array.from(agentIdsFromThreads));
      
      // Check which agentIds don't have a project
      const missingAgentIds: string[] = [];
      for (const agentId of agentIdsFromThreads) {
        const hasProject = Object.values(existingProjects).some(
          (p) => p.agentId === agentId && (!p.userId || p.userId === userId)
        );
        if (!hasProject) {
          missingAgentIds.push(agentId);
        }
      }
      
      console.log(`[Sync] Missing projects for ${missingAgentIds.length} agents:`, missingAgentIds);
      
      // Fetch agent info and create projects for missing agents
      if (missingAgentIds.length > 0) {
        console.log(`[Sync] Reconstructing ${missingAgentIds.length} projects from threads`);
        try {
          const agents = await listAzureAgents();
          console.log(`[Sync] Fetched ${agents.length} agents from Azure`);
          const agentMap = new Map(agents.map((a) => [a.id, a]));
          
          const newProjects: Record<string, Project> = {};
          const orphanAgentIds: string[] = [];
          const now = Date.now();
          
          for (const agentId of missingAgentIds) {
            const agent = agentMap.get(agentId);
            if (agent) {
              const projectId = `project-${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              newProjects[projectId] = {
                id: projectId,
                name: agent.name,
                agentId: agent.id,
                agentName: agent.name,
                agentKind: "course",
                userId,
                createdAt: now,
                updatedAt: now,
              };
              console.log(`[Sync] Created project for agent: ${agent.name} (${agent.id})`);
            } else {
              // Agent not found in Azure - this is a stale/deleted agent
              // Don't create a placeholder project, instead mark for cleanup
              console.warn(`[Sync] Agent ${agentId} not found in Azure - will be cleaned up`);
              orphanAgentIds.push(agentId);
            }
          }
          
          // Clean up threads for agents that no longer exist
          if (orphanAgentIds.length > 0) {
            console.log(`[Sync] Cleaning up ${orphanAgentIds.length} orphan agent(s):`, orphanAgentIds);
            
            // Get orphan thread IDs before cleaning up state
            const state = useChatStore.getState();
            const orphanSet = new Set(orphanAgentIds);
            const orphanThreadIds = Object.entries(state.threads)
              .filter(([_, thread]) => orphanSet.has(thread.agentId || ""))
              .map(([threadId]) => threadId);
            
            // Delete orphan threads from backend (fire and forget)
            for (const threadId of orphanThreadIds) {
              try {
                await chatApi.deleteThread(threadId, userId);
                console.log(`[Sync] Deleted orphan thread ${threadId} from backend`);
              } catch (error) {
                console.warn(`[Sync] Failed to delete orphan thread ${threadId} from backend:`, error);
              }
            }
            
            useChatStore.setState((s) => {
              const orphanSet = new Set(orphanAgentIds);
              
              // Remove threads for deleted agents
              const cleanedThreads = Object.fromEntries(
                Object.entries(s.threads).filter(([_, thread]) => !orphanSet.has(thread.agentId || ""))
              );
              
              // Remove projects for deleted agents
              const cleanedProjects = Object.fromEntries(
                Object.entries(s.projects).filter(([_, project]) => !orphanSet.has(project.agentId || ""))
              );
              
              // Remove messages for deleted threads
              const remainingThreadIds = new Set(Object.keys(cleanedThreads));
              const cleanedMessages = Object.fromEntries(
                Object.entries(s.messagesByThreadId).filter(([threadId]) => remainingThreadIds.has(threadId))
              );
              
              console.log(`[Sync] Removed ${Object.keys(s.threads).length - Object.keys(cleanedThreads).length} orphan threads`);
              console.log(`[Sync] Removed ${Object.keys(s.projects).length - Object.keys(cleanedProjects).length} orphan projects`);
              
              return {
                threads: cleanedThreads,
                projects: cleanedProjects,
                messagesByThreadId: cleanedMessages,
              };
            });
          }
          
          // Update projects in store
          if (Object.keys(newProjects).length > 0) {
            useChatStore.setState((s) => ({
              projects: { ...s.projects, ...newProjects },
            }));
            console.log(`[Sync] Added ${Object.keys(newProjects).length} reconstructed projects`);
          }
        } catch (error) {
          console.error("[Sync] Failed to fetch agents for project reconstruction:", error);
        }
      }
      
      // Run cleanup after merging to remove any duplicates that came from backend
      useChatStore.getState().cleanupDuplicateThreads();
      hasLoadedBackendRef.current = true;
      debouncedSyncRef.current?.();
    } catch (error) {
      console.error("Failed to load from backend:", error);
    } finally {
      isLoadingRef.current = false;
    }
  }, [userId]);

  // Sync local data to backend - OPTIMIZED to only sync changed data
  const syncToBackend = useCallback(async () => {
    if (!userId || !hasLoadedBackendRef.current || isSyncingRef.current) return;

    const state = useChatStore.getState();
    const currentUserId = userId;
    const lastSynced = lastSyncedStateRef.current;
    
    // Find threads that have changed (new or updated)
    const changedThreads: ApiThread[] = [];
    const changedMessages: ApiMessage[] = [];
    
    for (const thread of Object.values(state.threads)) {
      // Only sync threads belonging to current user
      if (thread.userId && thread.userId !== currentUserId) continue;
      
      const lastThread = lastSynced.threads[thread.id];
      const isNewOrUpdated = !lastThread || thread.updatedAt > lastThread.updatedAt;
      
      if (isNewOrUpdated) {
        changedThreads.push(toApiThread(thread, currentUserId));
      }
    }
    
    // Find messages that are new or have been edited/retried
    for (const [threadId, msgs] of Object.entries(state.messagesByThreadId)) {
      const thread = state.threads[threadId];
      // Only sync threads belonging to current user
      if (thread?.userId && thread.userId !== currentUserId) continue;

      const lastFingerprints = lastSynced.messageFingerprints[threadId] || {};

      for (const msg of msgs) {
        if (!msg.id || !msg.content) continue;
        const fingerprint = messageFingerprint(msg);
        const lastFp = lastFingerprints[msg.id];

        if (lastFp !== fingerprint) {
          const apiMsg = toApiMessage(msg, threadId, currentUserId);
          if (apiMsg) {
            changedMessages.push(apiMsg);
          }
        }
      }
    }
    
    // Skip sync if nothing changed
    if (changedThreads.length === 0 && changedMessages.length === 0) {
      return;
    }

    isSyncingRef.current = true;

    try {
      // Sync only changed data to backend
      const result = await chatApi.sync({
        userId: currentUserId,
        threads: changedThreads,
        messages: changedMessages,
      });

      if (result.success) {
        // Update last synced state
        const newSyncedState: SyncedState = {
          threads: {},
          messageCounts: {},
          messageFingerprints: {},
        };
        for (const thread of Object.values(state.threads)) {
          if (thread.userId && thread.userId !== currentUserId) continue;
          newSyncedState.threads[thread.id] = { id: thread.id, updatedAt: thread.updatedAt };
        }
        for (const [threadId, msgs] of Object.entries(state.messagesByThreadId)) {
          const thread = state.threads[threadId];
          if (thread?.userId && thread.userId !== currentUserId) continue;
          newSyncedState.messageCounts[threadId] = msgs.length;
          // Store fingerprints for each message to detect future edits
          const fpMap: Record<string, string> = {};
          for (const msg of msgs) {
            if (msg.id) {
              fpMap[msg.id] = messageFingerprint(msg);
            }
          }
          newSyncedState.messageFingerprints[threadId] = fpMap;
        }
        lastSyncedStateRef.current = newSyncedState;
        syncRetryRef.current = 0;
        
        console.log(
          `[Sync] Synced ${result.threadsUpserted} threads, ${result.messagesUpserted} messages`
        );
      } else {
        console.error("[Sync] Failed:", result.error);
        scheduleSyncRetry(result.error || "sync reported failure");
      }
    } catch (error) {
      console.error("[Sync] Error:", error);
      scheduleSyncRetry(error instanceof Error ? error.message : "network error");
    } finally {
      isSyncingRef.current = false;
    }
  }, [userId, scheduleSyncRetry]);

  syncToBackendRef.current = syncToBackend;

  // Debounced sync - triggers after changes settle
  const debouncedSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(syncToBackend, SYNC_DEBOUNCE);
  }, [syncToBackend]);

  debouncedSyncRef.current = debouncedSync;

  // Closing, reloading or backgrounding the tab must not strand the pending batch.
  useEffect(() => {
    const flush = () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      void syncToBackend();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [syncToBackend]);

  // Load data on mount
  useEffect(() => {
    if (isAuthenticated && userId) {
      loadFromBackend();
    }
  }, [isAuthenticated, userId, loadFromBackend]);

  // Watch for changes and sync
  useEffect(() => {
    if (!isAuthenticated || !userId || !hasLoadedBackendRef.current) return;

    // A brand-new message is the only unrecoverable case — the local copy is
    // capped, so send it now instead of waiting out the debounce. Edits and
    // streaming updates stay batched.
    const synced = lastSyncedStateRef.current.messageCounts;
    const hasUnsentMessage = Object.entries(messagesByThreadId).some(
      ([threadId, msgs]) => msgs.length > (synced[threadId] ?? 0),
    );
    if (hasUnsentMessage) {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      void syncToBackend();
    } else {
      debouncedSync();
    }

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [threads, messagesByThreadId, isAuthenticated, userId, debouncedSync, syncToBackend]);

  // Force sync function for manual triggering - resets synced state to force full sync
  const forceSync = useCallback(async () => {
    lastSyncedStateRef.current = { threads: {}, messageCounts: {}, messageFingerprints: {} };
    await syncToBackend();
  }, [syncToBackend]);

  return {
    userId,
    isAuthenticated,
    loadFromBackend,
    forceSync,
  };
}
