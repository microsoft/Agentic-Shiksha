import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import type { ChatMsg, ResearchData } from "@/lib/types";
import { simpleStreamChat, streamAgentChat, streamDeepResearch, uploadChatImages, type StreamEvent } from "@/lib/api";
import { streamAgentChatViaAGUI } from "@/lib/aguiAdapter";
import { USE_AGUI_TRANSPORT } from "@/lib/config";
import { useChatStore, computeProfileHash } from "@/lib/chatStore";
import { useCurrentUserId } from "@/lib/userStore";
import { useShallow } from "zustand/react/shallow";
import { logger } from "@/lib/loggingService";
import { extractJsonDocuments, type GeneratedDoc } from "@/features/create/markdownUtils";
import { invalidateMessageCache } from "@/lib/useMessagePagination";
import type { UploadedFile } from "@/features/create/sharedUI";
import { chatApi } from "@/lib/chatApi";
import { CLARIFICATION_SUBMITTED_EVENT } from "@/features/chat/chatQueryEvent";
import { getCourseName } from "@/lib/utils";

// Thinking token type for deep research
export interface ThinkingToken {
  summary: string;
  citations?: Array<{ url: string; title?: string }>;
  timestamp: number;
}

// Shown while a tool runs, so the wait is named rather than a bare spinner.
const TOOL_STATUS_LABELS: Record<string, string> = {
  add_tikz_diagram: "Creating image",
  add_document: "Generating a document",
  add_quiz: "Generating a quiz",
  add_flashcard: "Generating flashcards",
  add_challenge: "Generating a challenge",
  add_message: "Writing a response",
  ask_clarification: "Generating clarification questions",
  suggest_next_queries: "Suggesting follow-ups",
  get_threshold_concepts: "Loading threshold concept progress",
  update_topic_progress: "Saving your progress",
  search_knowledge_base: "Searching course material",
  memory_search: "Searching your memories",
  declare_plan: "Planning",
};

// Documents are ONLY created via:
// 1. The create_document tool (sets existingDocId in streaming path)
// 2. Explicit [DOCUMENT]...[/DOCUMENT] JSON tags in the response
// Regular chat responses (even with headings, lists, etc.) are never
// auto-extracted as documents.

// Adaptive typing speed configuration
const BASE_TICK_INTERVAL_MS = 12; // Base interval between ticks
const MIN_CHARS_PER_TICK = 2; // Minimum characters per tick (for short responses)
const MAX_CHARS_PER_TICK = 15; // Maximum characters per tick (for very long responses)
const TARGET_TYPING_DURATION_MS = 2500; // Target duration for typing effect (2.5 seconds)

// Calculate adaptive characters per tick based on response length
function getAdaptiveCharsPerTick(totalLength: number, currentPosition: number): number {
  // Calculate how many chars per tick to finish in target time
  const ticksNeeded = TARGET_TYPING_DURATION_MS / BASE_TICK_INTERVAL_MS;
  let baseChars = Math.ceil(totalLength / ticksNeeded);
  
  // Clamp to min/max bounds
  baseChars = Math.max(MIN_CHARS_PER_TICK, Math.min(MAX_CHARS_PER_TICK, baseChars));
  
  // Progressive acceleration: speed up as we go (1x at start, up to 1.5x near end)
  const progress = currentPosition / totalLength;
  const accelerationFactor = 1 + (progress * 0.5);
  
  return Math.ceil(baseChars * accelerationFactor);
}

// Generate a unique ID for each generation request
let generationIdCounter = 0;
function nextGenerationId(): number {
  return ++generationIdCounter;
}

// Helper to parse JSON response format with title and response
interface ParsedChatResponse {
  title: string | null;
  response: string;
}

function parseChatResponse(text: string): ParsedChatResponse {
  // Try to parse as JSON with title and response fields
  try {
    let jsonText = text.trim();
    
    // Handle markdown code fence: ```json ... ``` or ``` ... ```
    const codeFenceMatch = jsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeFenceMatch) {
      jsonText = codeFenceMatch[1].trim();
    } else if (jsonText.toLowerCase().startsWith('json')) {
      jsonText = jsonText.replace(/^json\s*/i, '').trim();
    }
    
    // Try to extract JSON object from the start of the response
    // This handles cases where the agent outputs JSON followed by more text
    if (jsonText.startsWith('{')) {
      // Find the matching closing brace
      let braceCount = 0;
      let jsonEndIndex = -1;
      let inString = false;
      let escapeNext = false;
      
      for (let i = 0; i < jsonText.length; i++) {
        const char = jsonText[i];
        
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        
        if (char === '\\' && inString) {
          escapeNext = true;
          continue;
        }
        
        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === '{') braceCount++;
          else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              jsonEndIndex = i;
              break;
            }
          }
        }
      }
      
      if (jsonEndIndex > 0) {
        const jsonPart = jsonText.substring(0, jsonEndIndex + 1);
        const remainingText = jsonText.substring(jsonEndIndex + 1).trim();
        
        try {
          const parsed = JSON.parse(jsonPart);
          if ('response' in parsed && typeof parsed.response === 'string') {
            // If there's remaining text after JSON, append it to response
            const fullResponse = remainingText 
              ? parsed.response + '\n\n' + remainingText 
              : parsed.response;
            return {
              title: parsed.title || null,
              response: fullResponse,
            };
          }
        } catch {
          // JSON parse failed, fall through to return original
        }
      }
    }
  } catch {
    // Not JSON or invalid JSON - return as-is
  }
  
  // Return original text if not parseable JSON format
  return {
    title: null,
    response: text,
  };
}

