// UnifiedChatContainer.tsx - Consistent chat UI across the app
import React, { useRef, useEffect, useState, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import ChatPane from "@/features/chat/ChatPane";
import { ChatQueryRail } from "@/components/chat/ChatQueryRail";
import { ChatInput, type UploadedFile } from "@/features/create/sharedUI";
import type { ChatMsg } from "@/features/chat/ChatBubble";
import { useChatStore } from "@/lib/chatStore";
import { useShallow } from "zustand/react/shallow";

type SuggestionItem = string | { title: string; description: string };

type UnifiedChatContainerProps = {
  messages: ChatMsg[];
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSend: (attachedFiles?: UploadedFile[], overrideText?: string) => void;
  onStop?: () => void;
  isSending: boolean;
  isTyping?: boolean;
  /** Names the tool currently running, shown instead of the bare loading dot. */
  statusLabel?: string | null;
  disabled?: boolean;
  placeholder?: string;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  emptyStateSuggestions?: SuggestionItem[];
  onSuggestionClick?: (suggestion: string) => void;
  showUserActions?: boolean;
  onUserMessageEdit?: (index: number, newContent: string) => void;
  onGeneratedDocClick?: (docId: string) => void;
  onQuizOpen?: (quiz: { quizId: string; title: string; questions: unknown[]; assessmentType?: string; thresholdConcept?: string }) => void;
  onChallengeOpen?: (challenge: { challengeId: string; title: string; description: string; difficulty: string; hints?: string[]; solution: string; challengeType?: string }) => void;
  onDocumentDownload?: (docId: string, title: string) => void;
  onAssistantRetry?: () => void;
  agentId?: string;
  threadId?: string | null;
  className?: string;
  // Web search toggle props
  webSearchEnabled?: boolean;
  onWebSearchToggle?: (enabled: boolean) => void;
  showWebSearchToggle?: boolean;
  // Deep research toggle props
  deepResearchEnabled?: boolean;
  onDeepResearchToggle?: (enabled: boolean) => void;
  showDeepResearchButton?: boolean;
  isDeepResearching?: boolean;
  quotedText?: string;
  onClearQuotedText?: () => void;
  // Scroll state callback
  onScrollStateChange?: (isScrolled: boolean) => void;
  // Research panel callbacks
  onResearchStop?: (researchId: string) => void;
  onResearchPanelOpen?: (researchId: string, tab?: "activity" | "sources") => void;
  isResearchPanelOpen?: boolean;
  selectedResearchId?: string;
  // Infinite scroll / pagination props
  hasMoreMessages?: boolean;
  isLoadingMore?: boolean;
  onLoadMoreMessages?: () => void;
  // Slot rendered below the ChatInput
  bottomSlot?: React.ReactNode;
};

export function UnifiedChatContainer({
  messages,
  input,
  onInputChange,
  onSend,
  onStop,
  isSending,
  isTyping = false,
  statusLabel = null,
  disabled = false,
  placeholder = "Type your message...",
  emptyStateTitle = "Start a Conversation",
  emptyStateDescription = "Ask anything to get started.",
  emptyStateSuggestions = [],
  onSuggestionClick,
  showUserActions = false,
  onUserMessageEdit,
  onGeneratedDocClick,
  onQuizOpen,
  onChallengeOpen,
  onDocumentDownload,
  onAssistantRetry,
  agentId,
  threadId,
  className = "",
  webSearchEnabled = false,
  onWebSearchToggle,
  showWebSearchToggle = false,
  deepResearchEnabled = false,
  onDeepResearchToggle,
  showDeepResearchButton = false,
  isDeepResearching = false,
  quotedText,
  onClearQuotedText,
  onScrollStateChange,
  onResearchStop,
  onResearchPanelOpen,
  isResearchPanelOpen = false,
  selectedResearchId,
  hasMoreMessages = false,
  isLoadingMore = false,
  onLoadMoreMessages,
  bottomSlot,
}: UnifiedChatContainerProps) {
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const prevMessageCountRef = useRef<number>(0);
  // Tracks whether the user manually scrolled away during an active generation
  const userScrolledAwayRef = useRef(false);
  const wasSendingRef = useRef(false);
  const { userName, userNickname } = useChatStore(
    useShallow((s) => ({ 
      userName: s.userName, 
      userNickname: s.userNickname,
    }))
  );
  // Use nickname if available, otherwise use first name from userName
  const displayName = userNickname || userName.split(" ")[0] || "User";

  // Check if user has scrolled up from bottom (for scroll-to-bottom button)
  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom && messages.length > 0);
      // Notify parent about scroll state (scrolled = scrollTop > 0)
      onScrollStateChange?.(scrollTop > 10);

      // Track if user scrolled away during active generation
      if (isSending) {
        userScrolledAwayRef.current = !isNearBottom;
      }
    }
  }, [messages.length, onScrollStateChange, isSending]);

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  // Auto-scroll to bottom when new messages are added or on initial load
  // Respects user scroll: if user scrolled up during streaming, don't force them back down
  useEffect(() => {
    if (!chatContainerRef.current) return;
    
    const currentCount = messages.length;
    const prevCount = prevMessageCountRef.current;
    
    const messagesAdded = currentCount > prevCount;
    const isInitialLoad = prevCount === 0 && currentCount > 0;

    // Always scroll on initial load; otherwise only scroll if messages were added
    // AND the user hasn't deliberately scrolled away during generation
    const shouldScroll = isInitialLoad || (messagesAdded && !userScrolledAwayRef.current);
    
    if (shouldScroll) {
      const scrollBehavior = isInitialLoad ? "auto" : "smooth";
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: scrollBehavior as ScrollBehavior,
      });
    }
    
    prevMessageCountRef.current = currentCount;
  }, [messages]);

  // When generation finishes (isSending transitions true → false), scroll to bottom
  // regardless of where the user was, then reset the scroll-away flag
  useEffect(() => {
    if (wasSendingRef.current && !isSending) {
      // Generation just completed — scroll to the final result
      requestAnimationFrame(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: "smooth",
          });
        }
      });
      userScrolledAwayRef.current = false;
    }
    wasSendingRef.current = isSending;
  }, [isSending]);

  return (
    <div className={`relative flex flex-col h-full overflow-hidden bg-neutral-900 ${className}`}>
      {/* Messages Area - scrollable with relative positioning for scroll button */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={chatContainerRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto px-4 sm:px-6 lg:px-8"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "rgb(64 64 64) transparent",
          }}
        >
          {/* External Chatpane - outer container for all chat content */}
          <div className={`w-full max-w-[54rem] mx-auto pt-2 pb-32 ${messages.length === 0 && !isSending ? 'h-full flex flex-col' : ''}`}>
            {/* EmptyState when no messages and not sending — never show blank loading for empty threads */}
            {messages.length === 0 && !isSending ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState
                  description={emptyStateDescription}
                  suggestions={emptyStateSuggestions}
                  onSuggestionClick={onSuggestionClick}
                  userName={displayName}
                />
              </div>
            ) : (
              <ChatPane
                messages={messages}
                agentId={agentId}
                threadId={threadId}
                showUserActions={showUserActions}
                onUserMessageEdit={onUserMessageEdit}
                onGeneratedDocClick={onGeneratedDocClick}
                  onQuizOpen={onQuizOpen}
                onChallengeOpen={onChallengeOpen}
                onDocumentDownload={onDocumentDownload}
                onAssistantRetry={onAssistantRetry}
                isSending={isSending}
                isTyping={isTyping}
                statusLabel={statusLabel}
                onResearchStop={onResearchStop}
                onResearchPanelOpen={onResearchPanelOpen}
                isResearchPanelOpen={isResearchPanelOpen}
                selectedResearchId={selectedResearchId}
                disableAutoScroll={true}  // Parent (UnifiedChatContainer) manages scrolling
                readOnly={disabled}
              />
            )}
          </div>
        </div>

        {/* Query rail - hover to browse and jump to earlier questions */}
        <ChatQueryRail messages={messages} scrollContainerRef={chatContainerRef} />

        {/* Scroll to bottom button - positioned relative to messages area, only show when there are messages */}
      </div>

      {/* Input Area - fixed at bottom, positioned to overlap scroll area */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
        {/* Scroll to bottom button - positioned above the input area */}
        {messages.length > 0 && showScrollButton && (
          <div className="flex justify-center mb-2 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
              onClick={scrollToBottom}
              className="size-10 rounded-full bg-neutral-900 border border-neutral-700/40 hover:bg-neutral-800 hover:border-neutral-600 shadow-none transition-all duration-200 hover:scale-105 outline-none focus:outline-none flex items-center justify-center"
              aria-label="Scroll to bottom"
            >
              <ChevronDown className="h-5 w-5 stroke-[2.5] text-neutral-300" />
            </button>
          </div>
        )}
        {/* Gradient fade from transparent to opaque - full width */}
        <div className="h-8 bg-gradient-to-b from-transparent to-neutral-900 pointer-events-none" />
        {/* Solid opaque region below the gradient - full width */}
        <div className={`bg-neutral-900 ${bottomSlot ? 'pb-0' : 'pb-3'} px-4 sm:px-6 lg:px-8`}>
          <div className="w-full max-w-[48rem] mx-auto pointer-events-auto">
            <ChatInput
              value={input}
              onChange={onInputChange}
              onSend={onSend}
              onStop={onStop}
              disabled={disabled}
              isSending={isSending}
              placeholder={placeholder}
              webSearchEnabled={webSearchEnabled}
              onWebSearchToggle={onWebSearchToggle}
              showWebSearchToggle={showWebSearchToggle}
              deepResearchEnabled={deepResearchEnabled}
              onDeepResearchToggle={onDeepResearchToggle}
              showDeepResearchButton={showDeepResearchButton}
              isDeepResearching={isDeepResearching}
              quotedText={quotedText}
              onClearQuotedText={onClearQuotedText}
            />
            <p className="text-center text-xs text-neutral-500 mt-1.5">AI-generated content may be inaccurate</p>
          </div>
        </div>
        {/* Bottom slot (e.g. chat history drawer) - full width background */}
        {bottomSlot && (
          <div className="bg-neutral-900 pointer-events-auto pt-2">
            {bottomSlot}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Get Time-based Greeting ----------------------------- */
function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return "Good morning";
  } else if (hour >= 12 && hour < 17) {
    return "Good afternoon";
  } else if (hour >= 17 && hour < 21) {
    return "Good evening";
  } else {
    return "Hey";
  }
}

/* ----------------------------- Empty State Component ----------------------------- */
function EmptyState({
  description,
  suggestions,
  onSuggestionClick,
  userName = "User",
}: {
  description: string;
  suggestions: SuggestionItem[];
  onSuggestionClick?: (suggestion: string) => void;
  userName?: string;
}) {
  const greeting = getTimeBasedGreeting();
  
  return (
    <div className="flex flex-col items-center justify-center h-full animate-in fade-in duration-500">
      <div className="text-center w-full max-w-2xl px-6 -mt-8">
        {/* Greeting */}
        <p className="text-2xl font-semibold text-neutral-300 mb-8">
          {greeting}, {userName}
        </p>
        
        {/* Description */}
        {description && (
          <p className="text-sm text-neutral-500 max-w-md mx-auto mb-8">
            {description}
          </p>
        )}

        {/* Suggestion cards — 2×2 grid with breathing room */}
        {suggestions.length > 0 && (
          <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto">
            {suggestions.map((suggestion, idx) => {
              const text = typeof suggestion === 'string' ? suggestion : suggestion.description;
              return (
                <div key={idx} className="relative group">
                  {/* Glow ring sits 1px outside the button, so its radius is 1px larger. */}
                  <div className="absolute -inset-[1px] rounded-[17px] bg-gradient-to-b from-neutral-500/10 via-neutral-600/5 to-neutral-700/10 blur-[1px] pointer-events-none" />
                  <button
                    onClick={() => onSuggestionClick?.(text)}
                    className="relative w-full px-3 py-3 rounded-2xl cursor-pointer text-center flex items-center justify-center
                           bg-neutral-900 border border-neutral-500
                           shadow-[0_2px_16px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.04)]
                           hover:border-neutral-400
                           hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5
                           transition-all duration-150 ease-out
                           h-[3.5rem]"
                  >
                    <span className="text-sm text-[#bcbcbc] group-hover:text-neutral-200 line-clamp-2 leading-relaxed transition-colors">{text}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}