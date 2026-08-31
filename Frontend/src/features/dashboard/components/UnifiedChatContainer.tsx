// UnifiedChatContainer.tsx — Dashboard version.
// Same layout as the main Frontend's UnifiedChatContainer but without
// chatStore, file uploads, web search, or deep research.

import React, { useRef, useEffect, useState, useCallback } from "react";
import { ChevronDown, ArrowUp, Mic, Square } from "lucide-react";
import ChatPane from "@/features/dashboard/chat/ChatPane";
import type { ChatMsg } from "@/features/dashboard/chat/ChatBubble";
import type { EvidenceCitation } from "@/features/dashboard/lib/types";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

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
  composerContext?: React.ReactNode;
  composerLeadingAction?: React.ReactNode;
  // Retry
  onAssistantRetry?: () => void;
  onEvidenceNavigate?: (citation: EvidenceCitation) => void;
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
  emptyStateTitle,
  emptyStateDescription,
  suggestions,
  onSuggestionClick,
  composerContext,
  composerLeadingAction,
  onAssistantRetry,
  onEvidenceNavigate,
}: UnifiedChatContainerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const baseTextRef = useRef(input);
  const inInterimRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    if (!inInterimRef.current) baseTextRef.current = input;
  }, [input]);

  const speech = useSpeechRecognition({
    language: "en-US",
    onInterim: (text) => {
      if (!text) return;
      inInterimRef.current = true;
      const next = baseTextRef.current ? `${baseTextRef.current} ${text}` : text;
      onInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
    },
    onFinal: (text) => {
      inInterimRef.current = false;
      if (!text) return;
      const next = baseTextRef.current ? `${baseTextRef.current} ${text}` : text;
      baseTextRef.current = next;
      onInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
    },
  });
  const isListening = speech.state === "starting" || speech.state === "listening";
  const listeningStatus = speech.state === "starting" ? "Loading..." : "Listening...";
  const showListeningHint = isListening && input && !inInterimRef.current;

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
                {emptyStateTitle && (
                  <h3 className="text-lg font-semibold text-neutral-200 mb-1">
                    {emptyStateTitle}
                  </h3>
                )}
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
                isSending={isSending}
                isTyping={isTyping}
                onAssistantRetry={onAssistantRetry}
                onEvidenceNavigate={onEvidenceNavigate}
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
            <div className="relative rounded-[36px] border border-neutral-700/40 bg-neutral-800 shadow-lg shadow-black/20">
              {composerContext && (
                <div className="border-b border-neutral-700/50 px-4 py-2">
                  {composerContext}
                </div>
              )}
              <div className="px-5 pb-[54px] pt-2.5">
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={onInputChange}
                    onKeyDown={handleKeyDown}
                    onScroll={() => {
                      if (overlayRef.current && textareaRef.current) {
                        overlayRef.current.scrollTop = textareaRef.current.scrollTop;
                      }
                    }}
                    disabled={disabled}
                    readOnly={isListening}
                    placeholder={isListening ? listeningStatus : placeholder}
                    className="w-full resize-none min-h-[28px] rounded-none py-1 px-0 !leading-[1.75] !bg-transparent border-0 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-0 focus-visible:ring-0 focus:border-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      fieldSizing: "content",
                      maxHeight: "112px",
                      overflowY: "auto",
                      boxShadow: "none",
                      backgroundColor: "transparent",
                      outline: "none",
                      border: "none",
                      borderRadius: 0,
                      fontSize: "16px",
                      ...(showListeningHint
                        ? { color: "transparent", WebkitTextFillColor: "transparent", userSelect: "none" }
                        : {}),
                    }}
                  />
                  {showListeningHint && (
                    <div
                      ref={overlayRef}
                      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-0 py-1 leading-[1.75]"
                      style={{ fontSize: "16px" }}
                      aria-hidden
                    >
                      <span className="text-neutral-100">{input}</span>
                      <span className="text-neutral-500"> {listeningStatus}</span>
                    </div>
                  )}
                </div>
              </div>
              {composerLeadingAction && (
                <div className="absolute bottom-2 left-3 flex items-center">
                  {composerLeadingAction}
                </div>
              )}
              {/* Send / Stop */}
              <div className="absolute bottom-2 right-3 flex items-center gap-2">
                {!(isSending && onStop) && (
                  <button
                    type="button"
                    onClick={() => !disabled && speech.toggle()}
                    disabled={disabled}
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full outline-none transition-all duration-200 focus:outline-none ${
                      disabled
                        ? "cursor-not-allowed bg-transparent text-neutral-600"
                        : isListening
                          ? "bg-neutral-200 text-neutral-900"
                          : "bg-transparent text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
                    }`}
                    aria-label={isListening ? "Stop recording" : "Start recording"}
                    title={isListening ? "Stop recording" : "Voice input"}
                  >
                    {isListening ? (
                      <div className="flex h-5 items-center justify-center gap-1">
                        {(speech.state === "starting" ? [0, 0, 0] : speech.bands).map((band, index) => (
                          <span
                            key={index}
                            className="w-[5px] rounded-full bg-neutral-900 transition-[height] duration-100"
                            style={{
                              height: speech.state === "starting" ? 8 : Math.round(8 + band * 7),
                              ...(speech.state === "starting"
                                ? {
                                    animation: "dot-wave 1.2s ease-in-out infinite",
                                    animationDelay: `${index * 0.2}s`,
                                  }
                                : {}),
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <Mic className="h-5 w-5 stroke-[2]" />
                    )}
                  </button>
                )}
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