export function useAgentChat(
  agentId: string | null,
  agentName?: string,
  agentKind?: "learning" | "exam"
) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isStreaming, setIsStreaming] = useState(false); // Disables input while typing
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false); // Shows loading indicator
  const [activeToolLabel, setActiveToolLabel] = useState<string | null>(null);

  useEffect(() => {
    const onSubmitted = () => setActiveToolLabel(null);
    window.addEventListener(CLARIFICATION_SUBMITTED_EVENT, onSubmitted);
    return () => window.removeEventListener(CLARIFICATION_SUBMITTED_EVENT, onSubmitted);
  }, []);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]); // Track generated markdown docs
  
  // Ref to access latest threadId in async callbacks (avoids stale closure)
  const threadIdRef = useRef<string | null>(null);
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  // Ref to access latest generatedDocs in callbacks (avoids stale closure)
  const generatedDocsRef = useRef<GeneratedDoc[]>([]);
  useEffect(() => {
    generatedDocsRef.current = generatedDocs;
  }, [generatedDocs]);
  
  // Get current user ID for profile-based personalization
  const currentUserId = useCurrentUserId();
  
  // For simulated typing effect
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fullResponseRef = useRef<string>("");
  const displayedLengthRef = useRef<number>(0);
  
  // Pending doc info for current response (to attach after typing completes)
  const pendingDocRef = useRef<GeneratedDoc | null>(null);
  const pendingDocBlockRef = useRef<string>("");  // Text to show after document block
  
  // Streaming document ref - tracks document being streamed from backend
  const streamingDocRef = useRef<{ id: string; title: string; content: string } | null>(null);
  
  // Live streaming doc content - updated via RAF for smooth 60fps panel rendering
  // This is separate from generatedDocs to avoid the infinite re-render loop
  const [streamingDocContent, setStreamingDocContent] = useState<string>("");
  const streamingDocRafRef = useRef<number | null>(null);
  const streamingDocDirtyRef = useRef(false);
  
  // Content blocks ref - tracks ordered blocks as they stream in
  const contentBlocksRef = useRef<Array<{ type: "text" | "document" | "quiz" | "flashcard" | "challenge" | "tikz_image" | "generated_image" | "clarify" | "suggested_queries" | "tool_activity"; content: string; activityId?: string; label?: string; done?: boolean; docId?: string; title?: string; isStreaming: boolean; quizId?: string; assessmentType?: "concept_inventory" | "practice_quiz"; thresholdConcept?: string; questions?: Array<{ question: string; options: string[]; correct: number | number[]; explanation: string; targetsMisconception?: string }>; flashcardId?: string; cards?: Array<{ front: string; back: string }>; challengeId?: string; description?: string; difficulty?: string; hints?: string[]; solution?: string; challengeType?: string; chemImageId?: string; imageData?: string; caption?: string; smiles?: string; visualizationType?: string; tikzImageId?: string; generatedImageId?: string; imageUrl?: string; size?: string; quality?: string; clarifyId?: string; clarifyQuestions?: Array<{ question: string; options: string[]; context?: string }>; suggestionsId?: string; queries?: string[] }>>([]);
  const currentBlockIndexRef = useRef<number>(-1);  // Index of currently streaming block
  
  // Generation ID gating - prevents stale responses from updating state
  const currentGenerationIdRef = useRef<number>(0);
  
  // AbortController for cancelling in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Flag to prevent store sync from overwriting during active generation
  const isGeneratingRef = useRef<boolean>(false);
  
  // Retry tracking - stores the messageGroupId and current retry number for the current conversation turn
  const currentMessageGroupRef = useRef<{ id: string; retryNumber: number } | null>(null);

  const {
    activeThreadId,
    messagesByThreadId,
    appendMessage,
    createThreadForAgent,
    getOrCreateAgentProject,
    threads,
    truncateMessagesAfter,
    markMessagesNotLatest,
    renameThread,
    setThreadSessionUuid,
    updateMessageAt,
    setActiveResearch,
    updateActiveResearch,
    clearActiveResearch,
    getActiveResearch,
  } = useChatStore(
    useShallow((s) => ({
      activeThreadId: s.activeThreadId,
      messagesByThreadId: s.messagesByThreadId,
      appendMessage: s.appendMessage,
      createThreadForAgent: s.createThreadForAgent,
      getOrCreateAgentProject: s.getOrCreateAgentProject,
      threads: s.threads,
      truncateMessagesAfter: s.truncateMessagesAfter,
      markMessagesNotLatest: s.markMessagesNotLatest,
      renameThread: s.renameThread,
      setThreadSessionUuid: s.setThreadSessionUuid,
      updateMessageAt: s.updateMessageAt,
      setActiveResearch: s.setActiveResearch,
      updateActiveResearch: s.updateActiveResearch,
      clearActiveResearch: s.clearActiveResearch,
      getActiveResearch: s.getActiveResearch,
    }))
  );

  // Cleanup typing interval on unmount
  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
      }
    };
  }, []);

  // Track last synced message count + IDs to avoid redundant setMessages calls
  const lastSyncedMsgKeyRef = useRef<string>("");
  const conversationBoundaryRef = useRef(
    `${agentId ?? ""}:${activeThreadId ?? ""}`,
  );

  // A route-level course/thread switch is a hard conversation boundary. Clear
  // every local streaming ref before the store-sync effect hydrates the newly
  // selected thread; otherwise structured blocks from the previous chat cause
  // that sync to be skipped and leave the old transcript on screen.
  useLayoutEffect(() => {
    const nextBoundary = `${agentId ?? ""}:${activeThreadId ?? ""}`;
    if (conversationBoundaryRef.current === nextBoundary) return;
    conversationBoundaryRef.current = nextBoundary;

    // Switching mid-stream used to discard the partial reply outright, so coming
    // back showed nothing. Save what already arrived against the thread it
    // belongs to before the refs below are cleared.
    const leavingThreadId = threadIdRef.current;
    if (isGeneratingRef.current && leavingThreadId) {
      const blockText = contentBlocksRef.current
        .filter((b) => b.type === "text")
        .map((b) => b.content)
        .join("");
      const partial = (fullResponseRef.current || blockText).trim();
      if (partial) {
        appendMessage(leavingThreadId, {
          role: "assistant",
          content: partial,
          createdAt: Date.now(),
          isLatest: true,
        });
      }
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    if (streamingDocRafRef.current !== null) {
      cancelAnimationFrame(streamingDocRafRef.current);
      streamingDocRafRef.current = null;
    }

    currentGenerationIdRef.current = nextGenerationId();
    isGeneratingRef.current = false;
    fullResponseRef.current = "";
    displayedLengthRef.current = 0;
    pendingDocRef.current = null;
    pendingDocBlockRef.current = "";
    streamingDocRef.current = null;
    streamingDocDirtyRef.current = false;
    contentBlocksRef.current = [];
    currentBlockIndexRef.current = -1;
    currentMessageGroupRef.current = null;
    lastSyncedMsgKeyRef.current = "";
    threadIdRef.current = null;

    setMessages([]);
    setGeneratedDocs([]);
    setStreamingDocContent("");
    setThreadId(null);
    setIsStreaming(false);
    setIsWaitingForResponse(false);
            setActiveToolLabel(null);
  }, [activeThreadId, agentId, appendMessage]);

  // Sync messages from store when thread changes
  // Skip during active generation to prevent store overwriting local streaming state
  useEffect(() => {
    // Don't sync while actively generating - we manage local state during generation
    if (isGeneratingRef.current) {
      console.log('[useAgentChat] Skipping sync - isGeneratingRef is true');
      return;
    }
    
    // Skip sync if we have contentBlocks - they're built locally and not persisted to store yet
    // This preserves the streaming content blocks until the next navigation/refresh
    if (contentBlocksRef.current.length > 0) {
      console.log('[useAgentChat] Skipping sync - contentBlocksRef has blocks:', contentBlocksRef.current.length);
      return;
    }
    
    // Stability check: skip redundant setMessages if messages haven't changed
    // This prevents double-blink when useChatSync triggers a store update with the same data
    const storedMsgs = messagesByThreadId[activeThreadId || ''];
    if (activeThreadId && storedMsgs) {
      const msgKey = `${activeThreadId}:${storedMsgs.length}:${storedMsgs.map(m => m.id).join(',')}`;
      if (msgKey === lastSyncedMsgKeyRef.current) {
        return; // Messages identical to last sync — skip re-render
      }
      lastSyncedMsgKeyRef.current = msgKey;
    }
    
    console.log('[useAgentChat] Sync effect running - activeThreadId:', activeThreadId, 'hasMessages:', !!messagesByThreadId[activeThreadId || '']);
    
    if (activeThreadId && messagesByThreadId[activeThreadId]) {
      const storedMessages = messagesByThreadId[activeThreadId];
      console.log('[useAgentChat] Syncing from store, storedMessages:', storedMessages.map(m => ({
        role: m.role,
        hasImageUrls: !!m.imageUrls,
        imageUrlsCount: m.imageUrls?.length || 0,
        isResearch: m.isResearch,
        hasResearchData: !!m.research,
        researchStatus: m.research?.status,
      })));
      const chatMsgs: ChatMsg[] = storedMessages
        .filter((m) => m.role !== "system")
        .map((m) => ({ 
          role: m.role as "user" | "assistant", 
          content: m.content,
          // Preserve timestamp for response time calculation
          ...(m.createdAt && { createdAt: m.createdAt }),
          // Preserve generated doc info if present
          ...(m.generatedDocId && { generatedDocId: m.generatedDocId }),
          ...(m.generatedDocTitle && { generatedDocTitle: m.generatedDocTitle }),
          ...(m.generatedDocContent && { generatedDocContent: m.generatedDocContent }),
          // Preserve document block content if present
          ...(m.docBlockContent && { docBlockContent: m.docBlockContent }),
          // Preserve content blocks if present
          ...(m.contentBlocks && { contentBlocks: m.contentBlocks }),
          // Preserve image URLs for user messages
          ...(m.imageUrls && m.imageUrls.length > 0 && { imageUrls: m.imageUrls }),
          // Preserve research data if present
          ...(m.isResearch && { isResearch: m.isResearch }),
          ...(m.research && { research: m.research }),
          // Preserve retry tracking for message grouping
          ...(m.messageGroupId && { messageGroupId: m.messageGroupId }),
          ...(m.retryNumber !== undefined && { retryNumber: m.retryNumber }),
        }));
      
      // Check if there's an active research session for this thread
      const activeResearch = getActiveResearch(activeThreadId);
      if (activeResearch && activeResearch.status === "running") {
        console.log('[useAgentChat] Restoring active research for thread:', activeThreadId, activeResearch.id);
        // Add a research message with the active research data
        const hasResearchMessage = chatMsgs.some(m => m.isResearch && m.research?.id === activeResearch.id);
        if (!hasResearchMessage) {
          chatMsgs.push({
            role: "assistant",
            content: "",
            isResearch: true,
            research: activeResearch,
            createdAt: activeResearch.startTime,
          });
        }
      }
      
      // Log the final messages array with research status
      console.log('[useAgentChat] Final messages after sync:', chatMsgs.map(m => ({
        role: m.role,
        isResearch: m.isResearch,
        hasResearch: !!m.research,
        researchStatus: m.research?.status,
      })));
      
      setMessages(chatMsgs);
      
      // Rebuild generatedDocs from stored messages
      const restoredDocs: GeneratedDoc[] = storedMessages
        .filter((m) => m.generatedDocId && m.generatedDocContent)
        .map((m) => ({
          id: m.generatedDocId!,
          title: m.generatedDocTitle || "Generated document",
          content: m.generatedDocContent!,
        }));
      setGeneratedDocs(restoredDocs);
      
      // Sync the Azure thread ID from per-thread context.
      // CRITICAL: always clear first so a stale ID from a previous thread
      // can never leak into a new conversation.
      const thread = threads[activeThreadId];
      const azureId = thread?.context?.sessionUuid ?? null;
      setThreadId(azureId);
      threadIdRef.current = azureId;
    } else {
      console.log('[useAgentChat] CLEARING MESSAGES - no activeThreadId, isGeneratingRef:', isGeneratingRef.current, 'contentBlocksRef.length:', contentBlocksRef.current.length);
      if (!isGeneratingRef.current && contentBlocksRef.current.length === 0) {
        setMessages([]);
        setGeneratedDocs([]);
        setThreadId(null);
      } else {
        console.log('[useAgentChat] Skipped clearing - generation in progress or has content blocks');
      }
    }
  }, [activeThreadId, messagesByThreadId, threads, getActiveResearch]);

  // Track previous agent ID to detect actual agent changes (not just initial mount)
  const prevAgentIdRef = useRef<string | null>(null);

  // Reset messages when agent ACTUALLY changes (mode switch, not initial mount)
  // But DON'T reset if we have messages in the store for the new activeThreadId
  // This allows restoring previous chat when switching back to a mode
  useEffect(() => {
    // Only clear if we had a previous agent and it's different from current
    // AND the new thread doesn't have messages (i.e., it's a fresh thread, not restored)
    if (prevAgentIdRef.current !== null && prevAgentIdRef.current !== agentId) {
      // Check if the current activeThreadId has messages - if so, don't clear
      // This happens when restoring a previous thread during mode switch
      const hasStoredMessages = activeThreadId && messagesByThreadId[activeThreadId]?.length > 0;
      console.log('[useAgentChat] Agent change effect - prevAgent:', prevAgentIdRef.current, 'newAgent:', agentId, 'hasStoredMessages:', hasStoredMessages, 'isGeneratingRef:', isGeneratingRef.current, 'contentBlocksRef.length:', contentBlocksRef.current.length);
      if (!hasStoredMessages && !isGeneratingRef.current && contentBlocksRef.current.length === 0) {
        console.log('[useAgentChat] CLEARING MESSAGES - agent changed, no stored messages');
        setMessages([]);
        setThreadId(null);
      } else {
        console.log('[useAgentChat] Skipped clearing on agent change');
      }
    }
    prevAgentIdRef.current = agentId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, activeThreadId]); // Removed messagesByThreadId to prevent loops

  // Ensure project exists when agent changes
  useEffect(() => {
    if (agentId) {
      // Always use "course" kind now (single agent per course)
      getOrCreateAgentProject(agentId, agentName ?? "Agent", "course");
    }
  }, [agentId, agentName, getOrCreateAgentProject]);

  // Simulated typing effect - reveals text progressively
  // Uses generationId to ensure stale intervals don't update state
  const startTypingEffect = useCallback((
    fullText: string, 
    currentThreadId: string | null, 
    generationId: number,
    logAgentId?: string,
    logAgentName?: string,
    logAgentKind?: 'learning' | 'exam'
  ) => {
    // First, try to parse JSON response format with title and response
    const parsedResponse = parseChatResponse(fullText);
    const textToProcess = parsedResponse.response;
    
    // If we got a title and this is a new thread (first assistant message), rename it
    if (parsedResponse.title && currentThreadId) {
      // Check if this is the first assistant message by seeing if thread has only user messages
      const threadMessages = messagesByThreadId[currentThreadId] || [];
      const hasAssistantMessage = threadMessages.some(m => m.role === 'assistant');
      if (!hasAssistantMessage) {
        renameThread(currentThreadId, parsedResponse.title);
      }
    }
    
    // Check for JSON document format first: [DOCUMENT]{"title":"...","content":"..."}[/DOCUMENT]
    const jsonDocs = extractJsonDocuments(textToProcess);
    let displayText = textToProcess;
    let docBlockText = "";  // Text to show after document block
    let doc: GeneratedDoc | null = null;
    
    if (jsonDocs && jsonDocs.documents.length > 0) {
      // Has JSON documents - extract them all
      const createdDocs: GeneratedDoc[] = jsonDocs.documents.map((d) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: d.title,
        content: d.content,
        hasExplicitTitle: true,
        messageGroupId: currentMessageGroupRef.current?.id,
      }));
      
      // Store all docs
      setGeneratedDocs((prev) => [...prev, ...createdDocs]);
      
      // Use the first doc as the pending doc for message attachment
      doc = createdDocs[0];
      pendingDocRef.current = doc;
      
      // For single document: first text part is before, second is after
      // For multiple docs: combine all text parts
      if (jsonDocs.documents.length === 1 && jsonDocs.textParts.length >= 1) {
        displayText = jsonDocs.textParts[0] || `Generated document: ${doc.title}`;
        docBlockText = jsonDocs.textParts.slice(1).join("\n\n").trim();
      } else {
        displayText = jsonDocs.textParts.join("\n\n").trim() ||
          `Generated ${createdDocs.length} document${createdDocs.length > 1 ? 's' : ''}: ${createdDocs.map(d => d.title).join(', ')}`;
      }
      
      // Store docBlockText in a ref for later use
      pendingDocBlockRef.current = docBlockText;
    } else {
      // No JSON document tags — treat as a regular chat message
      // Documents are only created via the create_document tool (handled in streaming path)
      pendingDocRef.current = null;
      pendingDocBlockRef.current = "";
    }
    
    fullResponseRef.current = displayText;
    displayedLengthRef.current = 0;
    
    // Clear any existing interval
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
    }
    
    typingIntervalRef.current = setInterval(() => {
      // Check if this generation is still current - exit if stale
      if (generationId !== currentGenerationIdRef.current) {
        if (typingIntervalRef.current) {
          clearInterval(typingIntervalRef.current);
          typingIntervalRef.current = null;
        }
        return;
      }
      
      const totalLength = fullResponseRef.current.length;
      const charsToAdd = getAdaptiveCharsPerTick(totalLength, displayedLengthRef.current);
      displayedLengthRef.current += charsToAdd;
      
      if (displayedLengthRef.current >= fullResponseRef.current.length) {
        // Finished typing - show full text with doc info if present
        displayedLengthRef.current = fullResponseRef.current.length;
        if (typingIntervalRef.current) {
          clearInterval(typingIntervalRef.current);
          typingIntervalRef.current = null;
        }
        
        const pendingDoc = pendingDocRef.current;
        const docBlockContent = pendingDocBlockRef.current;
        setMessages((m) => {
          const updated = [...m];
          const lastMsg = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...lastMsg,  // Preserve createdAt
            role: "assistant",
            content: fullResponseRef.current,
            // Attach doc info if we extracted one
            ...(pendingDoc && {
              generatedDocId: pendingDoc.id,
              generatedDocTitle: pendingDoc.title,
              docBlockContent: docBlockContent || undefined,
            }),
          };
          return updated;
        });
        
        // Persist final assistant message to store (including doc info and retry tracking)
        if (currentThreadId) {
          const groupInfo = currentMessageGroupRef.current;
          appendMessage(currentThreadId, { 
            role: "assistant", 
            content: fullResponseRef.current,
            createdAt: Date.now(),
            isLatest: true,  // Mark as latest version
            // Include doc info in persisted message
            ...(pendingDoc && {
              generatedDocId: pendingDoc.id,
              generatedDocTitle: pendingDoc.title,
              generatedDocContent: pendingDoc.content,
              docBlockContent: docBlockContent || undefined,
            }),
            // Include retry tracking info
            ...(groupInfo && {
              messageGroupId: groupInfo.id,
              retryNumber: groupInfo.retryNumber,
            }),
          });
        }
        
        // Log message received
        if (logAgentId && logAgentName && logAgentKind) {
          logger.logMessageReceived({
            threadId: currentThreadId || '',
            agentId: logAgentId,
            agentName: logAgentName,
            agentKind: logAgentKind,
            content: fullResponseRef.current,
            messageIndex: -1, // Will be last message
          });
        }
        
        // Generation complete - allow store sync again
        isGeneratingRef.current = false;
        setIsStreaming(false);
      } else {
        // Show partial text
        setMessages((m) => {
          const updated = [...m];
          const lastMsg = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...lastMsg,  // Preserve createdAt
            role: "assistant",
            content: fullResponseRef.current.substring(0, displayedLengthRef.current),
          };
          return updated;
        });
      }
    }, BASE_TICK_INTERVAL_MS);
  }, [appendMessage, messagesByThreadId, renameThread]);

  // Research mode callbacks interface
  interface ResearchModeCallbacks {
    onResearchTriggered?: (query: string) => void;
    onThinking?: (token: ThinkingToken) => void;
    onResearchStatus?: (status: string) => void;
    onResearchComplete?: (response: string, citations?: Array<{ url: string; title?: string }>) => void;
  }

  interface SendOptions {
    skipUserMessage?: boolean;
    messageGroupId?: string;
    retryNumber?: number;
    userMessageTimestamp?: number;
  }

  async function send(
    text: string, 
    webSearchEnabled: boolean = false, 
    researchMode: boolean = false,
    researchCallbacks?: ResearchModeCallbacks,
    attachedFiles?: UploadedFile[],
    displayText?: string,
    sendOptions: SendOptions = {},
  ) {
    // Allow sending if there's text OR attached files
    if (!agentId || (!text.trim() && (!attachedFiles || attachedFiles.length === 0)) || isStreaming) return;
    const t = text.trim();
    // displayText: if provided, shown in the chat bubble instead of the raw API text
    const visibleText = displayText?.trim() || t;
    
    // Cancel any existing request and set up new generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const generationId = nextGenerationId();
    currentGenerationIdRef.current = generationId;
    isGeneratingRef.current = true;
    
    // Capture timestamp for response time calculation (used for both local and persisted message)
    const userMsgTimestamp = sendOptions.userMessageTimestamp ?? Date.now();
    
    // Generate a new message group ID for this conversation turn (user message + its responses)
    const messageGroupId = sendOptions.messageGroupId
      ?? `mg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    currentMessageGroupRef.current = {
      id: messageGroupId,
      retryNumber: sendOptions.retryNumber ?? 0,
    };
    
    // Ensure we have a thread in the store
    let currentThreadId = activeThreadId;
    if (!currentThreadId) {
      // This should rarely happen - the caller should ensure activeThreadId is set
      // before calling send() to prevent duplicate thread creation
      console.warn('[useAgentChat] No activeThreadId when send() called - creating new thread. This may cause duplicates if a thread was already created.');
      currentThreadId = createThreadForAgent(agentId);
    }

    // Upload attached images if any
    let imageUrls: string[] = [];  // Blob storage URLs for persistence
    let previewUrls: string[] = []; // Local preview URLs for display
    let base64Urls: string[] = [];  // Base64 data URLs for agent
    if (attachedFiles && attachedFiles.length > 0) {
      console.log(`[useAgentChat] attachedFiles received:`, attachedFiles);
      // Filter only image files
      const imageFiles = attachedFiles.filter(f => {
        const ext = f.file.name.split('.').pop()?.toLowerCase() || '';
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
        console.log(`[useAgentChat] File: ${f.file.name}, ext: ${ext}, isImage: ${isImage}`);
        return isImage;
      });
      
      if (imageFiles.length > 0) {
        // Collect preview URLs for display (these are local blob: URLs)
        previewUrls = imageFiles
          .map(f => f.preview)
          .filter((url): url is string => !!url);
        
        // Convert files to base64 data URLs (instant, no network)
        console.log(`[useAgentChat] Converting ${imageFiles.length} images to base64...`);
        base64Urls = await Promise.all(
          imageFiles.map(f => new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(f.file);
          }))
        );
        console.log(`[useAgentChat] Converted ${base64Urls.length} images to base64`);
        
        // Upload to blob in background for persistence (don't block the agent call)
        uploadChatImages(
          imageFiles.map(f => f.file),
          currentThreadId,
          agentId
        ).then(result => {
          console.log(`[useAgentChat] Background upload result:`, result);
          if (result.errors.length > 0) {
            console.warn('[useAgentChat] Some images failed to upload:', result.errors);
          }
          imageUrls = result.urls;
          // Update existing message's imageUrls with blob URLs (find by createdAt timestamp)
          if (currentThreadId && result.urls.length > 0) {
            const stored = useChatStore.getState().messagesByThreadId[currentThreadId] || [];
            const msgIndex = stored.findIndex(m => m.role === 'user' && m.createdAt === userMsgTimestamp);
            if (msgIndex >= 0) {
              useChatStore.getState().updateMessageAt(currentThreadId, msgIndex, { imageUrls: result.urls });
              console.log('[useAgentChat] Updated existing message imageUrls at index', msgIndex);
            } else {
              console.warn('[useAgentChat] Could not find user message to update imageUrls');
            }
          }
        }).catch(err => {
          console.error('[useAgentChat] Background image upload failed:', err);
        });
      } else {
        console.log(`[useAgentChat] No image files found in attachedFiles`);
      }
    } else {
      console.log(`[useAgentChat] No attachedFiles provided`);
    }
    
    // Show user message immediately with local preview URLs
    const displayUrls = previewUrls;
    
    const kind = agentKind ?? (agentName?.toLowerCase().startsWith("exam") ? "exam" : "learning");
    if (!sendOptions.skipUserMessage) {
      // Add user message locally with timestamp and displayUrls for immediate UI
      setMessages((m) => [...m, {
        role: "user",
        content: visibleText,
        createdAt: userMsgTimestamp,
        ...(displayUrls.length > 0 && { imageUrls: displayUrls }),
      }]);

      // Persist user message without image URLs; the background upload patches them later.
      if (currentThreadId) {
        const msgToAppend = {
          role: "user" as const,
          content: visibleText,
          createdAt: userMsgTimestamp,
          messageGroupId,
          retryNumber: 0,
        };
        console.log('[useAgentChat] Appending message to store:', {
          threadId: currentThreadId,
          note: 'imageUrls will be patched by background upload',
        });
        appendMessage(currentThreadId, msgToAppend);
      }

      logger.logMessageSent({
        threadId: currentThreadId || '',
        agentId,
        agentName: agentName || 'Unknown',
        agentKind: kind,
        content: t,
        messageIndex: messages.length,
      });
    }

    // Show loading indicator while waiting for API
    setIsStreaming(true);
    setIsWaitingForResponse(true);

    // Use dedicated deep research endpoint for research mode
    if (researchMode) {
      try {
        const localThreadId = currentThreadId;
        const researchId = `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        // Create research data immediately — no clarification phase
        const researchData: ResearchData = {
          id: researchId,
          query: t,
          status: "running",
          startTime: Date.now(),
          activities: [],
          sources: [],
          searchCount: 0,
        };
        
        // Save to store so it survives navigation
        if (localThreadId) {
          setActiveResearch(localThreadId, researchData);
        }
        
        // Add research message placeholder
        setMessages((m) => [...m, { 
          role: "assistant", 
          content: "",
          isResearch: true,
          research: researchData,
          createdAt: Date.now(),
        }]);
        setIsWaitingForResponse(false);
            setActiveToolLabel(null);
        researchCallbacks?.onResearchTriggered?.(t);
        
        // Call the dedicated deep research streaming endpoint
        let finalResult = "";
        
        let deepResearchThreadId: string | null = null;
        
        await new Promise<void>((resolve, reject) => {
          const abort = streamDeepResearch(t, {
            onThreadId: (threadId) => {
              deepResearchThreadId = threadId;
              console.log("[useAgentChat] Deep research thread ID:", threadId);
            },
            onThinking: (event) => {
              if (generationId !== currentGenerationIdRef.current) return;
              
              const content = event.summary;
              const lowerContent = content.toLowerCase();
              
              // Skip only internal run status messages — keep all reasoning/questions
              if (
                lowerContent.includes('runstatus') ||
                lowerContent.startsWith('run_') ||
                (lowerContent.includes('run status') && lowerContent.includes('in_progress')) ||
                lowerContent === 'queued' ||
                lowerContent === 'in_progress'
              ) {
                return;
              }
              
              // Extract sources from citations
              const newSources = (event.citations || []).map((c) => {
                try {
                  const url = new URL(c.url);
                  return {
                    title: c.title || url.hostname,
                    url: c.url,
                    domain: url.hostname,
                    favicon: `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`,
                  };
                } catch {
                  return { title: c.title || c.url, url: c.url, domain: c.url };
                }
              });
              
              setMessages((m) => {
                const updated = [...m];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg.research) {
                  const existingSources = lastMsg.research.sources || [];
                  const existingUrls = new Set(existingSources.map(s => s.url));
                  const uniqueNewSources = newSources.filter(s => !existingUrls.has(s.url));
                  
                  updated[updated.length - 1] = {
                    ...lastMsg,
                    research: {
                      ...lastMsg.research,
                      sources: [...existingSources, ...uniqueNewSources],
                      activities: [
                        ...lastMsg.research.activities,
                        { type: "thinking" as const, content, timestamp: Date.now(), citations: (event.citations || []).map(c => ({ url: c.url, title: c.title || "" })) },
                      ],
                    },
                  };
                  
                  if (localThreadId) {
                    updateActiveResearch(localThreadId, {
                      sources: [...existingSources, ...uniqueNewSources],
                    });
                  }
                }
                return updated;
              });
              
              researchCallbacks?.onThinking?.({ summary: event.summary, citations: event.citations, timestamp: Date.now() });
            },
            onStatus: (event) => {
              if (generationId !== currentGenerationIdRef.current) return;
              
              const lowerStatus = event.status.toLowerCase();
              // Skip internal/bare status messages that shouldn't create activities
              if (
                lowerStatus.includes('runstatus') || 
                lowerStatus.includes('in_progress') || 
                lowerStatus.includes('queued') ||
                lowerStatus === 'starting' ||
                lowerStatus === 'starting_research'
              ) {
                return;
              }
              
              // Use the message field for display if available, fall back to status
              const displayText = (event as any).message || event.status;
              
              let activityType: "search" | "read" | "thinking" = "thinking";
              if (lowerStatus.includes("search") || lowerStatus.includes("researching")) activityType = "search";
              else if (lowerStatus.includes("read") || lowerStatus.includes("browsing")) activityType = "read";
              
              setMessages((m) => {
                const updated = [...m];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg.research) {
                  updated[updated.length - 1] = {
                    ...lastMsg,
                    research: {
                      ...lastMsg.research,
                      searchCount: activityType === "search" ? lastMsg.research.searchCount + 1 : lastMsg.research.searchCount,
                      activities: [...lastMsg.research.activities, { type: activityType, content: displayText, timestamp: Date.now() }],
                    },
                  };
                }
                return updated;
              });
              researchCallbacks?.onResearchStatus?.(event.status);
            },
            onComplete: (event) => {
              if (generationId !== currentGenerationIdRef.current) return;
              
              finalResult = event.response || "";
              
              // Build sources from API citations
              let sources = (event.citations || []).map((c) => {
                try {
                  const url = new URL(c.url);
                  return { title: c.title || url.hostname, url: c.url, domain: url.hostname, favicon: `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32` };
                } catch {
                  return { title: c.title || c.url, url: c.url, domain: c.url };
                }
              });
              
              // Fallback: extract URLs from the response text if no API citations
              if (sources.length === 0 && finalResult) {
                const urlRegex = /https?:\/\/[^\s\)>\]"',]+/g;
                const foundUrls = new Set<string>();
                let match;
                while ((match = urlRegex.exec(finalResult)) !== null) {
                  // Clean trailing punctuation
                  let url = match[0].replace(/[.),:;]+$/, "");
                  if (!foundUrls.has(url)) {
                    foundUrls.add(url);
                    try {
                      const parsed = new URL(url);
                      sources.push({
                        title: parsed.hostname.replace(/^www\./, ""),
                        url,
                        domain: parsed.hostname,
                        favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`,
                      });
                    } catch { /* skip invalid */ }
                  }
                }
              }
              
              setMessages((m) => {
                const updated = [...m];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg.research) {
                  updated[updated.length - 1] = {
                    ...lastMsg,
                    content: event.response || "",
                    research: { ...lastMsg.research, sources, result: event.response || "", status: "completed", endTime: Date.now() },
                  };
                }
                return updated;
              });
              
              if (localThreadId) {
                clearActiveResearch(localThreadId);
              }
              researchCallbacks?.onResearchComplete?.(event.response, event.citations);
              
              // Persist research message
              setTimeout(() => {
                if (localThreadId) {
                  const groupInfo = currentMessageGroupRef.current;
                  appendMessage(localThreadId, {
                    role: "assistant",
                    content: finalResult,
                    isResearch: true,
                    research: { id: researchId, query: t, status: "completed", startTime: researchData.startTime, endTime: Date.now(), activities: [], sources, result: finalResult, searchCount: 0 },
                    researchStartTime: researchData.startTime,
                    researchEndTime: Date.now(),
                    createdAt: Date.now(),
                    ...(groupInfo && { messageGroupId: groupInfo.id, retryNumber: groupInfo.retryNumber }),
                  });
                }
              }, 100);
              
              isGeneratingRef.current = false;
              setIsStreaming(false);
              resolve();
            },
            onClarification: (event) => {
              if (generationId !== currentGenerationIdRef.current) return;
              
              console.log("[useAgentChat] Deep research clarification received, threadId:", event.thread_id);
              
              // Update research message with clarification status and MCQ text
              setMessages((m) => {
                const updated = [...m];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg.research) {
                  updated[updated.length - 1] = {
                    ...lastMsg,
                    content: event.response,
                    research: {
                      ...lastMsg.research,
                      status: "clarification",
                      clarificationText: event.response,
                      deepResearchThreadId: event.thread_id,
                    },
                  };
                }
                return updated;
              });
              
              // Stop streaming — user needs to interact with MCQ
              isGeneratingRef.current = false;
              setIsStreaming(false);
              setIsWaitingForResponse(false);
            setActiveToolLabel(null);
              resolve();
            },
            onError: (error) => {
              console.error("Deep research error:", error);
              setMessages((m) => {
                const updated = [...m];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg.research) {
                  updated[updated.length - 1] = { ...lastMsg, content: `Error: ${error}`, research: { ...lastMsg.research, status: "error", endTime: Date.now(), error } };
                }
                return updated;
              });
              if (localThreadId) clearActiveResearch(localThreadId);
              isGeneratingRef.current = false;
              setIsStreaming(false);
              resolve();
            },
          });
          
          // Store abort function for stop button
          if (abortControllerRef.current) {
            const originalAbort = abortControllerRef.current.abort.bind(abortControllerRef.current);
            abortControllerRef.current.abort = () => { abort(); originalAbort(); };
          }
        });
        
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          if (currentThreadId) clearActiveResearch(currentThreadId);
          return;
        }
        
        console.error("Research mode error:", error);
        setMessages((m) => {
          const updated = [...m];
          if (updated.length > 0) {
            updated[updated.length - 1] = { role: "assistant", content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}` };
          }
          return updated;
        });
        if (currentThreadId) clearActiveResearch(currentThreadId);
        isGeneratingRef.current = false;
        setIsStreaming(false);
        setIsWaitingForResponse(false);
            setActiveToolLabel(null);
      }
      return;
    }

    // Regular chat mode: use SSE streaming for real-time response
    try {
      const localThreadId = currentThreadId;
      
      // Add placeholder for assistant response with timestamp
      setMessages((m) => [...m, { 
        role: "assistant", 
        content: "",
        createdAt: Date.now(),
      }]);
      // Keep isWaitingForResponse true until first delta arrives
      
      // Get the abort signal for cancellation
      const signal = abortControllerRef.current?.signal;
      
      // Track accumulated content for persistence
      let accumulatedContent = "";
      let hasReceivedFirstDelta = false;
      
      // Capture original user message for title generation
      const originalUserMessage = t;
      
      // Reset content blocks for new response
      contentBlocksRef.current = [];
      currentBlockIndexRef.current = -1;
      
      // Helper to update message with current content blocks
      const updateMessageWithBlocks = () => {
        const blocks = contentBlocksRef.current;

        // Deltas that arrive before any block land in accumulatedContent only. Promote that
        // prose to a leading text block, otherwise a late block (suggestions, clarify) would
        // rebuild the message from zero text blocks and erase the answer.
        if (accumulatedContent && !blocks.some(b => b.type === "text")) {
          const prose = parseChatResponse(accumulatedContent).response;
          if (prose) {
            blocks.unshift({ type: "text", content: prose, isStreaming: false });
            if (currentBlockIndexRef.current >= 0) currentBlockIndexRef.current += 1;
          }
        }

        console.log("[useAgentChat] updateMessageWithBlocks called, blocks:", JSON.stringify(blocks.map(b => ({ type: b.type, contentLen: b.content?.length || 0, title: b.title, docId: b.docId }))));
        
        // Build content string from text blocks for backward compatibility
        const textContent = blocks
          .filter(b => b.type === "text")
          .map(b => b.content)
          .join("");
        
        // Build contentBlocks array for the message
        const contentBlocks = blocks.map(b => {
          if (b.type === "text") {
            return { type: "text" as const, content: b.content, isStreaming: b.isStreaming };
          } else if (b.type === "quiz") {
            return { 
              type: "quiz" as const, 
              quizId: b.quizId!, 
              title: b.title || "Quiz",
              questions: b.questions || [],
            };
          } else if (b.type === "flashcard") {
            return { 
              type: "flashcard" as const, 
              flashcardId: b.flashcardId!, 
              title: b.title || "Flashcards",
              cards: b.cards || [],
            };
          } else if (b.type === "challenge") {
            return { 
              type: "challenge" as const, 
              challengeId: b.challengeId!, 
              title: b.title || "Challenge",
              description: b.description || "",
              difficulty: b.difficulty || "medium",
              hints: b.hints || [],
              solution: b.solution || "",
              challengeType: b.challengeType || "problem",
            };
          } else if (b.type === "tikz_image") {
            return {
              type: "tikz_image" as const,
              tikzImageId: b.tikzImageId!,
              title: b.title || "Physics Diagram",
              imageData: b.imageData || "",
              caption: b.caption || "",
              visualizationType: b.visualizationType || "",
            };
          } else if (b.type === "generated_image") {
            return {
              type: "generated_image" as const,
              generatedImageId: b.generatedImageId!,
              title: b.title || "Generated image",
              // Bytes live in blob storage; base64 would blow the Cosmos item limit.
              imageData: "",
              imageUrl: b.imageUrl || "",
              caption: b.caption || "",
              size: b.size || "",
              quality: b.quality || "",
            };
          } else if (b.type === "clarify") {
            return {
              type: "clarify" as const,
              clarifyId: b.clarifyId!,
              questions: b.clarifyQuestions || [],
            };
          } else if (b.type === "suggested_queries") {
            return {
              type: "suggested_queries" as const,
              suggestionsId: b.suggestionsId!,
              queries: b.queries || [],
            };
          } else if (b.type === "tool_activity") {
            return {
              type: "tool_activity" as const,
              activityId: b.activityId!,
              label: b.label || "Working",
              done: b.done ?? false,
            };
          } else {
            return { 
              type: "document" as const, 
              docId: b.docId!, 
              title: b.title || "Document",
              isStreaming: b.isStreaming 
            };
          }
        });
        
        // Get first doc for backward compat
        const firstDoc = blocks.find(b => b.type === "document");
        
        console.log("[useAgentChat] Setting contentBlocks:", contentBlocks.length, "textContent length:", textContent.length);
        
        setMessages((m) => {
          const updated = [...m];
          if (updated.length > 0) {
            const lastMsg = updated[updated.length - 1];
            updated[updated.length - 1] = {
              ...lastMsg,
              content: textContent,
              contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
              ...(firstDoc && {
                generatedDocId: firstDoc.docId,
                generatedDocTitle: firstDoc.title,
              }),
            };
          }
          return updated;
        });
      };
      
      // Read the Azure thread ID strictly from the per-thread store.
      // Never fall back to threadIdRef/threadId — that could leak a
      // previous thread's conversation ID into a new chat.
      const freshAzureThreadId = currentThreadId
        ? (useChatStore.getState().threads[currentThreadId]?.context?.sessionUuid ?? null)
        : null;
      console.log("[useAgentChat] Resolved Azure threadId for streamAgentChat:", freshAzureThreadId, "| localThread:", currentThreadId);
      
      // Determine if profile should be injected for this conversation turn.
      // Profile is only injected: (1) on first message of a new chat, or
      // (2) when the user's profile has changed since the last injection in this thread.
      const chatState = useChatStore.getState();
      const shouldInject = freshAzureThreadId
        ? chatState.shouldInjectProfile(localThreadId)
        : true;  // New chat (no Azure thread) → always inject
      const currentProfileHash = computeProfileHash(chatState);
      console.log("[useAgentChat] Profile injection decision:", { shouldInject, freshAzureThreadId, localThreadId, currentProfileHash });
      
      // Both transports share the same signature; AG-UI is opt-in via VITE_USE_AGUI.
      const streamChat = USE_AGUI_TRANSPORT ? streamAgentChatViaAGUI : streamAgentChat;

      await streamChat(
        agentId,
        t,
        freshAzureThreadId,  // Pass existing Azure thread ID (or null for new chat)
        (event: StreamEvent) => {
          console.log("[useAgentChat] >>> onEvent received:", event.type, "generationId:", generationId, "currentRef:", currentGenerationIdRef.current);
          // Check if this generation is still current
          if (generationId !== currentGenerationIdRef.current) {
            console.warn("[useAgentChat] >>> SKIPPING event", event.type, "— stale generation", generationId, "vs", currentGenerationIdRef.current);
            return;
          }
          
          switch (event.type) {
            case "thread_id":
              if (event.thread_id) {
                // Store Azure thread ID for API calls — update ref immediately for sync access
                threadIdRef.current = event.thread_id;
                setThreadId(event.thread_id);
                // Persist to thread context for session continuity
                if (localThreadId) {
                  setThreadSessionUuid(localThreadId, event.thread_id);
                }
              }
              break;
            case "delta":
              if (event.content) {
                // Hide loading indicator on first delta (response has started)
                if (!hasReceivedFirstDelta) {
                  hasReceivedFirstDelta = true;
                  setIsWaitingForResponse(false);
            setActiveToolLabel(null);
                }
                accumulatedContent += event.content;
                
                // If content blocks exist (documents, quizzes, etc.), stream the
                // delta into a trailing text content block so the final summary
                // appears token-by-token alongside the earlier tool outputs.
                if (contentBlocksRef.current.length > 0) {
                  const blocks = contentBlocksRef.current;
                  const lastBlock = blocks[blocks.length - 1];
                  if (lastBlock && lastBlock.type === "text" && lastBlock.isStreaming) {
                    // Append to existing trailing text block
                    lastBlock.content += event.content;
                  } else {
                    // Create a new streaming text block for the final response
                    blocks.push({ type: "text", content: event.content, isStreaming: true });
                    currentBlockIndexRef.current = blocks.length - 1;
                  }
                  updateMessageWithBlocks();
                  break;
                }
                
                // Try to parse JSON response format in real-time
                // This handles the case where agent returns { "title": "...", "response": "..." }
                const parsed = parseChatResponse(accumulatedContent);
                const displayContent = parsed.response;
                
                setMessages((m) => {
                  const updated = [...m];
                  if (updated.length > 0) {
                    const lastMsg = updated[updated.length - 1];
                    updated[updated.length - 1] = {
                      ...lastMsg,  // Preserve createdAt and other properties
                      role: "assistant",
                      content: displayContent,
                    };
                  }
                  return updated;
                });
              }
              break;
            case "citations":
              // Store citation sources on the current assistant message
              if (event.citations && event.citations.length > 0) {
                const newSources = event.citations.map((c: { type?: string; url?: string; title?: string; filename?: string; file_id?: string }) => {
                  if (c.type === "file") {
                    // File citation (from knowledge base / file search) — no URL
                    return {
                      type: "file" as const,
                      title: c.title || c.filename || c.file_id || "Document",
                      filename: c.filename,
                      file_id: c.file_id,
                    };
                  }
                  // URL citation
                  try {
                    const url = new URL(c.url || "");
                    return {
                      type: "url" as const,
                      title: c.title || url.hostname,
                      url: c.url,
                      domain: url.hostname,
                      favicon: `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`,
                    };
                  } catch {
                    return { type: "url" as const, title: c.title || c.url || "Source", url: c.url, domain: c.url };
                  }
                });
                setMessages((m) => {
                  const updated = [...m];
                  if (updated.length > 0) {
                    const lastMsg = updated[updated.length - 1];
                    if (lastMsg.role === "assistant") {
                      const existing = lastMsg.sources || [];
                      const existingKeys = new Set(existing.map(s => s.url || s.file_id || s.title));
                      const unique = newSources.filter((s: { url?: string; file_id?: string; title: string }) => !existingKeys.has(s.url || s.file_id || s.title));
                      updated[updated.length - 1] = {
                        ...lastMsg,
                        sources: [...existing, ...unique],
                      };
                    }
                  }
                  return updated;
                });
              }
              break;
            case "usage":
              // Token usage from agent response — attach to current assistant message
              setMessages((m) => {
                const updated = [...m];
                if (updated.length > 0) {
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...lastMsg,
                      tokenUsage: {
                        input_tokens: event.input_tokens ?? 0,
                        output_tokens: event.output_tokens ?? 0,
                        total_tokens: event.total_tokens ?? 0,
                        rounds: event.rounds ?? 1,
                        per_round: event.per_round ?? [],
                      },
                    };
                  }
                }
                return updated;
              });
              break;
            case "done":
              // document_start draws a card as soon as the model names add_document,
              // before any arguments arrive. If the call never completed (stream cut,
              // server restart), finalising it below would persist a blank openable card.
              if (streamingDocRef.current) {
                const abandonedDoc = streamingDocRef.current;
                const abandonedIndex = contentBlocksRef.current.findIndex(
                  (b) => b.type === "document" && b.docId === abandonedDoc.id
                );
                if (abandonedDoc.content.trim()) {
                  // Partial content still beats losing the document.
                  const patch = (d: GeneratedDoc) =>
                    d.id === abandonedDoc.id
                      ? { ...d, content: abandonedDoc.content, title: abandonedDoc.title || d.title, isStreaming: false }
                      : d;
                  setGeneratedDocs((prev) => prev.map(patch));
                  generatedDocsRef.current = generatedDocsRef.current.map(patch);
                  if (abandonedIndex >= 0 && abandonedDoc.title) {
                    contentBlocksRef.current[abandonedIndex].title = abandonedDoc.title;
                  }
                } else {
                  console.warn("[useAgentChat] Document stream ended with no content — dropping placeholder");
                  if (abandonedIndex >= 0) contentBlocksRef.current.splice(abandonedIndex, 1);
                  setGeneratedDocs((prev) => prev.filter((d) => d.id !== abandonedDoc.id));
                  generatedDocsRef.current = generatedDocsRef.current.filter((d) => d.id !== abandonedDoc.id);
                }
                streamingDocRef.current = null;
                if (streamingDocRafRef.current) {
                  cancelAnimationFrame(streamingDocRafRef.current);
                  streamingDocRafRef.current = null;
                }
                streamingDocDirtyRef.current = false;
                setStreamingDocContent("");
              }
              // Mark any streaming text blocks as complete
              contentBlocksRef.current.forEach(b => {
                b.isStreaming = false;
              });
              // Progress rows are live feedback only, so drop them once the turn ends.
              contentBlocksRef.current = contentBlocksRef.current.filter(
                b => b.type !== "tool_activity",
              );
              if (contentBlocksRef.current.length > 0) {
                updateMessageWithBlocks();
              }
              // Persist final assistant message to store
              // Content may come via delta events (accumulatedContent) OR via message_block events (contentBlocksRef)
              const blockContent = contentBlocksRef.current.filter(b => b.type === "text").map(b => b.content).join("");
              const hasNonTextBlocks = contentBlocksRef.current.some(b => b.type === "quiz" || b.type === "flashcard" || b.type === "challenge" || b.type === "document" || b.type === "tikz_image" || b.type === "generated_image" || b.type === "clarify" || b.type === "suggested_queries");
              const hasAnyContent = accumulatedContent || blockContent || hasNonTextBlocks;
              
              console.log("[useAgentChat] Done event received:", {
                localThreadId,
                accumulatedContentLen: accumulatedContent.length,
                blockContentLen: blockContent.length,
                hasNonTextBlocks,
                hasAnyContent: !!hasAnyContent,
                contentBlocksCount: contentBlocksRef.current.length,
              });
              
              if (localThreadId && hasAnyContent) {
                // The response is now plain markdown (no JSON wrapping)
                // parseChatResponse still handles legacy JSON format gracefully
                // Use accumulatedContent if available, otherwise fall back to content blocks
                const contentForProcessing = accumulatedContent || blockContent;
                const parsedResponse = parseChatResponse(contentForProcessing);
                const textToProcess = parsedResponse.response;
                
                console.log("[useAgentChat] Done event - processing response:", {
                  responseLength: textToProcess.length,
                  rawLength: accumulatedContent.length,
                });
                
                // Check if document was already created via onDocument callback (create_document tool)
                // We need to get the current message state to check for existing generatedDocId
                let existingDocId: string | undefined;
                let existingDocTitle: string | undefined;
                setMessages((m) => {
                  if (m.length > 0) {
                    const lastMsg = m[m.length - 1];
                    existingDocId = lastMsg.generatedDocId;
                    existingDocTitle = lastMsg.generatedDocTitle;
                  }
                  return m; // Don't modify, just read
                });
                
                // Also check contentBlocksRef for document blocks (tool-based document creation
                // sets docId on the content block but NOT on the message's generatedDocId)
                if (!existingDocId && contentBlocksRef.current.length > 0) {
                  const docBlock = contentBlocksRef.current.find(b => b.type === "document" && b.docId);
                  if (docBlock && docBlock.docId) {
                    existingDocId = docBlock.docId;
                    existingDocTitle = docBlock.title;
                  }
                }
                
                // Generate title for first message (when thread has default title)
                // Read thread from store directly (not from stale closure) to get current state
                const freshThreads = useChatStore.getState().threads;
                const thread = freshThreads[localThreadId];
                const currentTitle = thread?.title?.toLowerCase() || '';
                const isDefaultTitle = currentTitle === 'new chat' || 
                                      currentTitle.startsWith('chat ') ||
                                      currentTitle.startsWith('untitled chat') || currentTitle === 'new chat' ||
                                      currentTitle === 'new conversation' ||
                                      currentTitle === '';
                
                console.log("[useAgentChat] Title check:", {
                  hasThread: !!thread,
                  currentTitle,
                  isDefaultTitle,
                  hasOriginalUserMessage: !!originalUserMessage,
                  agentName,
                  localThreadId,
                });

                if (thread && isDefaultTitle && originalUserMessage) {
                  // Call backend to generate title via agent (async, fire-and-forget)
                  console.log("[useAgentChat] ✅ Conditions met — calling /api/chat/generate-title with agent:", agentName);
                  import("@/lib/api").then(({ generateChatTitle }) => {
                    generateChatTitle(originalUserMessage, textToProcess.slice(0, 500), agentName)
                      .then(({ title }) => {
                        console.log("[useAgentChat] ✅ Title generated successfully:", title);
                        renameThread(localThreadId, title);
                      })
                      .catch((err) => {
                        console.error("[useAgentChat] ❌ Title generation FAILED:", err);
                        // Fallback: use first few words of user message
                        const fallbackTitle = originalUserMessage.split(' ').slice(0, 5).join(' ');
                        console.log("[useAgentChat] Using fallback title:", fallbackTitle);
                        renameThread(localThreadId, fallbackTitle);
                      });
                  });
                } else {
                  console.log("[useAgentChat] ⏭️ Skipping title generation — conditions not met");
                }
                
                // If document was already set via onDocument (create_document tool), skip extraction
                let displayText = textToProcess;
                let docBlockText = "";  // Text to show after document block
                let doc: GeneratedDoc | null = null;
                
                if (existingDocId) {
                  // Document was created via tool - just use the text as follow-up message
                  console.log("[useAgentChat] Document already created via tool, docId:", existingDocId);
                  displayText = textToProcess;
                  // Get the doc from generatedDocs for persistence
                  const existingDoc = generatedDocs.find(d => d.id === existingDocId);
                  if (existingDoc) {
                    doc = existingDoc;
                  }
                } else {
                  // Check for JSON document format first: [DOCUMENT]{"title":"...","content":"..."}[/DOCUMENT]
                  const jsonDocs = extractJsonDocuments(textToProcess);
                  
                  if (jsonDocs && jsonDocs.documents.length > 0) {
                    console.log("[useAgentChat] JSON docs found:", jsonDocs.documents.length);
                    console.log("[useAgentChat] Text parts:", jsonDocs.textParts);
                    
                    // Has JSON documents - extract them all
                    const createdDocs: GeneratedDoc[] = jsonDocs.documents.map((d) => ({
                      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      title: d.title,
                      content: d.content,
                      hasExplicitTitle: true,
                      messageGroupId: currentMessageGroupRef.current?.id,
                    }));
                    
                    // Store all docs
                    setGeneratedDocs((prev) => [...prev, ...createdDocs]);
                    
                    // Use the first doc as the pending doc for message attachment
                    doc = createdDocs[0];
                    
                    // For single document: first text part is before, rest is after
                    // For multiple docs: combine all text parts
                    if (jsonDocs.documents.length === 1 && jsonDocs.textParts.length >= 1) {
                      displayText = jsonDocs.textParts[0] || `Generated document: ${doc.title}`;
                      if (jsonDocs.textParts.length > 1) {
                        docBlockText = jsonDocs.textParts.slice(1).join("\n\n").trim();
                      }
                      console.log("[useAgentChat] displayText:", displayText);
                      console.log("[useAgentChat] docBlockText:", docBlockText);
                    } else {
                      displayText = jsonDocs.textParts.join("\n\n").trim() ||
                        `Generated ${createdDocs.length} document${createdDocs.length > 1 ? 's' : ''}: ${createdDocs.map(d => d.title).join(', ')}`;
                    }
                  } else {
                    // No JSON document tags — treat as a regular chat message
                    // Documents are only created via the create_document tool (handled above via existingDocId)
                  }
                }
                
                // Persist to store (include document info if available from tool or extraction)
                const groupInfo = currentMessageGroupRef.current;
                const persistDocId = doc?.id || existingDocId;
                const persistDocTitle = doc?.title || existingDocTitle;
                // Try to get content from doc, or look up from generatedDocsRef if doc is null but we have existingDocId
                let persistDocContent = doc?.content;
                if (!persistDocContent && existingDocId) {
                  const existingDocForContent = generatedDocsRef.current.find(d => d.id === existingDocId);
                  persistDocContent = existingDocForContent?.content;
                }
                
                // Check if we have content blocks (new tool-based approach)
                const hasContentBlocks = contentBlocksRef.current.length > 0;
                
                // Build content blocks for persistence if they exist
                let persistContentBlocks: ChatMsg["contentBlocks"];
                if (hasContentBlocks) {
                  persistContentBlocks = contentBlocksRef.current.map(b => {
                    if (b.type === "text") {
                      return { type: "text" as const, content: b.content };
                    } else if (b.type === "quiz") {
                      return { type: "quiz" as const, quizId: b.quizId!, title: b.title || "Quiz", assessmentType: b.assessmentType, thresholdConcept: b.thresholdConcept, questions: b.questions || [] };
                    } else if (b.type === "flashcard") {
                      return { type: "flashcard" as const, flashcardId: b.flashcardId!, title: b.title || "Flashcards", cards: b.cards || [] };
                    } else if (b.type === "challenge") {
                      return { type: "challenge" as const, challengeId: b.challengeId!, title: b.title || "Challenge", description: b.description || "", difficulty: b.difficulty || "medium", hints: b.hints || [], solution: b.solution || "", challengeType: b.challengeType || "problem" };
                    } else if (b.type === "tikz_image") {
                      return { type: "tikz_image" as const, tikzImageId: b.tikzImageId!, title: b.title || "TikZ Diagram", imageData: b.imageData || "", caption: b.caption || "", visualizationType: b.visualizationType || "" };
                    } else if (b.type === "generated_image") {
                      return { type: "generated_image" as const, generatedImageId: b.generatedImageId!, title: b.title || "Generated image", imageData: "", imageUrl: b.imageUrl || "", caption: b.caption || "", size: b.size || "", quality: b.quality || "" };
                    } else if (b.type === "clarify") {
                      return { type: "clarify" as const, clarifyId: b.clarifyId!, questions: b.clarifyQuestions || [] };
                    } else if (b.type === "suggested_queries") {
                      return { type: "suggested_queries" as const, suggestionsId: b.suggestionsId!, queries: b.queries || [] };
                    } else if (b.type === "tool_activity") {
                      return { type: "tool_activity" as const, activityId: b.activityId!, label: b.label || "Working", done: b.done ?? false };
                    } else {
                      return { type: "document" as const, docId: b.docId!, title: b.title || "Document" };
                    }
                  });
                }
                
                // For content blocks, build text content from text blocks
                const persistContent = hasContentBlocks 
                  ? contentBlocksRef.current.filter(b => b.type === "text").map(b => b.content).join("")
                  : displayText;
                
                appendMessage(localThreadId, {
                  role: "assistant",
                  content: persistContent,
                  ...(persistContentBlocks && { contentBlocks: persistContentBlocks }),
                  ...(persistDocId && {
                    generatedDocId: persistDocId,
                    generatedDocTitle: persistDocTitle,
                  }),
                  ...(persistDocContent && { generatedDocContent: persistDocContent }),
                  ...(docBlockText && { docBlockContent: docBlockText }),
                  createdAt: Date.now(),
                  ...(groupInfo && {
                    messageGroupId: groupInfo.id,
                    retryNumber: groupInfo.retryNumber,
                  }),
                });
                
                // Update UI with final processed content
                // If we have content blocks, preserve them; otherwise use the old logic
                console.log('[useAgentChat] Done handler - hasContentBlocks:', hasContentBlocks, 'blocks count:', contentBlocksRef.current.length);
                if (hasContentBlocks) {
                  // Content blocks were used - just mark all as done streaming
                  contentBlocksRef.current = contentBlocksRef.current.map(block => ({
                    ...block,
                    isStreaming: false,
                  }));
                  console.log('[useAgentChat] Done handler - calling updateMessageWithBlocks with blocks:', contentBlocksRef.current.length);
                  updateMessageWithBlocks();
                  // Update createdAt to actual completion time for accurate response time display
                  setMessages((m) => {
                    if (m.length > 0) {
                      const updated = [...m];
                      updated[updated.length - 1] = { ...updated[updated.length - 1], createdAt: Date.now() };
                      return updated;
                    }
                    return m;
                  });
                  console.log('[useAgentChat] Done handler - updateMessageWithBlocks completed');
                } else {
                  // Legacy path - no content blocks, use displayText
                  setMessages((m) => {
                    const updated = [...m];
                    if (updated.length > 0) {
                      const lastMsg = updated[updated.length - 1];
                      // Preserve existing generatedDocId if set by onDocument callback
                      const finalDocId = doc?.id || lastMsg.generatedDocId;
                      const finalDocTitle = doc?.title || lastMsg.generatedDocTitle;
                      updated[updated.length - 1] = {
                        ...lastMsg,
                        role: "assistant",
                        content: displayText,
                        createdAt: Date.now(),  // Update to actual completion time for response time display
                        ...(finalDocId && {
                          generatedDocId: finalDocId,
                          generatedDocTitle: finalDocTitle,
                        }),
                        ...(docBlockText && { docBlockContent: docBlockText }),
                      };
                    }
                    return updated;
                  });
                }
                
                // Auto-save generated document as an asset in Cosmos DB
                // Get courseName for asset tags (used for navigation from Assets page)
                const threadForAsset = useChatStore.getState().threads[localThreadId];
                const courseSlug = threadForAsset?.context?.courseSlug || (agentName ? getCourseName(agentName) : "");
                
                if (persistDocId && persistDocContent && currentUserId) {
                  const docTitle = persistDocTitle || "Untitled Document";
                  // Determine asset type from doc_type (default to markdown)
                  const docType = (doc as any)?.doc_type || "markdown";
                  const assetType = docType === "html" ? "html" : docType === "code" ? "code" : "markdown";
                  
                  chatApi.createAsset(currentUserId, {
                    title: docTitle,
                    category: "document",
                    type: assetType,
                    content: persistDocContent,
                    agentId: agentId || undefined,
                    threadId: localThreadId,
                    description: `Generated by ${agentName || "Agent"}`,
                    tags: courseSlug ? [`course:${courseSlug}`] : [],
                  }).then((savedAsset) => {
                    console.log("[useAgentChat] Document auto-saved as asset:", savedAsset.id, docTitle);
                  }).catch((err) => {
                    console.error("[useAgentChat] Failed to auto-save document as asset:", err);
                  });
                }
                
                // Auto-save quizzes and flashcards as assets
                if (currentUserId && hasContentBlocks) {
                  for (const block of contentBlocksRef.current) {
                    if (block.type === "quiz" && block.questions && block.questions.length > 0) {
                      chatApi.saveQuizAsset({
                        userId: currentUserId,
                        quizId: block.quizId!,
                        title: block.title || "Quiz",
                        agentId: agentId!,
                        threadId: localThreadId,
                        assessmentType: block.assessmentType,
                        thresholdConcept: block.thresholdConcept,
                        questions: block.questions,
                        tags: courseSlug ? [`course:${courseSlug}`] : [],
                      }).then((savedAsset) => {
                        console.log("[useAgentChat] Quiz saved to unified asset:", savedAsset.assetId, block.title);
                      }).catch((err) => {
                        console.error("[useAgentChat] Failed to auto-save quiz as asset:", err);
                      });
                    } else if (block.type === "flashcard" && block.cards && block.cards.length > 0) {
                      chatApi.createAsset(currentUserId, {
                        title: block.title || "Flashcards",
                        category: "flashcard",
                        type: "json",
                        content: JSON.stringify({ flashcardId: block.flashcardId, title: block.title, cards: block.cards }),
                        agentId: agentId || undefined,
                        threadId: localThreadId,
                        description: `${block.cards.length} flashcard${block.cards.length > 1 ? "s" : ""} — generated by ${agentName || "Agent"}`,
                        tags: courseSlug ? [`course:${courseSlug}`] : [],
                      }).then((savedAsset) => {
                        console.log("[useAgentChat] Flashcard auto-saved as asset:", savedAsset.id, block.title);
                      }).catch((err) => {
                        console.error("[useAgentChat] Failed to auto-save flashcard as asset:", err);
                      });
                    } else if (block.type === "challenge" && block.description) {
                      chatApi.createAsset(currentUserId, {
                        title: block.title || "Challenge",
                        category: "challenge",
                        type: "json",
                        content: JSON.stringify({ challengeId: block.challengeId, title: block.title, description: block.description, difficulty: block.difficulty, hints: block.hints, solution: block.solution, challengeType: block.challengeType }),
                        agentId: agentId || undefined,
                        threadId: localThreadId,
                        description: `${block.difficulty || "medium"} ${block.challengeType || "problem"} challenge — generated by ${agentName || "Agent"}`,
                        tags: courseSlug ? [`course:${courseSlug}`] : [],
                      }).then((savedAsset) => {
                        console.log("[useAgentChat] Challenge auto-saved as asset:", savedAsset.id, block.title);
                      }).catch((err) => {
                        console.error("[useAgentChat] Failed to auto-save challenge as asset:", err);
                      });
                    }
                  }
                }
              }
              
              // Log message received
              logger.logMessageReceived({
                threadId: localThreadId || '',
                agentId,
                agentName: agentName || 'Unknown',
                agentKind: kind,
                content: accumulatedContent,
                messageIndex: -1,
              });
              
              // After successful response, store the profile hash for this thread
              // so we don't re-inject profile on the next message (unless profile changes)
              if (shouldInject && localThreadId) {
                useChatStore.getState().setProfileHashForThread(localThreadId, currentProfileHash);
                console.log("[useAgentChat] Stored profile hash for thread:", localThreadId, currentProfileHash);
              }
              
              isGeneratingRef.current = false;
              console.log('[useAgentChat] Done handler COMPLETE - set isGeneratingRef to false, contentBlocksRef.length:', contentBlocksRef.current.length);
              setIsStreaming(false);
              setIsWaitingForResponse(false);
            setActiveToolLabel(null);
              break;
            case "error":
              console.error("Stream error:", event.error);
              setMessages((m) => {
                const updated = [...m];
                if (updated.length > 0) {
                  const lastMsg = updated[updated.length - 1];
                  // If the assistant already streamed real content, keep it —
                  // only overwrite if the message is still empty / placeholder
                  const hasContent = lastMsg.role === "assistant" && lastMsg.content && lastMsg.content.trim().length > 0;
                  if (!hasContent) {
                    updated[updated.length - 1] = {
                      ...lastMsg,
                      role: "assistant",
                      content: `Error: ${event.error || "Failed to get response"}`,
                    };
                  } else {
                    console.warn("[useAgentChat] Stream error after content was already delivered — keeping existing message");
                  }
                }
                return updated;
              });
              isGeneratingRef.current = false;
              setIsStreaming(false);
              setIsWaitingForResponse(false);
            setActiveToolLabel(null);
              break;
          }
        },
        { 
          web_search_enabled: webSearchEnabled,
          user_id: currentUserId,  // Pass userId for profile-based personalization
          usage_event_id: messageGroupId,
          inject_profile: shouldInject,  // Only inject profile when needed (new chat or profile changed)
          user_profile: shouldInject ? {
            displayName: chatState.userName || "",
            nickname: chatState.userNickname || "",
            fullName: chatState.userFullName || "",
            workFunction: chatState.userWorkFunction || "",
            preferences: chatState.userPreferences || "",
            customInstructions: chatState.userCustomInstructions || "",
            learningProfile: chatState.userLearningProfile || "",
            department: chatState.userDepartment || "",
            college: chatState.userCollege || "",
            language: chatState.userLanguage || "",
            currentLocation: chatState.userCurrentLocation || "",
            interests: chatState.userInterests || "",
            passionateAbout: chatState.userPassionateAbout || "",
          } : undefined,
          signal,
          image_urls: base64Urls.length > 0 ? base64Urls : undefined,
          onDocumentStart: () => {
            // Document streaming is starting - prepare to receive content
            console.log("[useAgentChat] Document streaming started - contentBlocksRef BEFORE:", JSON.stringify(contentBlocksRef.current));
            streamingDocRef.current = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              title: "",
              content: "",
            };
            // Add a document block (title will be updated when received)
            contentBlocksRef.current.push({
              type: "document",
              content: "",
              docId: streamingDocRef.current.id,
              title: "",
              isStreaming: true,
            });
            currentBlockIndexRef.current = contentBlocksRef.current.length - 1;
            console.log("[useAgentChat] Document block added - contentBlocksRef AFTER:", JSON.stringify(contentBlocksRef.current));
            updateMessageWithBlocks();
            
            // Add doc to generatedDocs immediately so the pane opens right away
            // Content will stream in via onDocumentDelta or arrive complete via onDocument
            const doc: GeneratedDoc = {
              id: streamingDocRef.current.id,
              title: "Generating document...",  // Placeholder title until we get the real one
              content: "",
              hasExplicitTitle: false,
              messageGroupId: currentMessageGroupRef.current?.id,
              isStreaming: true,
            };
            setGeneratedDocs((prev) => [...prev, doc]);
            console.log("[useAgentChat] Added streaming doc to generatedDocs for immediate panel open");
            
            // Reset streaming content for the new document
            setStreamingDocContent("");
          },
          onDocumentTitle: (title) => {
            // Document title received - update existing doc (already added by onDocumentStart)
            console.log("[useAgentChat] Document title received:", title);
            if (streamingDocRef.current) {
              streamingDocRef.current.title = title;
              
              // Update the existing doc in generatedDocs (don't add a duplicate!)
              const docId = streamingDocRef.current.id;
              setGeneratedDocs((prev) => 
                prev.map(d => 
                  d.id === docId 
                    ? { ...d, title, hasExplicitTitle: true }
                    : d
                )
              );
              
              // Update the document block with title
              if (currentBlockIndexRef.current >= 0) {
                contentBlocksRef.current[currentBlockIndexRef.current].title = title;
                updateMessageWithBlocks();
              }
            }
          },
          onDocumentDelta: (delta) => {
            // Document content chunk received - accumulate in ref
            if (streamingDocRef.current) {
              streamingDocRef.current.content += delta;
              
              // Schedule a RAF-throttled update for the panel (max once per frame ~60fps)
              // This avoids calling setState on every delta (~1000 times) while still
              // providing smooth live streaming in the document panel.
              streamingDocDirtyRef.current = true;
              if (!streamingDocRafRef.current) {
                streamingDocRafRef.current = requestAnimationFrame(() => {
                  streamingDocRafRef.current = null;
                  if (streamingDocDirtyRef.current && streamingDocRef.current) {
                    streamingDocDirtyRef.current = false;
                    setStreamingDocContent(streamingDocRef.current.content);
                  }
                });
              }
            }
          },
          onDocument: (event) => {
            // Handle complete document (final event) - this replaces any streaming doc
            console.log("[useAgentChat] Complete document received:", event.title);
            
            // If we were streaming this doc, update it with final content
            if (streamingDocRef.current) {
              const docId = streamingDocRef.current.id;
              
              // Check if doc already exists in generatedDocs (from onDocumentTitle)
              // If not, add it now (happens when backend sends complete doc without streaming)
              setGeneratedDocs((prev) => {
                const existingDoc = prev.find(d => d.id === docId);
                if (existingDoc) {
                  // Update existing doc
                  return prev.map(d => 
                    d.id === docId 
                      ? { ...d, content: event.content, title: event.title, isStreaming: false }
                      : d
                  );
                } else {
                  // Doc doesn't exist - add it now
                  console.log("[useAgentChat] Adding doc to generatedDocs in onDocument (was not added via onDocumentTitle)");
                  return [...prev, {
                    id: docId,
                    title: event.title,
                    content: event.content,
                    hasExplicitTitle: true,
                    messageGroupId: currentMessageGroupRef.current?.id,
                    isStreaming: false,
                  }];
                }
              });
              // Sync ref immediately so done handler can read it (useEffect may lag)
              const updatedDoc = { id: docId, title: event.title, content: event.content, hasExplicitTitle: true, messageGroupId: currentMessageGroupRef.current?.id, isStreaming: false };
              generatedDocsRef.current = [...generatedDocsRef.current.filter(d => d.id !== docId), updatedDoc];
              
              // Find the document block by its docId (not currentBlockIndexRef which may have changed)
              const docBlockIndex = contentBlocksRef.current.findIndex(
                block => block.type === "document" && block.docId === docId
              );
              if (docBlockIndex >= 0) {
                contentBlocksRef.current[docBlockIndex].title = event.title;
                contentBlocksRef.current[docBlockIndex].isStreaming = false;
                console.log("[useAgentChat] Updated document block title to:", event.title, "at index:", docBlockIndex);
                updateMessageWithBlocks();
              } else {
                console.warn("[useAgentChat] Could not find document block with docId:", docId);
              }
              
              streamingDocRef.current = null;
              // Cancel any pending RAF and clear streaming content
              if (streamingDocRafRef.current) {
                cancelAnimationFrame(streamingDocRafRef.current);
                streamingDocRafRef.current = null;
              }
              streamingDocDirtyRef.current = false;
              setStreamingDocContent("");
            } else {
              // No streaming doc - create new one (fallback for non-streaming)
              const doc: GeneratedDoc = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: event.title,
                content: event.content,
                hasExplicitTitle: true,
                messageGroupId: currentMessageGroupRef.current?.id,
              };
              setGeneratedDocs((prev) => [...prev, doc]);
              // Sync ref immediately so done handler can read it (useEffect may lag)
              generatedDocsRef.current = [...generatedDocsRef.current, doc];
              
              // Add document block
              contentBlocksRef.current.push({
                type: "document",
                content: "",
                docId: doc.id,
                title: event.title,
                isStreaming: false,
              });
              updateMessageWithBlocks();
            }
          },
          onMessageBlockStart: () => {
            // Message block streaming is starting
            console.log("[useAgentChat] onMessageBlockStart - BEFORE: totalBlocks:", contentBlocksRef.current.length, "currentBlockIndex:", currentBlockIndexRef.current, "blocks:", JSON.stringify(contentBlocksRef.current.map((b,i) => ({i, type: b.type, len: b.content?.length || 0}))));
            contentBlocksRef.current.push({
              type: "text",
              content: "",
              isStreaming: true,
            });
            currentBlockIndexRef.current = contentBlocksRef.current.length - 1;
            console.log("[useAgentChat] onMessageBlockStart - AFTER: totalBlocks:", contentBlocksRef.current.length, "currentBlockIndex:", currentBlockIndexRef.current);
            updateMessageWithBlocks();
          },
          onMessageBlockDelta: (delta) => {
            // Message block content chunk received
            const blockType = contentBlocksRef.current[currentBlockIndexRef.current]?.type;
            if (currentBlockIndexRef.current >= 0 && contentBlocksRef.current[currentBlockIndexRef.current]) {
              contentBlocksRef.current[currentBlockIndexRef.current].content += delta;
              updateMessageWithBlocks();
            } else {
              console.warn("[useAgentChat] onMessageBlockDelta - NO VALID BLOCK! index:", currentBlockIndexRef.current, "totalBlocks:", contentBlocksRef.current.length);
            }
          },
          onMessageBlock: (content) => {
            // Complete message block received
            console.log("[useAgentChat] onMessageBlock - currentBlockIndex:", currentBlockIndexRef.current, "totalBlocks:", contentBlocksRef.current.length, "contentLen:", content.length, "blockType:", contentBlocksRef.current[currentBlockIndexRef.current]?.type);
            if (currentBlockIndexRef.current >= 0 && contentBlocksRef.current[currentBlockIndexRef.current]) {
              contentBlocksRef.current[currentBlockIndexRef.current].content = content;
              contentBlocksRef.current[currentBlockIndexRef.current].isStreaming = false;
              updateMessageWithBlocks();
            } else {
              // Fallback: create new block
              contentBlocksRef.current.push({
                type: "text",
                content: content,
                isStreaming: false,
              });
              updateMessageWithBlocks();
            }
          },
          onToolStart: (tool) => {
            const label = TOOL_STATUS_LABELS[tool] ?? "Working";
            // The model may call the same tool over several rounds; collapse the
            // repeats so the transcript shows one row per distinct step.
            const lastActivity = [...contentBlocksRef.current]
              .reverse()
              .find((block) => block.type === "tool_activity");
            if (lastActivity?.label === label) {
              setActiveToolLabel(null);
              return;
            }
            // Mark any earlier activity finished, then log this one inline so the
            // transcript keeps a record of what the agent did.
            for (const block of contentBlocksRef.current) {
              if (block.type === "tool_activity") block.done = true;
            }
            contentBlocksRef.current.push({
              type: "tool_activity",
              content: "",
              isStreaming: false,
              activityId: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              label,
            });
            // Deliberately leave currentBlockIndexRef alone: this block is an
            // annotation, and text deltas must keep targeting the real block.
            setActiveToolLabel(null);
            updateMessageWithBlocks();
          },
          onBlockCancel: (tool) => {
            // The tool failed, so drop the placeholder card it triggered.
            console.warn("[useAgentChat] Block tool failed, removing placeholder:", tool);

            // Its activity row would otherwise sit there pulsing forever, and
            // freeze into a claim that something was generated when nothing was.
            const failedLabel = tool ? TOOL_STATUS_LABELS[tool] : undefined;
            const reverseIndex = [...contentBlocksRef.current]
              .reverse()
              .findIndex(
                (b) =>
                  b.type === "tool_activity" &&
                  !b.done &&
                  (!failedLabel || b.label === failedLabel)
              );
            if (reverseIndex >= 0) {
              const activityIndex = contentBlocksRef.current.length - 1 - reverseIndex;
              contentBlocksRef.current.splice(activityIndex, 1);
              if (currentBlockIndexRef.current > activityIndex) {
                currentBlockIndexRef.current -= 1;
              }
            }
            setActiveToolLabel(null);

            // A document also registered a side-panel entry in onDocumentStart,
            // so removing only the chat block would strand an empty doc there.
            if (tool === "add_document" && streamingDocRef.current) {
              const docId = streamingDocRef.current.id;
              const docIndex = contentBlocksRef.current.findIndex(
                (b) => b.type === "document" && b.docId === docId
              );
              if (docIndex >= 0) {
                contentBlocksRef.current.splice(docIndex, 1);
                if (currentBlockIndexRef.current >= docIndex) {
                  currentBlockIndexRef.current = -1;
                }
                updateMessageWithBlocks();
              }
              setGeneratedDocs((prev) => prev.filter((d) => d.id !== docId));
              generatedDocsRef.current = generatedDocsRef.current.filter((d) => d.id !== docId);
              streamingDocRef.current = null;
              if (streamingDocRafRef.current) {
                cancelAnimationFrame(streamingDocRafRef.current);
                streamingDocRafRef.current = null;
              }
              streamingDocDirtyRef.current = false;
              setStreamingDocContent("");
              return;
            }

            const index = currentBlockIndexRef.current;
            const block = index >= 0 ? contentBlocksRef.current[index] : undefined;
            if (block?.isStreaming && block.type !== "text") {
              contentBlocksRef.current.splice(index, 1);
              currentBlockIndexRef.current = -1;
              updateMessageWithBlocks();
            }
          },
          onQuizStart: () => {
            // Quiz streaming is starting - add a placeholder quiz block
            console.log("[useAgentChat] Quiz streaming started");
            const quizId = `quiz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            contentBlocksRef.current.push({
              type: "quiz",
              content: "",
              quizId,
              title: "Generating quiz...",
              isStreaming: true,
              questions: [],
            });
            currentBlockIndexRef.current = contentBlocksRef.current.length - 1;
            updateMessageWithBlocks();
          },
          onQuiz: (event) => {
            // Complete quiz received from add_quiz tool
            console.log("[useAgentChat] Quiz received:", event.title, "questions:", event.questions.length);
            if (currentBlockIndexRef.current >= 0 && contentBlocksRef.current[currentBlockIndexRef.current]?.type === "quiz") {
              contentBlocksRef.current[currentBlockIndexRef.current].title = event.title;
              contentBlocksRef.current[currentBlockIndexRef.current].assessmentType = event.assessmentType;
              contentBlocksRef.current[currentBlockIndexRef.current].thresholdConcept = event.thresholdConcept;
              contentBlocksRef.current[currentBlockIndexRef.current].questions = event.questions;
              contentBlocksRef.current[currentBlockIndexRef.current].isStreaming = false;
            } else {
              // Fallback: create new quiz block
              const quizId = `quiz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              contentBlocksRef.current.push({
                type: "quiz",
                content: "",
                quizId,
                title: event.title,
                assessmentType: event.assessmentType,
                thresholdConcept: event.thresholdConcept,
                isStreaming: false,
                questions: event.questions,
              });
            }
            updateMessageWithBlocks();
          },
          onFlashcardStart: () => {
            // Flashcard streaming is starting - add a placeholder flashcard block
            console.log("[useAgentChat] Flashcard streaming started");
            const flashcardId = `fc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            contentBlocksRef.current.push({
              type: "flashcard",
              content: "",
              flashcardId,
              title: "Loading flashcards...",
              isStreaming: true,
              cards: [],
            });
            currentBlockIndexRef.current = contentBlocksRef.current.length - 1;
            updateMessageWithBlocks();
          },
          onFlashcard: (event) => {
            // Complete flashcard set received from add_flashcard tool
            console.log("[useAgentChat] Flashcards received:", event.title, "cards:", event.cards.length);
            if (currentBlockIndexRef.current >= 0 && contentBlocksRef.current[currentBlockIndexRef.current]?.type === "flashcard") {
              contentBlocksRef.current[currentBlockIndexRef.current].title = event.title;
              contentBlocksRef.current[currentBlockIndexRef.current].cards = event.cards;
              contentBlocksRef.current[currentBlockIndexRef.current].isStreaming = false;
            } else {
              // Fallback: create new flashcard block
              const flashcardId = `fc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              contentBlocksRef.current.push({
                type: "flashcard",
                content: "",
                flashcardId,
                title: event.title,
                isStreaming: false,
                cards: event.cards,
              });
            }
            updateMessageWithBlocks();
          },
          onChallengeStart: () => {
            // Challenge streaming is starting - add a placeholder challenge block
            console.log("[useAgentChat] Challenge streaming started");
            const challengeId = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            contentBlocksRef.current.push({
              type: "challenge",
              content: "",
              challengeId,
              title: "Loading challenge...",
              isStreaming: true,
              description: "",
              difficulty: "medium",
              hints: [],
              solution: "",
              challengeType: "problem",
            });
            currentBlockIndexRef.current = contentBlocksRef.current.length - 1;
            updateMessageWithBlocks();
          },
          onChallenge: (event) => {
            // Complete challenge received from add_challenge tool
            console.log("[useAgentChat] Challenge received:", event.title, "difficulty:", event.difficulty);
            if (currentBlockIndexRef.current >= 0 && contentBlocksRef.current[currentBlockIndexRef.current]?.type === "challenge") {
              contentBlocksRef.current[currentBlockIndexRef.current].title = event.title;
              contentBlocksRef.current[currentBlockIndexRef.current].description = event.description;
              contentBlocksRef.current[currentBlockIndexRef.current].difficulty = event.difficulty;
              contentBlocksRef.current[currentBlockIndexRef.current].hints = event.hints;
              contentBlocksRef.current[currentBlockIndexRef.current].solution = event.solution;
              contentBlocksRef.current[currentBlockIndexRef.current].challengeType = event.challengeType;
              contentBlocksRef.current[currentBlockIndexRef.current].isStreaming = false;
            } else {
              // Fallback: create new challenge block
              const challengeId = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              contentBlocksRef.current.push({
                type: "challenge",
                content: "",
                challengeId,
                title: event.title,
                isStreaming: false,
                description: event.description,
                difficulty: event.difficulty,
                hints: event.hints,
                solution: event.solution,
                challengeType: event.challengeType,
              });
            }
            updateMessageWithBlocks();
          },
          onTikzImageStart: () => {
            console.log("[useAgentChat] TikZ image generation started");
            const tikzImageId = `tikz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            contentBlocksRef.current.push({
              type: "tikz_image",
              content: "",
              tikzImageId,
              title: "Generating diagram...",
              isStreaming: true,
              imageData: "",
              caption: "",
            });
            currentBlockIndexRef.current = contentBlocksRef.current.length - 1;
            updateMessageWithBlocks();
          },
          onTikzImage: (event) => {
            // Complete server-rendered diagram received (add_tikz_diagram)
            console.log("[useAgentChat] TikZ image received:", event.title);
            if (currentBlockIndexRef.current >= 0 && contentBlocksRef.current[currentBlockIndexRef.current]?.type === "tikz_image") {
              contentBlocksRef.current[currentBlockIndexRef.current].title = event.title;
              contentBlocksRef.current[currentBlockIndexRef.current].imageData = event.imageData;
              contentBlocksRef.current[currentBlockIndexRef.current].caption = event.caption;
              contentBlocksRef.current[currentBlockIndexRef.current].visualizationType = event.visualizationType;
              contentBlocksRef.current[currentBlockIndexRef.current].isStreaming = false;
            } else {
              // Fallback: create a new TikZ image block.
              const tikzImageId = `tikz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              contentBlocksRef.current.push({
                type: "tikz_image",
                content: "",
                tikzImageId,
                title: event.title,
                isStreaming: false,
                imageData: event.imageData,
                caption: event.caption,
                visualizationType: event.visualizationType,
              });
            }
            updateMessageWithBlocks();
          },
          onGeneratedImageStart: () => {
            console.log("[useAgentChat] Image generation started");
            const generatedImageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            contentBlocksRef.current.push({
              type: "generated_image",
              content: "",
              generatedImageId,
              title: "Generating image...",
              isStreaming: true,
              imageData: "",
              caption: "",
            });
            currentBlockIndexRef.current = contentBlocksRef.current.length - 1;
            updateMessageWithBlocks();
          },
          onGeneratedImage: (event) => {
            console.log("[useAgentChat] Generated image received:", event.title);
            if (currentBlockIndexRef.current >= 0 && contentBlocksRef.current[currentBlockIndexRef.current]?.type === "generated_image") {
              contentBlocksRef.current[currentBlockIndexRef.current].title = event.title;
              contentBlocksRef.current[currentBlockIndexRef.current].imageData = event.imageData;
              contentBlocksRef.current[currentBlockIndexRef.current].imageUrl = event.imageUrl;
              contentBlocksRef.current[currentBlockIndexRef.current].caption = event.caption;
              contentBlocksRef.current[currentBlockIndexRef.current].size = event.size;
              contentBlocksRef.current[currentBlockIndexRef.current].quality = event.quality;
              contentBlocksRef.current[currentBlockIndexRef.current].isStreaming = false;
            } else {
              const generatedImageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              contentBlocksRef.current.push({
                type: "generated_image",
                content: "",
                generatedImageId,
                title: event.title,
                isStreaming: false,
                imageData: event.imageData,
                imageUrl: event.imageUrl,
                caption: event.caption,
                size: event.size,
                quality: event.quality,
              });
            }
            updateMessageWithBlocks();
          },
          onClarify: (event) => {
            console.log("[useAgentChat] Clarify received:", event.questions.length, "question(s)");
            contentBlocksRef.current.push({
              type: "clarify",
              content: "",
              clarifyId: event.clarifyId || `clarify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              clarifyQuestions: event.questions,
              isStreaming: false,
            });
            currentBlockIndexRef.current = contentBlocksRef.current.length - 1;
            // The questions are on screen now; the agent is blocked on the learner.
            setActiveToolLabel("Waiting for your response");
            updateMessageWithBlocks();
          },
          onSuggestedQueries: (event) => {
            console.log("[useAgentChat] Suggested queries received:", event.queries.length);
            contentBlocksRef.current.push({
              type: "suggested_queries",
              content: "",
              suggestionsId: `sq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              queries: event.queries,
              isStreaming: false,
            });
            currentBlockIndexRef.current = contentBlocksRef.current.length - 1;
            updateMessageWithBlocks();
          },
        }
      );
      
      // Fallback: ensure streaming state is reset after stream ends
      // This handles cases where "done" event wasn't received
      if (isGeneratingRef.current) {
        console.log("[useAgentChat] Stream ended without done event, cleaning up. contentBlocks:", contentBlocksRef.current.length);
        
        // If we have content blocks, preserve them in the fallback path too
        if (contentBlocksRef.current.length > 0) {
          console.log("[useAgentChat] Fallback: Preserving content blocks");
          contentBlocksRef.current = contentBlocksRef.current
            .filter(block => block.type !== "tool_activity")
            .map(block => ({
              ...block,
              isStreaming: false,
            }));
          updateMessageWithBlocks();
          
          // Also persist with content blocks
          if (localThreadId) {
            const blocks = contentBlocksRef.current;
            const persistContentBlocks = blocks.map(b => {
              if (b.type === "text") {
                return { type: "text" as const, content: b.content };
              } else if (b.type === "quiz") {
                return { type: "quiz" as const, quizId: b.quizId!, title: b.title || "Quiz", assessmentType: b.assessmentType, thresholdConcept: b.thresholdConcept, questions: b.questions || [] };
              } else if (b.type === "flashcard") {
                return { type: "flashcard" as const, flashcardId: b.flashcardId!, title: b.title || "Flashcards", cards: b.cards || [] };
              } else if (b.type === "challenge") {
                return { type: "challenge" as const, challengeId: b.challengeId!, title: b.title || "Challenge", description: b.description || "", difficulty: b.difficulty || "medium", hints: b.hints || [], solution: b.solution || "", challengeType: b.challengeType || "problem" };
              } else if (b.type === "tikz_image") {
                return { type: "tikz_image" as const, tikzImageId: b.tikzImageId!, title: b.title || "TikZ Diagram", imageData: b.imageData || "", caption: b.caption || "", visualizationType: b.visualizationType || "" };
              } else if (b.type === "generated_image") {
                return { type: "generated_image" as const, generatedImageId: b.generatedImageId!, title: b.title || "Generated image", imageData: "", imageUrl: b.imageUrl || "", caption: b.caption || "", size: b.size || "", quality: b.quality || "" };
              } else if (b.type === "clarify") {
                return { type: "clarify" as const, clarifyId: b.clarifyId!, questions: b.clarifyQuestions || [] };
              } else if (b.type === "suggested_queries") {
                return { type: "suggested_queries" as const, suggestionsId: b.suggestionsId!, queries: b.queries || [] };
              } else if (b.type === "tool_activity") {
                return { type: "tool_activity" as const, activityId: b.activityId!, label: b.label || "Working", done: b.done ?? false };
              } else {
                return { type: "document" as const, docId: b.docId!, title: b.title || "Document" };
              }
            });
            const textContent = blocks.filter(b => b.type === "text").map(b => b.content).join("");
            const groupInfo = currentMessageGroupRef.current;
            appendMessage(localThreadId, {
              role: "assistant",
              content: textContent,
              contentBlocks: persistContentBlocks,
              createdAt: Date.now(),
              ...(groupInfo && {
                messageGroupId: groupInfo.id,
                retryNumber: groupInfo.retryNumber,
              }),
            });
            
            // Auto-save quizzes and flashcards as assets (fallback path)
            if (currentUserId) {
              const threadForAsset = useChatStore.getState().threads[localThreadId];
              const courseSlug = threadForAsset?.context?.courseSlug || (agentName ? getCourseName(agentName) : "");
              for (const block of blocks) {
                if (block.type === "quiz" && block.questions && block.questions.length > 0) {
                  chatApi.saveQuizAsset({
                    userId: currentUserId,
                    quizId: block.quizId!,
                    title: block.title || "Quiz",
                    agentId: agentId!,
                    threadId: localThreadId,
                    assessmentType: block.assessmentType,
                    thresholdConcept: block.thresholdConcept,
                    questions: block.questions,
                    tags: courseSlug ? [`course:${courseSlug}`] : [],
                  }).catch((err) => console.error("[useAgentChat] Fallback: Failed to auto-save quiz:", err));
                } else if (block.type === "flashcard" && block.cards && block.cards.length > 0) {
                  chatApi.createAsset(currentUserId, {
                    title: block.title || "Flashcards",
                    category: "flashcard",
                    type: "json",
                    content: JSON.stringify({ flashcardId: block.flashcardId, title: block.title, cards: block.cards }),
                    agentId: agentId || undefined,
                    threadId: localThreadId,
                    description: `${block.cards.length} flashcard${block.cards.length > 1 ? "s" : ""} — generated by ${agentName || "Agent"}`,
                    tags: courseSlug ? [`course:${courseSlug}`] : [],
                  }).catch((err) => console.error("[useAgentChat] Fallback: Failed to auto-save flashcard:", err));
                } else if (block.type === "document" && block.docId) {
                  const docForAsset = generatedDocsRef.current.find(d => d.id === block.docId);
                  if (docForAsset?.content) {
                    chatApi.createAsset(currentUserId, {
                      title: docForAsset.title || "Document",
                      category: "document",
                      type: "markdown",
                      content: docForAsset.content,
                      agentId: agentId || undefined,
                      threadId: localThreadId,
                      description: `Generated by ${agentName || "Agent"}`,
                      tags: courseSlug ? [`course:${courseSlug}`] : [],
                    }).catch((err) => console.error("[useAgentChat] Fallback: Failed to auto-save document:", err));
                  }
                }
              }
            }
          }
        } else if (localThreadId && accumulatedContent) {
          // Legacy path: Persist the message if we have content
          const parsed = parseChatResponse(accumulatedContent);
          const displayContent = parsed.response;
          
          const groupInfo = currentMessageGroupRef.current;
          appendMessage(localThreadId, {
            role: "assistant",
            content: displayContent,
            createdAt: Date.now(),
            ...(groupInfo && {
              messageGroupId: groupInfo.id,
              retryNumber: groupInfo.retryNumber,
            }),
          });
          
          // Auto-rename thread
          if (parsed.title) {
            const freshThreads2 = useChatStore.getState().threads;
            const thread = freshThreads2[localThreadId];
            const currentTitle = thread?.title?.toLowerCase() || '';
            const isDefaultTitle = currentTitle === 'new chat' || 
                                  currentTitle.startsWith('chat ') ||
                                  currentTitle === 'new conversation';
            if (thread && isDefaultTitle) {
              renameThread(localThreadId, parsed.title);
            }
          }
        }
        
        isGeneratingRef.current = false;
        setIsStreaming(false);
        setIsWaitingForResponse(false);
            setActiveToolLabel(null);
      }
    } catch (error) {
      // Ignore abort errors - these are intentional cancellations
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      
      // Only update UI if this is still the current generation
      if (generationId !== currentGenerationIdRef.current) return;
      
      console.error("Error sending message:", error);
      
      // Log chat failure
      logger.logChatFailed({
        threadId: currentThreadId || '',
        agentId,
        userMessage: t,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      
      isGeneratingRef.current = false;
      
      // Check for agent-not-found errors (stale agent ID)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isAgentNotFound = errorMessage.toLowerCase().includes('no assistant found') || 
                              errorMessage.toLowerCase().includes('resource not found') ||
                              errorMessage.toLowerCase().includes('404');
      
      const userFriendlyError = isAgentNotFound 
        ? "This agent no longer exists. Please refresh the page or switch modes to update."
        : `Error: ${errorMessage}`;
      
      setMessages((m) => {
        const updated = [...m];
        if (updated.length > 0) {
          const lastMsg = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...lastMsg,  // Preserve createdAt
            role: "assistant",
            content: userFriendlyError,
          };
        }
        return updated;
      });
      setIsStreaming(false);
      setIsWaitingForResponse(false);
            setActiveToolLabel(null);
    }
  }

  function reset() {
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // Clear typing interval
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    
    // Invalidate current generation
    nextGenerationId();
    
    // Reset all refs
    fullResponseRef.current = "";
    displayedLengthRef.current = 0;
    isGeneratingRef.current = false;
    pendingDocRef.current = null;
    
    setThreadId(null);
    setMessages([]);
    setGeneratedDocs([]);
    setIsStreaming(false);
    setIsWaitingForResponse(false);
            setActiveToolLabel(null);
  }

  // Stop the current generation - keeps partial message, aborts in-flight requests
  function stop() {
    console.log("[useAgentChat] stop() called");
    
    // Abort any in-flight HTTP request
    if (abortControllerRef.current) {
      console.log("[useAgentChat] Aborting in-flight request");
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    } else {
      console.log("[useAgentChat] No abortController to abort");
    }
    
    // Invalidate the current generation so any pending callbacks are ignored
    nextGenerationId();
    
    // Clear the typing interval
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    
    // Update last message - handle both regular and research messages
    // Capture stopped research data outside setState callback for persistence
    let stoppedResearchData: ResearchData | null = null;
    
    setMessages((m) => {
      if (m.length === 0) return m;
      const updated = [...m];
      
      // Find the research message (might not be the last one if there was an error)
      const researchIndex = updated.findIndex(msg => msg.isResearch && msg.research && msg.research.status === "running");
      
      if (researchIndex !== -1) {
        const researchMsg = updated[researchIndex];
        console.log("[useAgentChat] Stopping research message at index", researchIndex, "setting status to stopped");
        const stoppedResearch = {
          ...researchMsg.research!,
          status: "stopped" as const,
          endTime: Date.now(),
        };
        stoppedResearchData = stoppedResearch;
        updated[researchIndex] = {
          ...researchMsg,
          research: stoppedResearch,
        };
        return updated;
      }
      
      // Fallback: check if last message is a research message (legacy behavior)
      const lastMsg = updated[updated.length - 1];
      if (lastMsg.isResearch && lastMsg.research) {
        console.log("[useAgentChat] Stopping last research message, setting status to stopped");
        const stoppedResearch = {
          ...lastMsg.research,
          status: "stopped" as const,
          endTime: Date.now(),
        };
        stoppedResearchData = stoppedResearch;
        updated[updated.length - 1] = {
          ...lastMsg,
          research: stoppedResearch,
        };
        return updated;
      }
      
      // Handle regular typing effect message
      if (displayedLengthRef.current > 0 && fullResponseRef.current) {
        const partialContent = fullResponseRef.current.substring(0, displayedLengthRef.current);
        const stoppedContent = partialContent + "\n\n*[Generation stopped]*";
        updated[updated.length - 1] = {
          ...lastMsg,  // Preserve createdAt
          role: "assistant",
          content: stoppedContent,
        };
        
        // Persist the stopped message to the store (with retry tracking)
        if (activeThreadId) {
          const groupInfo = currentMessageGroupRef.current;
          appendMessage(activeThreadId, { 
            role: "assistant", 
            content: stoppedContent, 
            createdAt: Date.now(),
            ...(groupInfo && {
              messageGroupId: groupInfo.id,
              retryNumber: groupInfo.retryNumber,
            }),
          });
        }
      }
      
      return updated;
    });
    
    // Persist stopped research message to store (outside setState callback)
    if (stoppedResearchData !== null && activeThreadId) {
      const stoppedData: ResearchData = stoppedResearchData; // Local copy with explicit type
      const groupInfo = currentMessageGroupRef.current;
      const msgToStore = {
        role: "assistant" as const,
        content: stoppedData.result || "",
        isResearch: true,
        research: stoppedData,
        researchStartTime: stoppedData.startTime,
        researchEndTime: stoppedData.endTime,
        createdAt: Date.now(),
        ...(groupInfo && {
          messageGroupId: groupInfo.id,
          retryNumber: groupInfo.retryNumber,
        }),
      };
      console.log("[useAgentChat] Persisting stopped research:", { 
        threadId: activeThreadId,
        hasResearch: !!msgToStore.research,
        researchStatus: msgToStore.research?.status,
        researchId: msgToStore.research?.id,
      });
      appendMessage(activeThreadId, msgToStore);
      console.log("[useAgentChat] Stopped research message persisted to store", { 
        threadId: activeThreadId,
        status: "stopped",
      });
      
      // Clear the active research since it's stopped
      clearActiveResearch(activeThreadId);
    }
    
    // Reset refs
    fullResponseRef.current = "";
    displayedLengthRef.current = 0;
    isGeneratingRef.current = false;
    
    setIsStreaming(false);
    setIsWaitingForResponse(false);
            setActiveToolLabel(null);
    console.log("[useAgentChat] stop() complete");
  }

  async function editMessage(index: number, newContent: string) {
    if (!agentId || !newContent.trim() || isStreaming) return;
    
    const t = newContent.trim();
    const kind = agentKind ?? (agentName?.toLowerCase().startsWith("exam") ? "exam" : "learning");
    
    // Cancel any existing request and set up new generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const generationId = nextGenerationId();
    currentGenerationIdRef.current = generationId;
    isGeneratingRef.current = true;
    
    // Create the edited message with isLatest: true
    const editedUserMessage = { 
      role: "user" as const, 
      content: t,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
      isLatest: true,
    };
    
    // Append as a new message at the end (keep all old messages intact)
    setMessages((prev) => [...prev, editedUserMessage]);
    
    // Persist the new user message to the store
    if (activeThreadId) {
      appendMessage(activeThreadId, editedUserMessage);
    }

    // Show loading indicator while waiting for API
    setIsStreaming(true);
    setIsWaitingForResponse(true);

    try {
      const signal = abortControllerRef.current.signal;
      
      // Read the Azure thread ID strictly from the per-thread store.
      const freshEditThreadId = activeThreadId
        ? (useChatStore.getState().threads[activeThreadId]?.context?.sessionUuid ?? null)
        : null;
      console.log("[useAgentChat] editMessage - resolved threadId:", freshEditThreadId);
      
      const { reply, thread_id: newThreadId } = await simpleStreamChat(agentId, t, currentUserId, freshEditThreadId, signal);
        
      // Check if this generation is still current
      if (generationId !== currentGenerationIdRef.current) return;
        
      if (!freshEditThreadId && newThreadId) {
        setThreadId(newThreadId);
        if (activeThreadId) {
          setThreadSessionUuid(activeThreadId, newThreadId);
        }
      }
      setIsWaitingForResponse(false);
            setActiveToolLabel(null);
      setMessages((m) => [...m, { role: "assistant", content: "", createdAt: Date.now(), isLatest: true }]);
      startTypingEffect(reply, activeThreadId, generationId, agentId, agentName || 'Unknown', kind);
    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      
      if (generationId !== currentGenerationIdRef.current) return;
      
      console.error("Error getting response for edited message:", error);
      
      // Log chat failure
      logger.logChatFailed({
        threadId: activeThreadId || '',
        agentId,
        userMessage: t,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      
      setIsWaitingForResponse(false);
            setActiveToolLabel(null);
      isGeneratingRef.current = false;
      setIsStreaming(false);
    }
  }

  // Retry: remove the last assistant message and resend the last user message
  async function retry() {
    // Use ref for immediate check (state might be stale due to React batching)
    if (!agentId || isStreaming || isGeneratingRef.current) return;
    
    // Find the last user message
    const lastUserMsgIndex = messages.map(m => m.role).lastIndexOf("user");
    if (lastUserMsgIndex === -1) {
      return;
    }
    
    const lastUserMsg = messages[lastUserMsgIndex].content;
    if (!lastUserMsg) {
      return;
    }
    
    // Log retry event
    logger.logRetry({
      threadId: activeThreadId || '',
      agentId,
      messageIndex: lastUserMsgIndex,
      originalContent: lastUserMsg,
    });
    
    // Capture fresh timestamp for response time calculation
    const retryTimestamp = Date.now();
    
    // Increment retry number for this message group
    // If currentMessageGroupRef is null (e.g., after page reload), try to restore from stored messages
    if (!currentMessageGroupRef.current) {
      // Try to get messageGroupId from the last user message in the store
      const storedMessages = activeThreadId ? messagesByThreadId[activeThreadId] || [] : [];
      const lastStoredUser = [...storedMessages].reverse().find(m => m.role === 'user');
      
      if (lastStoredUser?.messageGroupId) {
        // Restore the message group from stored data
        // Find the highest retryNumber for this group
        const groupMessages = storedMessages.filter(m => m.messageGroupId === lastStoredUser.messageGroupId);
        const maxRetry = Math.max(...groupMessages.map(m => m.retryNumber ?? 0), 0);
        currentMessageGroupRef.current = { 
          id: lastStoredUser.messageGroupId, 
          retryNumber: maxRetry + 1 
        };
      } else {
        // Fallback: create a new message group (shouldn't happen with proper data)
        currentMessageGroupRef.current = { 
          id: `mg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 
          retryNumber: 1 
        };
      }
    } else {
      currentMessageGroupRef.current.retryNumber += 1;
    }
    const retryGroup = { ...currentMessageGroupRef.current };
    
    // Remove all messages AFTER the last user message from local state (for UI)
    // Use functional update to get the current state
    setMessages((prev) => {
      // Find the last user message index in the CURRENT state
      const currentLastUserIdx = prev.map(m => m.role).lastIndexOf("user");
      if (currentLastUserIdx === -1) return prev;
      
      // Keep messages up to and including the last user message
      const updated = prev.slice(0, currentLastUserIdx + 1);
      // Update the user message's createdAt to retry time
      updated[updated.length - 1] = { ...updated[updated.length - 1], createdAt: retryTimestamp };
      return updated;
    });
    
    // For retry, we keep old assistant messages in the store (with lower retryNumber)
    // and add new ones with incremented retryNumber
    // The backend will filter to show only the highest retryNumber
    if (activeThreadId) {
      // Invalidate the message cache to prevent stale DB messages from showing
      invalidateMessageCache(activeThreadId);
      
      // Update the user message's createdAt to retry time for accurate response time
      const storedMessages = messagesByThreadId[activeThreadId] || [];
      let storeUserIndex = -1;
      for (let i = storedMessages.length - 1; i >= 0; i--) {
        if (storedMessages[i].role === "user") {
          storeUserIndex = i;
          break;
        }
      }
      if (storeUserIndex !== -1) {
        // Still truncate locally to clean up the UI state in the store
        // But the sync to Cosmos DB will add the new message with higher retryNumber
        truncateMessagesAfter(activeThreadId, storeUserIndex);
        updateMessageAt(activeThreadId, storeUserIndex, { createdAt: retryTimestamp });
      }
    }

    // Remove artifacts and mutable block state from the response being replaced.
    setGeneratedDocs((prev) => prev.filter((doc) => doc.messageGroupId !== retryGroup.id));
    generatedDocsRef.current = generatedDocsRef.current.filter(
      (doc) => doc.messageGroupId !== retryGroup.id,
    );
    contentBlocksRef.current = [];
    currentBlockIndexRef.current = -1;
    streamingDocRef.current = null;
    if (streamingDocRafRef.current !== null) {
      cancelAnimationFrame(streamingDocRafRef.current);
      streamingDocRafRef.current = null;
    }
    streamingDocDirtyRef.current = false;
    setStreamingDocContent("");
    pendingDocRef.current = null;
    pendingDocBlockRef.current = "";

    await send(
      lastUserMsg,
      false,
      false,
      undefined,
      undefined,
      undefined,
      {
        skipUserMessage: true,
        messageGroupId: retryGroup.id,
        retryNumber: retryGroup.retryNumber,
        userMessageTimestamp: retryTimestamp,
      },
    );
  }

  // Refresh a generated doc by finding the latest message for its messageGroupId
  const refreshDoc = useCallback((docId: string): GeneratedDoc | null => {
    const doc = generatedDocs.find(d => d.id === docId);
    if (!doc || !doc.messageGroupId) {
      console.warn("[useAgentChat] Cannot refresh doc - no messageGroupId", docId);
      return doc || null;
    }

    // Find the latest assistant message with this messageGroupId (highest retryNumber)
    const groupMessages = messages.filter(
      m => m.role === 'assistant' && m.messageGroupId === doc.messageGroupId
    );
    
    if (groupMessages.length === 0) {
      console.warn("[useAgentChat] No messages found for messageGroupId", doc.messageGroupId);
      return doc;
    }

    // Sort by retryNumber descending and get the latest
    const latestMsg = groupMessages.sort((a, b) => (b.retryNumber || 0) - (a.retryNumber || 0))[0];
    
    // Extract document from the latest message content
    // Try JSON format first
    const jsonDocs = extractJsonDocuments(latestMsg.content);
    let newDoc: GeneratedDoc | null = null;
    
    if (jsonDocs && jsonDocs.documents.length > 0) {
      const d = jsonDocs.documents[0];
      newDoc = {
        id: doc.id,
        title: d.title,
        content: d.content,
        hasExplicitTitle: true,
        messageGroupId: doc.messageGroupId,
      };
    } else {
      // No JSON document tags — refreshDoc only works with explicit document formats
    }
    
    if (newDoc) {
      // Preserve the original doc's id and messageGroupId
      newDoc.id = doc.id;
      newDoc.messageGroupId = doc.messageGroupId;
      
      // Update the doc in state
      setGeneratedDocs(prev => prev.map(d => d.id === docId ? newDoc! : d));
      
      return newDoc;
    }
    
    return doc;
  }, [generatedDocs, messages]);

  // Continue deep research after MCQ clarification answers are submitted
  const continueDeepResearch = useCallback(async (threadId: string, answersText: string, researchId: string) => {
    if (!activeThreadId) return;
    
    setIsStreaming(true);
    isGeneratingRef.current = true;
    
    // Update research status back to running
    setMessages((m) => {
      const updated = [...m];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg.research && lastMsg.research.id === researchId) {
        updated[updated.length - 1] = {
          ...lastMsg,
          content: "",
          research: { ...lastMsg.research, status: "running", clarificationText: undefined },
        };
      }
      return updated;
    });
    
    await new Promise<void>((resolve) => {
      const abort = streamDeepResearch(answersText, {
        onThinking: (event) => {
          const content = event.summary;
          const lowerContent = content.toLowerCase();
          if (lowerContent.includes('runstatus') || lowerContent.startsWith('run_') || lowerContent === 'queued' || lowerContent === 'in_progress') return;
          
          const newSources = (event.citations || []).map((c) => {
            try {
              const url = new URL(c.url);
              return { title: c.title || url.hostname, url: c.url, domain: url.hostname, favicon: `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32` };
            } catch {
              return { title: c.title || c.url, url: c.url, domain: c.url };
            }
          });
          
          setMessages((m) => {
            const updated = [...m];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg.research) {
              const existingSources = lastMsg.research.sources || [];
              const existingUrls = new Set(existingSources.map(s => s.url));
              const uniqueNewSources = newSources.filter(s => !existingUrls.has(s.url));
              updated[updated.length - 1] = {
                ...lastMsg,
                research: {
                  ...lastMsg.research,
                  sources: [...existingSources, ...uniqueNewSources],
                  activities: [...lastMsg.research.activities, { type: "thinking" as const, content, timestamp: Date.now(), citations: (event.citations || []).map(c => ({ url: c.url, title: c.title || "" })) }],
                },
              };
            }
            return updated;
          });
        },
        onStatus: () => {},
        onComplete: (event) => {
          let sources = (event.citations || []).map((c) => {
            try {
              const url = new URL(c.url);
              return { title: c.title || url.hostname, url: c.url, domain: url.hostname, favicon: `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32` };
            } catch {
              return { title: c.title || c.url, url: c.url, domain: c.url };
            }
          });
          
          if (sources.length === 0 && event.response) {
            const urlRegex = /https?:\/\/[^\s\)>\]"',]+/g;
            const foundUrls = new Set<string>();
            let match;
            while ((match = urlRegex.exec(event.response)) !== null) {
              let url = match[0].replace(/[.),:;]+$/, "");
              if (!foundUrls.has(url)) {
                foundUrls.add(url);
                try {
                  const parsed = new URL(url);
                  sources.push({ title: parsed.hostname.replace(/^www\./, ""), url, domain: parsed.hostname, favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32` });
                } catch {}
              }
            }
          }
          
          setMessages((m) => {
            const updated = [...m];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg.research) {
              updated[updated.length - 1] = {
                ...lastMsg,
                content: event.response || "",
                research: { ...lastMsg.research, sources, result: event.response || "", status: "completed", endTime: Date.now() },
              };
            }
            return updated;
          });
          
          // Persist
          setTimeout(() => {
            if (activeThreadId) {
              appendMessage(activeThreadId, {
                role: "assistant", content: event.response || "", isResearch: true,
                research: { id: researchId, query: answersText, status: "completed", startTime: Date.now(), endTime: Date.now(), activities: [], sources, result: event.response || "", searchCount: 0 },
                createdAt: Date.now(),
              });
            }
          }, 100);
          
          isGeneratingRef.current = false;
          setIsStreaming(false);
          resolve();
        },
        onClarification: (event) => {
          // Second round of clarification — unlikely but handle it
          setMessages((m) => {
            const updated = [...m];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg.research) {
              updated[updated.length - 1] = { ...lastMsg, content: event.response, research: { ...lastMsg.research, status: "clarification", clarificationText: event.response, deepResearchThreadId: event.thread_id } };
            }
            return updated;
          });
          isGeneratingRef.current = false;
          setIsStreaming(false);
          resolve();
        },
        onError: (error) => {
          setMessages((m) => {
            const updated = [...m];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg.research) {
              updated[updated.length - 1] = { ...lastMsg, content: `Error: ${error}`, research: { ...lastMsg.research, status: "error", error } };
            }
            return updated;
          });
          isGeneratingRef.current = false;
          setIsStreaming(false);
          resolve();
        },
      }, threadId);
    });
  }, [activeThreadId, appendMessage]);

  return { threadId, messages, send, reset, stop, editMessage, retry, setMessages, isStreaming, isWaitingForResponse, activeToolLabel, generatedDocs, setGeneratedDocs, refreshDoc, streamingDocContent, continueDeepResearch };
}