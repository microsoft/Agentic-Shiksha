import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import type { ChatMsg, ResearchData } from "@/lib/types";
import { simpleStreamChat, streamAgentChat, streamDeepResearch, uploadChatImages, type ChatContextStatus } from "@/lib/api";
import { streamAgentChatViaAGUI } from "@/lib/aguiAdapter";
import { USE_AGUI_TRANSPORT } from "@/lib/config";
import { useChatStore } from "@/lib/chatStore";
import { useCurrentUserId } from "@/lib/userStore";
import { useShallow } from "zustand/react/shallow";
import { logger } from "@/lib/loggingService";
import { extractJsonDocuments, type GeneratedDoc } from "@/features/create/markdownUtils";
import { invalidateMessageCache } from "@/lib/useMessagePagination";
import type { UploadedFile } from "@/features/create/sharedUI";
import { CLARIFICATION_SUBMITTED_EVENT, notifyClarificationFinished } from "@/features/chat/chatQueryEvent";
import { prefixedId } from "@/lib/secureId";
import { circuitChatText } from "@/lib/circuit";
import { parseChatResponse } from "@/features/chat/chatResponse";
import { createChatTurnController, type ChatTurnController } from "./chatTurnController";
import { createChatTurnState } from "./chatTurnReducer";
import { createChatTurnPersistence, restoreChatHistory, snapshotChatContext } from "./chatPersistence";
import { useChatPresentation } from "./useChatPresentation";
import {
  BASE_TICK_INTERVAL_MS,
  CONTEXTUALISING_LABEL,
  createGenerationOwner,
  getAdaptiveCharsPerTick,
  nextGenerationId,
} from "@/features/chat/generationLifecycle";

// Thinking token type for deep research
export interface ThinkingToken {
  summary: string;
  citations?: Array<{ url: string; title?: string }>;
  timestamp: number;
}

// Documents are ONLY created via:
// 1. The create_document tool (sets existingDocId in streaming path)
// 2. Explicit [DOCUMENT]...[/DOCUMENT] JSON tags in the response
// Regular chat responses (even with headings, lists, etc.) are never
// auto-extracted as documents.

