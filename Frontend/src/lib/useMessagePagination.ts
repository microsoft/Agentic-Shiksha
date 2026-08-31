// src/lib/useMessagePagination.ts
// Hook for loading all messages from Cosmos DB at once (no pagination)

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { chatApi } from "./chatApi";
import type { ApiMessage } from "./chatApi";
import { useUserStore } from "./userStore";
import { useChatStore } from "./chatStore";
import { API_BASE_URL } from "./config";
import type { ChatMessage, ChatMsg, ClarifyQuestion, ContentBlock, QuizQuestion, FlashCard } from "./types";

// Number of recent messages to keep in localStorage (for offline/fast initial render)
export const MAX_LOCAL_MESSAGES = 20;

// Internal type for messages loaded from DB
interface LoadedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  // Generated doc metadata
  generatedDocId?: string;
  generatedDocTitle?: string;
  generatedDocContent?: string;
  // Retry tracking
  messageGroupId?: string;
  retryNumber?: number;
  // Image attachments
  imageUrls?: string[];
  // Content blocks for structured responses
  contentBlocks?: ContentBlock[];
  // Document block follow-up text
  docBlockContent?: string;
  // Research message support
  isResearch?: boolean;
  researchStartTime?: number;
  researchEndTime?: number;
  // Edit tracking - marks if this is the latest version
  isLatest?: boolean;
}

/**
 * Fix content that was accidentally JSON-stringified (contains literal \n instead of newlines)
 * This can happen if content was double-encoded somewhere in the pipeline
 */
function unescapeJsonContent(content: string): string {
  // Check if content looks like it was JSON-stringified (has literal \n and ends with "})
  if (content.includes('\\n') || content.endsWith('"}')) {
    try {
      // Try to parse as JSON first (in case the whole thing is a JSON string)
      if (content.startsWith('"') && content.endsWith('"')) {
        return JSON.parse(content);
      }
      // Otherwise just unescape common escape sequences
      return content
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/"\}$/, ''); // Remove trailing "}
    } catch {
      // If parsing fails, just do basic unescaping
      return content
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/"\}$/, '');
    }
  }
  return content;
}

/**
 * Convert API message to internal format
 */
