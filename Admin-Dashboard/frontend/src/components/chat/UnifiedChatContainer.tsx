// UnifiedChatContainer.tsx — Dashboard version.
// Same layout as the main Frontend's UnifiedChatContainer but without
// chatStore, speech recognition, file uploads, web search, deep research.

import React, { useRef, useEffect, useState, useCallback } from "react";
import { MessageSquare, ChevronDown, ArrowUp, Square } from "lucide-react";
import ChatPane from "@/features/chat/ChatPane";
import type { ChatMsg } from "@/features/chat/ChatBubble";

type SuggestionItem = { title: string; description: string };

type UnifiedChatContainerProps = {
  messages: ChatMsg[];
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop?: () => void;
  isSending: boolean;
  isTyping?: boolean;
  disabled?: boolean;
  placeholder?: string;
  // Empty state
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  suggestions?: SuggestionItem[];
  onSuggestionClick?: (text: string) => void;
  // Retry
  onAssistantRetry?: () => void;
};

export function UnifiedChatContainer({
  messages,
  input,
  onInputChange,
  onSend,
  onStop,
  isSending,
  isTyping,
  disabled,
  placeholder = "Type a message…",
  emptyStateTitle = "Chat",
  emptyStateDescription,
  suggestions,
  onSuggestionClick,
  onAssistantRetry,
}: UnifiedChatContainerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Track scroll for "scroll to bottom" button
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollButton(!atBottom && messages.length > 0);
  }, [messages.length]);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Auto-resize textarea (28–180px)
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!input.trim()) {
      el.style.height = "28px";
      el.style.overflowY = "hidden";
      return;
    }
    el.style.height = "0px";
    const h = Math.min(el.scrollHeight, 180);
    el.style.height = `${Math.max(h, 28)}px`;
    el.style.overflowY = el.scrollHeight > 180 ? "auto" : "hidden";
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSending && input.trim()) onSend();
    }
  };

  const isEmpty = messages.length === 0;
  const hasContent = !!input.trim();

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-neutral-900">
      {/* ── Scrollable area ── */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto px-4 sm:px-6 lg:px-8"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgb(64 64 64) transparent" }}
        >
          <div className="w-full max-w-[54rem] mx-auto pt-2 pb-32">
            {isEmpty ? (
              /* ── Empty state ── */
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
                <div className="w-12 h-12 rounded-xl bg-neutral-800 flex items-center justify-center mb-4">
                  <MessageSquare className="w-6 h-6 text-neutral-400" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-200 mb-1">
                  {emptyStateTitle}
                </h3>
                {emptyStateDescription && (
                  <p className="text-sm text-neutral-500 max-w-md mb-6">
                    {emptyStateDescription}
                  </p>
                )}
                {suggestions && suggestions.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => onSuggestionClick?.(s.description)}
                        className="text-left px-4 py-3 rounded-2xl border border-neutral-700/50 bg-neutral-800/40 hover:bg-neutral-700/50 hover:border-neutral-600/50 transition-all"
                      >
                        <span className="text-sm font-medium text-neutral-200 block">{s.title}</span>
                        <span className="text-xs text-neutral-500 line-clamp-2 mt-0.5">{s.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* ── Messages via ChatPane ── */
              <ChatPane
                messages={messages}
                isTyping={isTyping}
                onAssistantRetry={onAssistantRetry}
                padBottom={false}
                disableAutoScroll
              />
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      {/* ── Fixed bottom input ── */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
        {/* Scroll to bottom button */}
        {showScrollButton && (
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
        {/* Gradient fade */}
        <div className="h-8 bg-gradient-to-b from-transparent to-neutral-900 pointer-events-none" />
        {/* Input */}
        <div className="bg-neutral-900 pb-3 px-4 sm:px-6 lg:px-8">
          <div className="w-full max-w-[48rem] mx-auto pointer-events-auto">
            <div className="relative bg-neutral-800 border border-neutral-700/40 rounded-[36px] pl-6 pr-6 pt-4 pb-[70px] shadow-lg shadow-black/20">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={onInputChange}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                placeholder={placeholder}
                className="w-full resize-none min-h-[28px] rounded-none py-1 px-0 !leading-[1.75] !bg-transparent border-0 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-0 focus-visible:ring-0 focus:border-0 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  boxShadow: "none",
                  backgroundColor: "transparent",
                  outline: "none",
                  border: "none",
                  borderRadius: 0,
                  fontSize: "16px",
                }}
              />
              {/* Send / Stop */}
              <div className="absolute right-3 bottom-2.5 flex items-center gap-2">
                {isSending && onStop ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="size-10 rounded-full shrink-0 bg-neutral-700 flex items-center justify-center transition-all duration-150 ease-out outline-none focus:outline-none hover:bg-neutral-600 hover:scale-105"
                    title="Stop"
                  >
                    <Square className="h-4 w-4 fill-white text-white" />
                  </button>
                ) : (
                  <div
                    className="transition-all duration-200 ease-out overflow-hidden"
                    style={{ width: hasContent ? 40 : 0, opacity: hasContent ? 1 : 0 }}
                  >
                    <button
                      type="button"
                      onClick={onSend}
                      disabled={disabled || isSending || !hasContent}
                      className="size-10 rounded-full shrink-0 bg-neutral-700 flex items-center justify-center disabled:cursor-not-allowed transition-colors duration-150 ease-out outline-none focus:outline-none hover:bg-neutral-600"
                      title="Send"
                    >
                      <ArrowUp className="h-5 w-5 stroke-[2.5] text-white" />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <p className="text-center text-xs text-neutral-500 mt-1.5">AI-generated content may be inaccurate</p>
          </div>
        </div>
      </div>
    </div>
  );
}