export function useAgentChat(
  agentId: string | null,
  agentName?: string,
  agentKind?: "learning" | "exam"
) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const {
    messages, setMessages, generatedDocs, setGeneratedDocs,
    streamingDocContent, clearStreamingDocument, presentTurn,
  } = useChatPresentation();
  const [isStreaming, setIsStreaming] = useState(false); // Disables input while typing
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false); // Shows loading indicator
  const [activeToolLabel, setActiveToolLabel] = useState<string | null>(null);

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
  
  const [generationOwner] = useState(createGenerationOwner);
  const activeTurnRef = useRef<ChatTurnController | null>(null);

  useEffect(() => {
    const onSubmitted = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail?.clarifyId === "string") {
        activeTurnRef.current?.dispatch({ type: "clarification_submitted", clarifyId: event.detail.clarifyId });
      }
    };
    window.addEventListener(CLARIFICATION_SUBMITTED_EVENT, onSubmitted);
    return () => window.removeEventListener(CLARIFICATION_SUBMITTED_EVENT, onSubmitted);
  }, []);
  
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
      renameThread: s.renameThread,
      setThreadSessionUuid: s.setThreadSessionUuid,
      updateMessageAt: s.updateMessageAt,
      setActiveResearch: s.setActiveResearch,
      updateActiveResearch: s.updateActiveResearch,
      clearActiveResearch: s.clearActiveResearch,
      getActiveResearch: s.getActiveResearch,
    }))
  );

  // Retire the request owner, not a collection of shared tool/document refs.
  useEffect(() => {
    const preserveTurn = () => {
      activeTurnRef.current?.interrupt();
      activeTurnRef.current = null;
      generationOwner.cancel();
      currentGenerationIdRef.current = nextGenerationId();
      isGeneratingRef.current = false;
      abortControllerRef.current?.abort();
      setIsStreaming(false);
      setIsWaitingForResponse(false);
      setActiveToolLabel(null);
    };
    window.addEventListener("pagehide", preserveTurn, { capture: true });
    return () => {
      window.removeEventListener("pagehide", preserveTurn, { capture: true });
      preserveTurn();
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
      }
    };
  }, [generationOwner]);

  // Track last synced message count + IDs to avoid redundant setMessages calls
  const lastSyncedMsgKeyRef = useRef<string>("");
  const localThreadIdRef = useRef(activeThreadId);
  const conversationBoundaryRef = useRef(
    `${currentUserId}:${agentId ?? ""}:${activeThreadId ?? ""}`,
  );

  // A route-level course/thread switch is a hard conversation boundary. Clear
  // every local streaming ref before the store-sync effect hydrates the newly
  // selected thread; otherwise structured blocks from the previous chat cause
  // that sync to be skipped and leave the old transcript on screen.
  useLayoutEffect(() => {
    const nextBoundary = `${currentUserId}:${agentId ?? ""}:${activeThreadId ?? ""}`;
    if (conversationBoundaryRef.current === nextBoundary) return;
    conversationBoundaryRef.current = nextBoundary;

    // Switching mid-stream used to discard the partial reply outright, so coming
    // back showed nothing. Save what already arrived against the thread it
    // belongs to before the refs below are cleared.
    const leavingThreadId = localThreadIdRef.current;
    if (activeTurnRef.current) {
      activeTurnRef.current.interrupt();
      activeTurnRef.current = null;
    } else if (isGeneratingRef.current && leavingThreadId) {
      const partial = fullResponseRef.current.slice(0, displayedLengthRef.current).trim();
      if (partial) {
        appendMessage(leavingThreadId, {
          role: "assistant",
          content: partial,
          createdAt: Date.now(),
          isLatest: true,
        });
      }
    }

    generationOwner.cancel();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    clearStreamingDocument();

    currentGenerationIdRef.current = nextGenerationId();
    isGeneratingRef.current = false;
    fullResponseRef.current = "";
    displayedLengthRef.current = 0;
    pendingDocRef.current = null;
    pendingDocBlockRef.current = "";
    currentMessageGroupRef.current = null;
    lastSyncedMsgKeyRef.current = "";
    threadIdRef.current = null;
    localThreadIdRef.current = activeThreadId;

    setMessages([]);
    setGeneratedDocs([]);
    setThreadId(null);
    setIsStreaming(false);
    setIsWaitingForResponse(false);
    setActiveToolLabel(null);
  }, [activeThreadId, agentId, currentUserId, appendMessage, clearStreamingDocument, generationOwner, setMessages, setGeneratedDocs]);

  // Sync messages from store when thread changes
  // Skip during active generation to prevent store overwriting local streaming state
  useEffect(() => {
    // Don't sync while actively generating - we manage local state during generation
    if (isGeneratingRef.current) {
      console.log('[useAgentChat] Skipping sync - isGeneratingRef is true');
      return;
    }
    
    // The completed turn still owns its document panel and deferred suggestions.
    // A conversation boundary releases it before history is hydrated.
    if (activeTurnRef.current) return;
    
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
      const restored = restoreChatHistory(storedMessages, getActiveResearch(activeThreadId));
      setMessages(restored.messages);
      setGeneratedDocs(restored.documents);
      
      // Sync the Azure thread ID from per-thread context.
      // CRITICAL: always clear first so a stale ID from a previous thread
      // can never leak into a new conversation.
      const thread = threads[activeThreadId];
      const azureId = thread?.context?.sessionUuid ?? null;
      setThreadId(azureId);
      threadIdRef.current = azureId;
    } else {
      setMessages([]);
      setGeneratedDocs([]);
      setThreadId(null);
    }
  }, [activeThreadId, messagesByThreadId, threads, getActiveResearch, setMessages, setGeneratedDocs]);

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
    eventId?: string;
    supersedesEventId?: string;
    eventText?: string;
  }

  function updateContextStatus(status: ChatContextStatus, generationId: number) {
    if (generationId !== currentGenerationIdRef.current) return;
    setActiveToolLabel(current => status === "preparing"
      ? CONTEXTUALISING_LABEL
      : current === CONTEXTUALISING_LABEL ? null : current);
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
    if (!agentId || (!text.trim() && (!attachedFiles || attachedFiles.length === 0)) || isStreaming || isGeneratingRef.current) return;
    const t = text.trim();
    const answerDepth = useChatStore.getState().answerDepth;
    // displayText: if provided, shown in the chat bubble instead of the raw API text
    const visibleText = displayText?.trim() || t;
    
    // Cancel any existing request and set up new generation
    activeTurnRef.current?.interrupt();
    activeTurnRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const generation = generationOwner.begin();
    abortControllerRef.current = generation.controller;
    const generationId = generation.id;
    currentGenerationIdRef.current = generationId;
    isGeneratingRef.current = true;
    
    // Capture timestamp for response time calculation (used for both local and persisted message)
    const userMsgTimestamp = sendOptions.userMessageTimestamp ?? Date.now();
    
    // Generate a new message group ID for this conversation turn (user message + its responses)
    // Sent on as usage_event_id, so it must not be guessable from earlier ids.
    const messageGroupId = sendOptions.messageGroupId
      ?? prefixedId("mg");
    const eventId = sendOptions.eventId ?? messageGroupId;
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
      localThreadIdRef.current = currentThreadId;
      conversationBoundaryRef.current = `${currentUserId}:${agentId}:${currentThreadId}`;
    }
    // A retry must not bind the same event to a newly edited simulation context.
    const eventText = sendOptions.eventText
      ?? circuitChatText(t, useChatStore.getState().circuitChatContext, { threadId: currentThreadId, agentId, userId: currentUserId });

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
        if (!generation.isCurrent()) return;
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
        messageGroupId,
        eventId,
        supersedesEventId: sendOptions.supersedesEventId,
        eventText,
        ...(displayUrls.length > 0 && { imageUrls: displayUrls }),
      }]);

      // Persist user message without image URLs; the background upload patches them later.
      if (currentThreadId) {
        const msgToAppend = {
          role: "user" as const,
          content: visibleText,
          createdAt: userMsgTimestamp,
          messageGroupId,
          eventId,
          supersedesEventId: sendOptions.supersedesEventId,
          eventText,
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
    setActiveToolLabel(researchMode ? null : CONTEXTUALISING_LABEL);

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
    const snapshot = snapshotChatContext(currentThreadId);
    const turn = createChatTurnController({
      initial: createChatTurnState({
        id: prefixedId("turn"), agentId, sessionId: snapshot.sessionId,
        createdAt: Date.now(), messageGroupId, retryNumber: sendOptions.retryNumber ?? 0,
      }),
      generation,
      transport: USE_AGUI_TRANSPORT ? streamAgentChatViaAGUI : streamAgentChat,
      request: {
        agentId, text: eventText, sessionId: snapshot.sessionId,
        options: {
          web_search_enabled: webSearchEnabled, answer_depth: answerDepth,
          user_id: currentUserId, usage_event_id: messageGroupId, event_id: eventId,
          supersedes_event_id: sendOptions.supersedesEventId,
          inject_profile: snapshot.injectProfile, user_profile: snapshot.userProfile,
          image_urls: base64Urls.length ? base64Urls : undefined,
        },
      },
      persistence: createChatTurnPersistence({
        localThreadId: currentThreadId, agentId, agentName, agentKind: kind,
        userId: currentUserId, userText: t,
        injectProfile: snapshot.injectProfile, profileHash: snapshot.profileHash,
      }),
      present: (state, event) => {
        presentTurn(state, event);
        threadIdRef.current = state.sessionId;
        setThreadId(state.sessionId);
        isGeneratingRef.current = state.phase === "streaming";
        setIsStreaming(state.phase === "streaming");
        setIsWaitingForResponse(state.waiting);
        setActiveToolLabel(state.activeToolLabel);
        if (event?.type === "clarification_done" && event.clarifyId) {
          notifyClarificationFinished(event.clarifyId);
        }
      },
    });
    activeTurnRef.current = turn;
    setMessages(current => [...current, { role: "assistant", content: "", createdAt: turn.state.message.createdAt }]);
    await turn.run();
  }

  function reset() {
    activeTurnRef.current?.interrupt();
    activeTurnRef.current = null;
    generationOwner.cancel();
    clearStreamingDocument();
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
    currentGenerationIdRef.current = nextGenerationId();
    
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
    if (activeTurnRef.current?.state.phase === "streaming") {
      activeTurnRef.current.interrupt();
      generationOwner.cancel();
      currentGenerationIdRef.current = nextGenerationId();
      abortControllerRef.current = null;
      return;
    }
    
    // Abort any in-flight HTTP request
    if (abortControllerRef.current) {
      console.log("[useAgentChat] Aborting in-flight request");
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    } else {
      console.log("[useAgentChat] No abortController to abort");
    }
    
    // Invalidate the current generation so any pending callbacks are ignored
    generationOwner.cancel();
    currentGenerationIdRef.current = nextGenerationId();
    
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
    const answerDepth = useChatStore.getState().answerDepth;
    const kind = agentKind ?? (agentName?.toLowerCase().startsWith("exam") ? "exam" : "learning");
    
    // Cancel any existing request and set up new generation
    activeTurnRef.current?.interrupt();
    activeTurnRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const generation = generationOwner.begin();
    abortControllerRef.current = generation.controller;
    const generationId = generation.id;
    currentGenerationIdRef.current = generationId;
    isGeneratingRef.current = true;
    
    // Create the edited message with isLatest: true
    const originalMessage = messages[index];
    const eventId = prefixedId("mg");
    const supersedesEventId = originalMessage?.eventId ?? originalMessage?.messageGroupId;
    const eventText = circuitChatText(t, useChatStore.getState().circuitChatContext, { threadId: activeThreadId, agentId, userId: currentUserId });
    currentMessageGroupRef.current = { id: eventId, retryNumber: 0 };
    const editedUserMessage = { 
      role: "user" as const, 
      content: t,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
      isLatest: true,
      eventId,
      supersedesEventId,
      eventText,
      messageGroupId: eventId,
      retryNumber: 0,
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
    setActiveToolLabel(CONTEXTUALISING_LABEL);

    try {
      const signal = abortControllerRef.current.signal;
      
      // Read the Azure thread ID strictly from the per-thread store.
      const freshEditThreadId = activeThreadId
        ? (useChatStore.getState().threads[activeThreadId]?.context?.sessionUuid ?? null)
        : null;
      console.log("[useAgentChat] editMessage - resolved threadId:", freshEditThreadId);
      
      const { reply, thread_id: newThreadId } = await simpleStreamChat(
        agentId,
        eventText,
        currentUserId, freshEditThreadId, signal, false, answerDepth,
        {
          event_id: eventId,
          supersedes_event_id: supersedesEventId,
          onContextStatus: status => updateContextStatus(status, generationId),
        },
      );
        
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
    activeTurnRef.current?.interrupt();
    activeTurnRef.current = null;
    clearStreamingDocument();
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
        eventId: messages[lastUserMsgIndex].eventId ?? messages[lastUserMsgIndex].messageGroupId ?? retryGroup.id,
        supersedesEventId: messages[lastUserMsgIndex].supersedesEventId,
        eventText: messages[lastUserMsgIndex].eventText,
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