function apiToLoadedMessage(apiMsg: ApiMessage): LoadedMessage {
  // Handle various timestamp formats - backend may return 'createdAt' or 'timestamp'
  const timestampStr = apiMsg.timestamp || apiMsg.createdAt;
  let createdAt: number;
  if (timestampStr) {
    const parsed = new Date(timestampStr).getTime();
    createdAt = isNaN(parsed) ? Date.now() : parsed;
  } else {
    createdAt = Date.now();
  }
  
  // Extract metadata for generated docs
  const metadata = apiMsg.metadata || {};
  
  // Fix content that was accidentally JSON-stringified
  const fixedContent = unescapeJsonContent(apiMsg.content);
  
  const result: LoadedMessage = {
    id: apiMsg.id,
    role: apiMsg.role,
    content: fixedContent,
    createdAt,
    // Include retry tracking fields
    messageGroupId: apiMsg.messageGroupId,
    retryNumber: apiMsg.retryNumber,
    // Include image URLs if present
    imageUrls: apiMsg.imageUrls,
    // Include isLatest field (default to true for backward compatibility)
    isLatest: apiMsg.isLatest ?? true,
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
  // Restore content blocks if present in metadata
  if (metadata.contentBlocks && Array.isArray(metadata.contentBlocks)) {
    result.contentBlocks = (metadata.contentBlocks as Array<Record<string, unknown>>).map(b => {
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
      } else if (b.type === 'tool_activity') {
        return {
          type: 'tool_activity' as const,
          activityId: (b.activityId as string) || '',
          label: (b.label as string) || 'Working',
          done: true,
        };
      } else if (b.type === 'generated_image') {
        return {
          type: 'generated_image' as const,
          generatedImageId: (b.generatedImageId as string) || '',
          title: (b.title as string) || 'Generated image',
          imageData: (b.imageData as string) || '',
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
      } else {
        return { type: 'document' as const, docId: (b.docId as string) || '', title: (b.title as string) || 'Document' };
      }
    });
  }
  // Restore document block follow-up text
  if (metadata.docBlockContent) {
    result.docBlockContent = metadata.docBlockContent as string;
  }
  // Add research metadata if present
  if (metadata.isResearch) {
    result.isResearch = true;
    if (metadata.researchStartTime) result.researchStartTime = metadata.researchStartTime as number;
    if (metadata.researchEndTime) result.researchEndTime = metadata.researchEndTime as number;
  }

  return result;
}

/**
 * Convert ChatMessage or LoadedMessage to ChatMsg for display (excludes system messages)
 */
function toChatMsg(msg: ChatMessage | LoadedMessage): ChatMsg | null {
  if ("role" in msg && msg.role === "system") return null;
  
  // Get generated doc fields from either ChatMessage or LoadedMessage
  const generatedDocId = 'generatedDocId' in msg ? msg.generatedDocId : undefined;
  const generatedDocTitle = 'generatedDocTitle' in msg ? msg.generatedDocTitle : undefined;
  const generatedDocContent = 'generatedDocContent' in msg ? msg.generatedDocContent : undefined;
  
  // Get createdAt timestamp - LoadedMessage always has it, ChatMessage may have it
  const createdAt = 'createdAt' in msg ? msg.createdAt : undefined;
  
  // Get retry tracking fields
  const messageGroupId = 'messageGroupId' in msg ? msg.messageGroupId : undefined;
  const retryNumber = 'retryNumber' in msg ? msg.retryNumber : undefined;
  
  // Get image URLs
  const imageUrls = 'imageUrls' in msg ? msg.imageUrls : undefined;
  
  // Get research flag
  const isResearch = 'isResearch' in msg ? msg.isResearch : undefined;
  const researchStartTime = 'researchStartTime' in msg ? msg.researchStartTime : undefined;
  const researchEndTime = 'researchEndTime' in msg ? msg.researchEndTime : undefined;
  
  // Get content blocks (structured responses: text + document + quiz + flashcard + challenge)
  const contentBlocks = 'contentBlocks' in msg ? msg.contentBlocks : undefined;
  const docBlockContent = 'docBlockContent' in msg ? msg.docBlockContent : undefined;
  
  return {
    role: msg.role as "user" | "assistant",
    content: msg.content,
    ...(createdAt && { createdAt }),
    ...(generatedDocId && { generatedDocId }),
    ...(generatedDocTitle && { generatedDocTitle }),
    ...(generatedDocContent && { generatedDocContent }),
    ...(messageGroupId && { messageGroupId }),
    ...(retryNumber !== undefined && { retryNumber }),
    ...(imageUrls && imageUrls.length > 0 && { imageUrls }),
    ...(isResearch && { isResearch }),
    ...(researchStartTime && { researchStartTime }),
    ...(researchEndTime && { researchEndTime }),
    ...(contentBlocks && contentBlocks.length > 0 && { contentBlocks }),
    ...(docBlockContent && { docBlockContent }),
  };
}

/**
 * Hook for loading all messages at once
 * - Loads all messages from Cosmos DB when thread changes
 * - Combines with local messages for new/pending messages
 * - Returns ChatMsg[] for display compatibility
 */
// Empty array constant to avoid creating new references
const EMPTY_MESSAGES: ChatMessage[] = [];

// Cache for loaded messages per thread (persists across component remounts)
const messageCache = new Map<string, { messages: LoadedMessage[]; total: number }>();

// Subscribers for cache invalidation events
const invalidationSubscribers = new Set<(threadId: string) => void>();

// The store id is cleared on logout and repopulated only after a successful auth
// sync. While it is empty the history fetch below was skipped entirely and the UI
// silently fell back to the trimmed localStorage copy, so fall back to the session.
let sessionUserIdPromise: Promise<string | null> | null = null;
function resolveSessionUserId(): Promise<string | null> {
  sessionUserIdPromise ??= fetch(`${API_BASE_URL.replace(/\/+$/, "")}/auth/me`, {
    credentials: "include",
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d?.id ?? null)
    .catch(() => null);
  return sessionUserIdPromise;
}

export function useMessagePagination(threadId: string | null) {
  const storeUserId = useUserStore((s) => s.userId);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const userId = storeUserId || sessionUserId;

  useEffect(() => {
    if (storeUserId) return;
    let cancelled = false;
    resolveSessionUserId().then((id) => {
      if (!cancelled && id) {
        console.warn("[Messages] userStore had no userId; using session id from /auth/me");
        setSessionUserId(id);
      }
    });
    return () => { cancelled = true; };
  }, [storeUserId]);

  const localMessages = useChatStore((s) => 
    threadId ? s.messagesByThreadId[threadId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  );

  // All messages loaded from the backend
  const [dbMessages, setDbMessages] = useState<LoadedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [total, setTotal] = useState(0);
  
  // Counter to force re-fetch when cache is invalidated
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Track the current thread to reset state when it changes
  const prevThreadIdRef = useRef<string | null>(null);
  // Track if we've loaded for this thread
  const loadedForThreadRef = useRef<string | null>(null);

  // Subscribe to cache invalidation events
  useEffect(() => {
    const handleInvalidation = (invalidatedThreadId: string) => {
      if (invalidatedThreadId === threadId) {
        // Trigger a reload by incrementing the counter
        setReloadTrigger(prev => prev + 1);
      }
    };
    
    invalidationSubscribers.add(handleInvalidation);
    return () => {
      invalidationSubscribers.delete(handleInvalidation);
    };
  }, [threadId]);

  // Reset state when thread changes - check cache first
  useEffect(() => {
    if (threadId !== prevThreadIdRef.current) {
      prevThreadIdRef.current = threadId;
      
      // Check if we have cached data for this thread
      if (threadId && messageCache.has(threadId)) {
        const cached = messageCache.get(threadId)!;
        setDbMessages(cached.messages);
        setTotal(cached.total);
        setIsLoading(false);
        loadedForThreadRef.current = threadId;
      } else {
        setDbMessages([]);
        setIsLoading(false);
        setTotal(0);
        loadedForThreadRef.current = null;
      }
    }
  }, [threadId]);

  // Load ALL messages when thread changes OR cache is invalidated
  useEffect(() => {
    if (!threadId || !userId) return;
    
    // Skip if already loaded and cache is still valid (reloadTrigger = 0 or same)
    if (loadedForThreadRef.current === threadId && messageCache.has(threadId) && reloadTrigger === 0) {
      return;
    }

    const loadAllMessages = async () => {
      console.log("[Messages] Loading all messages for thread:", threadId, "trigger:", reloadTrigger);
      setIsLoading(true);

      try {
        // Fetch all messages (large limit to get everything)
        const result = await chatApi.getMessages(threadId, userId, {
          limit: 1000,
        });

        console.log("[Messages] Loaded:", result.messages.length, "messages");

        const loadedMsgs = result.messages.map(apiToLoadedMessage);
        // Sort by timestamp (oldest first)
        loadedMsgs.sort((a, b) => a.createdAt - b.createdAt);

        // Cache the results
        messageCache.set(threadId, { messages: loadedMsgs, total: result.total });

        setDbMessages(loadedMsgs);
        setTotal(result.total);
        loadedForThreadRef.current = threadId;
      } catch (error) {
        console.error("[Messages] Failed to load messages:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAllMessages();
  }, [threadId, userId, reloadTrigger]);

  /**
   * Get all messages as ChatMsg[] for display
   * 
   * Strategy:
   * - DB messages are the source of truth (backend handles retry filtering)
   * - Local messages are only used for NEW messages not yet synced to DB
   * - For messages that exist in both, prefer local version if it has a more recent createdAt
   */
  const messages = useMemo((): ChatMsg[] => {
    // Effects reset dbMessages after a thread prop changes, but there is one
    // render before that reset runs. Never expose those previous-thread rows
    // under the new thread; use only the new thread's local store during the
    // handoff.
    if (loadedForThreadRef.current !== threadId) {
      // localStorage holds at most MAX_LOCAL_MESSAGES, so surface it as a
      // possibly-partial view rather than letting it pass for the full history.
      if (threadId && !isLoading && localMessages.length >= MAX_LOCAL_MESSAGES) {
        console.warn(
          `[Messages] Showing ${localMessages.length} cached messages for ${threadId}; server history not loaded`,
        );
      }
      return localMessages
        .map((message) => toChatMsg(message))
        .filter((message): message is ChatMsg => message !== null);
    }

    // If we haven't loaded from DB yet, return empty (show loading state)
    // This prevents the flicker from localStorage -> DB
    if (dbMessages.length === 0 && isLoading) {
      return [];
    }
    
    // If DB is loaded, use DB messages as the source of truth
    if (dbMessages.length > 0) {
      // Filter out messages that are not latest (edited/replaced messages)
      const latestDbMessages = dbMessages.filter(m => m.isLatest !== false);
      
      // Create a map of local messages by ID for quick lookup
      const localById = new Map(localMessages.map(m => [m.id, m]));
      const dbIds = new Set(latestDbMessages.map(m => m.id));
      
      // Convert DB messages, but use local timestamps when local message is more recent
      // This handles the case where user message createdAt was updated for retry
      const dbAsMsgs = latestDbMessages
        .map((m) => {
          const localVersion = localById.get(m.id);
          // If local version exists and has a more recent createdAt, use that timestamp
          const createdAt = (localVersion && localVersion.createdAt > m.createdAt) 
            ? localVersion.createdAt 
            : m.createdAt;
          const msg = toChatMsg(m);
          if (msg && localVersion && localVersion.createdAt > m.createdAt) {
            // Update the msg's createdAt to the local version
            msg.createdAt = localVersion.createdAt;
          }
          return { createdAt, msg };
        })
        .filter((x): x is { createdAt: number; msg: ChatMsg } => x.msg !== null);
      
      // Only include local messages that:
      // 1. Don't exist in DB (by ID)
      // 2. Are newer than the latest DB message (sent during this session)
      const latestDbTimestamp = Math.max(...latestDbMessages.map(m => m.createdAt));
      const newLocalMessages = localMessages
        .filter((m) => !dbIds.has(m.id) && m.createdAt > latestDbTimestamp)
        .map((m) => ({ createdAt: m.createdAt, msg: toChatMsg(m) }))
        .filter((x): x is { createdAt: number; msg: ChatMsg } => x.msg !== null);
      
      // Combine and sort by timestamp
      const combined = [...dbAsMsgs, ...newLocalMessages]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((x) => x.msg);
      
      return combined;
    }
    
    // DB load finished but no messages in DB - this is a new/empty thread
    // Show local messages (for new conversations not yet saved to DB)
    const localAsMsgs = localMessages
      .map((m) => toChatMsg(m))
      .filter((x): x is ChatMsg => x !== null);
    
    return localAsMsgs;
  }, [dbMessages, localMessages, isLoading, threadId]);

  // Reload messages (e.g., after sending a new message)
  const reloadMessages = useCallback(async () => {
    if (!threadId || !userId) return;
    
    console.log("[Messages] Reloading messages for thread:", threadId);
    setIsLoading(true);

    try {
      const result = await chatApi.getMessages(threadId, userId, {
        limit: 1000,
      });

      const loadedMsgs = result.messages.map(apiToLoadedMessage);
      loadedMsgs.sort((a, b) => a.createdAt - b.createdAt);

      // Update the cache
      messageCache.set(threadId, { messages: loadedMsgs, total: result.total });

      setDbMessages(loadedMsgs);
      setTotal(result.total);
    } catch (error) {
      console.error("[Messages] Failed to reload messages:", error);
    } finally {
      setIsLoading(false);
    }
  }, [threadId, userId]);

  return {
    // All messages to display as ChatMsg[]
    messages,
    // Loading state (for initial load)
    isLoading,
    totalMessages: total,
    // For backwards compatibility - no more pagination
    hasMore: false,
    // Actions
    loadOlderMessages: () => {}, // No-op - all messages already loaded
    reloadMessages,
    // Reset (when switching threads)
    reset: useCallback(() => {
      setDbMessages([]);
      setIsLoading(false);
      setTotal(0);
      loadedForThreadRef.current = null;
      // Clear cache for this thread so it reloads fresh next time
      if (threadId) {
        messageCache.delete(threadId);
      }
    }, [threadId]),
  };
}

/**
 * Invalidate the message cache for a specific thread
 * Call this after sending new messages to ensure fresh data on next load
 */
export function invalidateMessageCache(threadId: string) {
  messageCache.delete(threadId);
  // Notify all subscribers to reload
  invalidationSubscribers.forEach(subscriber => subscriber(threadId));
}

/**
 * Clear all message cache (useful for logout)
 */
export function clearAllMessageCache() {
  messageCache.clear();
}

/**
 * Utility to trim messages to only keep the most recent N messages
 * Used when persisting to localStorage
 */
export function trimToRecentMessages(
  messages: ChatMessage[],
  maxCount: number = MAX_LOCAL_MESSAGES
): ChatMessage[] {
  if (messages.length <= maxCount) return messages;
  
  // Sort by timestamp descending and take the most recent
  const sorted = [...messages].sort((a, b) => b.createdAt - a.createdAt);
  const recent = sorted.slice(0, maxCount);
  
  // Return in chronological order
  return recent.sort((a, b) => a.createdAt - b.createdAt);
}
