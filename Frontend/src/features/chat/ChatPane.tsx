import React from "react";
import clsx from "clsx";
import { Bot, PencilLine, Copy, Check, ThumbsUp, ThumbsDown, MoreHorizontal } from "lucide-react";
import ChatBubble, { type ChatMsg } from "@/features/chat/ChatBubble";
import { ResearchMessageCard } from "@/components/chat/ResearchMessageCard";
import { ResearchMCQ, parseMCQQuestions } from "@/components/chat/ResearchMCQ";
import Markdown from "@/components/common/Markdown";
import { useChatStore } from "@/lib/chatStore";

export type { ChatMsg };

// Helper to format date for date separators
function formatDateSeparator(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check if same day
  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  // Calculate days difference
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysDiff = Math.floor((todayStart.getTime() - dateStart.getTime()) / (1000 * 60 * 60 * 24));

  if (isSameDay(date, today)) {
    return 'Today';
  } else if (isSameDay(date, yesterday)) {
    return 'Yesterday';
  } else if (daysDiff > 0 && daysDiff < 7) {
    // Within the past week - show day name only (Monday, Tuesday, etc.)
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  } else {
    // More than a week ago - show just month and day (e.g., "January 23")
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  }
}

// Get date key from timestamp for grouping
// If no timestamp, treat as "today" to prevent separator jumping during message creation
function getDateKey(timestamp?: number): string {
  const ts = timestamp || Date.now();
  const date = new Date(ts);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

type ChatPaneProps = {
  messages: ChatMsg[];
  agentId?: string;
  threadId?: string | null;
  padBottom?: boolean;
  showUserActions?: boolean;
  onUserMessageEdit?: (index: number, newContent: string) => void;
  onGeneratedDocClick?: (docId: string) => void;
  onQuizOpen?: (quiz: { quizId: string; title: string; questions: unknown[]; assessmentType?: string; thresholdConcept?: string }) => void;
  onChallengeOpen?: (challenge: { challengeId: string; title: string; description: string; difficulty: string; hints?: string[]; solution: string; challengeType?: string }) => void;
  onDocumentDownload?: (docId: string, title: string) => void;
  // Retry only for latest assistant message
  onAssistantRetry?: (msg: ChatMsg, index: number) => void;
  // Loading state (waiting for API)
  isSending?: boolean;
  // Typing state (simulated typing effect in progress)
  isTyping?: boolean;
  statusLabel?: string | null;

  // Optional agent header (for preview pane)
  agentName?: string;
  agentDescription?: string;
  className?: string;
  
  // Research callbacks
  onResearchStop?: (researchId: string) => void;
  onResearchPanelOpen?: (researchId: string, tab?: "activity" | "sources") => void;
  isResearchPanelOpen?: boolean;
  selectedResearchId?: string;
  
  // When true, disables internal auto-scroll (parent manages scrolling)
  disableAutoScroll?: boolean;

  // Read-only mode (shared chat) — disables interactive features like quiz feedback
  readOnly?: boolean;
};

export default function ChatPane({
  messages,
  agentId,
  threadId,
  padBottom = false,
  onResearchStop,
  onResearchPanelOpen,
  isResearchPanelOpen = false,
  selectedResearchId,
  showUserActions = false,
  onUserMessageEdit,
  onGeneratedDocClick,
  onQuizOpen,
  onChallengeOpen,
  onDocumentDownload,
  onAssistantRetry,
  isSending = false,
  isTyping = false,
  statusLabel = null,
  agentName,
  agentDescription,
  className,
  readOnly,
  disableAutoScroll = false,
}: ChatPaneProps) {
  const listRef = React.useRef<HTMLDivElement>(null);

  // --- inline edit state ----------------------------------------------------
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editDraft, setEditDraft] = React.useState("");
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

  // Resolve name placeholders back to real names for copy/display.
  // Strip backtick wrapping so names don't render in code font.
  const _userFullName = useChatStore((s) => s.userFullName || s.userName);
  const _preferredName = useChatStore((s) => s.userNickname || s.userName);
  const resolveContent = (text: string | undefined) => {
    if (!text) return "";
    return text
      .replaceAll("`{{preferred_name}}`", _preferredName)
      .replaceAll("{{preferred_name}}", _preferredName)
      .replaceAll("`{{user_name}}`", _userFullName)
      .replaceAll("{{user_name}}", _userFullName);
  };

  const isEditing = (index: number) =>
    editingIndex !== null && editingIndex === index;

  const startEdit = (index: number, initial: string) => {
    if (!onUserMessageEdit) return; // no-op if editing not wired
    setEditingIndex(index);
    setEditDraft(initial);

    // make sure edited message is in view
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditDraft("");
  };

  const commitEdit = () => {
    if (
      editingIndex === null ||
      !onUserMessageEdit ||
      editDraft.trim().length === 0
    ) {
      // if empty, just cancel
      cancelEdit();
      return;
    }
    onUserMessageEdit(editingIndex, editDraft.trim());
    cancelEdit();
  };

  // If messages change such that the edited one disappears / changes role,
  // auto-cancel edit mode.
  React.useEffect(() => {
    if (editingIndex === null) return;
    if (
      editingIndex >= messages.length ||
      messages[editingIndex].role !== "user"
    ) {
      cancelEdit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // --- auto-scroll on new messages -----------------------------------------
  // Skip if parent manages scrolling (disableAutoScroll=true)
  React.useEffect(() => {
    if (disableAutoScroll) return;
    
    const el = listRef.current;
    if (!el) return;

    const scrollToBottom = () => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: "smooth",
      });
    };

    const timeoutId = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timeoutId);
  }, [messages, disableAutoScroll]);

  // latest assistant index
  const lastAssistantIndex = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  // latest user index (for showing edit button only on last user message)
  const lastUserIndex = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return -1;
  }, [messages]);

  // --- render ---------------------------------------------------------------
  return (
    <div
      ref={listRef}
      className={clsx(
        "flex-1 min-h-0",
        // Only add overflow and scrollbar styles when ChatPane manages its own scrolling
        !disableAutoScroll && "overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-600 hover:scrollbar-thumb-neutral-500 scrollbar-track-transparent",
        "px-0", // zero horizontal padding - flush with edges
        padBottom ? "pb-4" : "pb-0",
        className
      )}
      style={{
        overscrollBehavior: disableAutoScroll ? undefined : "contain",
      }}
    >
      {messages.length === 0 ? (
        agentName ? (
          // --- Agent header empty state (used in Live Preview) ---
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-xl px-6 space-y-4 animate-in fade-in duration-500">
              <div className="w-16 h-16 rounded-full bg-black/40 border border-white/15 flex items-center justify-center mx-auto shadow-lg">
                <Bot className="h-8 w-8 text-neutral-200" />
              </div>
              <div className="space-y-1">
                <div className="text-lg font-semibold text-white">
                  {agentName}
                </div>
                <p className="text-sm text-neutral-400">
                  {agentDescription ||
                    "Start a conversation to see how this agent responds."}
                </p>
              </div>
            </div>
          </div>
        ) : (
          // --- Fallback empty state (builder side, if no agentName passed) ---
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3 max-w-sm px-6 animate-in fade-in duration-500">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-neutral-800 to-neutral-900 border border-neutral-700/50 flex items-center justify-center mx-auto shadow-lg">
                <Bot className="h-8 w-8 text-neutral-400" />
              </div>
              <div>
                <div className="text-base font-medium text-neutral-300 mb-1">
                  No messages yet
                </div>
                <p className="text-sm text-neutral-500">
                  Start a conversation to see messages appear here
                </p>
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="py-2 space-y-2 pb-24">
          {messages.map((m, i) => {
            const msgIsEditing = isEditing(i) && m.role === "user";
            
            // Check if we need to show a date separator before this message
            // Only show separator if this message has a timestamp
            const currentDateKey = getDateKey(m.createdAt);
            const prevDateKey = i > 0 ? getDateKey(messages[i - 1].createdAt) : null;
            // Show separator at first message with timestamp, or when date changes
            // Don't show separator for messages without timestamps (being created)
            const showDateSeparator = m.createdAt && (i === 0 || currentDateKey !== prevDateKey);
            
            // Hide the assistant message (clarifying questions) right before a research message
            // This keeps the UI clean once research starts
            const nextMessage = messages[i + 1];
            const isPreResearchClarification = 
              m.role === "assistant" && 
              nextMessage?.isResearch && 
              nextMessage?.research?.status !== undefined;
            
            if (isPreResearchClarification) {
              // Don't render clarifying questions once research has started
              return null;
            }

            if (msgIsEditing) {
              // --- Inline edit with clean styling -----------
              return (
                <React.Fragment key={i}>
                  {showDateSeparator && m.createdAt && (
                    <div className="flex items-center justify-center w-full max-w-[48rem] mx-auto pt-6 pb-10">
                      <div className="flex-grow h-px bg-neutral-700/50" />
                      <span className="px-4 text-xs text-neutral-500 font-medium whitespace-nowrap">
                        {formatDateSeparator(m.createdAt)}
                      </span>
                      <div className="flex-grow h-px bg-neutral-700/50" />
                    </div>
                  )}
                  {/* Edit mode - constrained width and centered */}
                  <div className="max-w-[48rem] mx-auto">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] w-full space-y-3 p-4 rounded-2xl bg-neutral-700 border border-neutral-600/50">
                    <textarea
                      ref={(el) => {
                        if (el) {
                          // Auto-grow logic
                          el.style.height = 'auto';
                          const newHeight = Math.min(el.scrollHeight, 180);
                          el.style.height = `${newHeight}px`;
                          el.style.overflowY = el.scrollHeight > 180 ? 'auto' : 'hidden';
                        }
                      }}
                      className="w-full border-0 text-sm text-white placeholder:text-neutral-400 resize-none focus:outline-none focus:ring-0 focus:border-0 px-0 py-2 min-h-[24px]"
                      style={{ 
                        color: '#ffffff', 
                        caretColor: '#ffffff', 
                        WebkitTextFillColor: '#ffffff', 
                        outline: 'none', 
                        boxShadow: 'none', 
                        backgroundColor: 'transparent',
                        transition: 'height 150ms ease-out'
                      }}
                      value={editDraft}
                      autoFocus
                      onChange={(e) => {
                        setEditDraft(e.target.value);
                        // Trigger re-render to update height
                        const el = e.target;
                        el.style.height = 'auto';
                        const newHeight = Math.min(el.scrollHeight, 180);
                        el.style.height = `${newHeight}px`;
                        el.style.overflowY = el.scrollHeight > 180 ? 'auto' : 'hidden';
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          commitEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                    />

                    {/* Buttons at bottom right */}
                    <div className="flex justify-end gap-2 text-sm">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-neutral-100 border border-white/10 hover:border-white/20 transition-all duration-200 font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={commitEdit}
                        disabled={!editDraft.trim() || (editingIndex !== null && editDraft.trim() === messages[editingIndex]?.content?.trim())}
                        className={clsx(
                          "px-4 py-2 rounded-lg transition-all duration-200 font-medium",
                          editDraft.trim() && !(editingIndex !== null && editDraft.trim() === messages[editingIndex]?.content?.trim())
                            ? "bg-white hover:bg-neutral-100 text-neutral-900 border border-white/80 shadow-lg shadow-white/10"
                            : "bg-neutral-600 text-neutral-400 cursor-not-allowed opacity-50"
                        )}
                      >
                        Send
                      </button>
                    </div>
                    </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            }

            // --- Normal bubble + optional "Edit" action -------------------
            // Check if this is a research message with full research data (live session)
            if (m.isResearch && m.research) {
              return (
                <React.Fragment key={i}>
                  {showDateSeparator && m.createdAt && (
                    <div className="flex items-center justify-center w-full max-w-[48rem] mx-auto pt-6 pb-10">
                      <div className="flex-grow h-px bg-neutral-700/50" />
                      <span className="px-4 text-xs text-neutral-500 font-medium whitespace-nowrap">
                        {formatDateSeparator(m.createdAt)}
                      </span>
                      <div className="flex-grow h-px bg-neutral-700/50" />
                    </div>
                  )}
                  {/* Research progress card - hide during clarification (MCQ shown instead) */}
                  {m.research.status !== "clarification" && (
                  <div className="flex justify-start mb-3">
                    <div className="w-full">
                      <ResearchMessageCard
                        research={m.research}
                        onStop={onResearchStop ? () => onResearchStop(m.research!.id) : undefined}
                        onOpenPanel={onResearchPanelOpen ? (tab) => onResearchPanelOpen(m.research!.id, tab) : undefined}
                        isPanelOpen={isResearchPanelOpen && selectedResearchId === m.research.id}
                      />
                    </div>
                  </div>
                  )}
                  {/* MCQ clarification — show interactive questions when status is clarification */}
                  {m.research.status === "clarification" && m.research.clarificationText && (
                    <div className="w-full max-w-[54rem] mx-auto">
                      <ResearchMCQ
                        questions={parseMCQQuestions(m.research.clarificationText)}
                        onSubmit={(answers) => {
                          // Build answer text: separate additional details from question answers
                          const additional = answers[0]; // key 0 = additional details
                          const questionAnswers = Object.entries(answers)
                            .filter(([num]) => Number(num) > 0)
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([num, ans]) => {
                              if (ans.customText) return `${num}. ${ans.text}`;
                              return `${num}. ${ans.text}`;
                            })
                            .join("\n");
                          
                          let answersText = `My answers:\n${questionAnswers}`;
                          if (additional?.text) {
                            answersText += `\n\nAdditional details: ${additional.text}`;
                          }
                          
                          window.dispatchEvent(new CustomEvent("research-mcq-submit", {
                            detail: {
                              threadId: m.research!.deepResearchThreadId,
                              answersText,
                              researchId: m.research!.id,
                            },
                          }));
                        }}
                      />
                    </div>
                  )}
                  {/* Only show the FINAL result when research is complete - NOT thinking tokens */}
                  {m.research.status === "completed" && m.research.result && (
                    <div className="mt-4 w-full max-w-[54rem] mx-auto">
                      {/* Sources strip outside the box */}
                      {m.research.sources && m.research.sources.length > 0 && (
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex items-center bg-neutral-800 rounded-full px-3 py-1.5 gap-1">
                            {m.research.sources.slice(0, 5).map((source, idx) => (
                              <a
                                key={idx}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center size-6 rounded-full bg-white overflow-hidden hover:scale-110 transition-transform"
                                title={source.title || source.domain}
                              >
                                <img
                                  src={source.favicon || `https://www.google.com/s2/favicons?domain=${source.domain}&sz=32`}
                                  alt=""
                                  className="size-4 object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              </a>
                            ))}
                            <button
                              onClick={() => onResearchPanelOpen?.(m.research!.id, "sources")}
                              className="text-sm text-neutral-400 hover:text-neutral-200 ml-1 transition-colors"
                            >
                              Sources
                            </button>
                          </div>
                        </div>
                      )}
                      {/* Research completed heading with sources, time */}
                      <div className="flex items-center gap-2 mb-3">
                        {m.research.sources && m.research.sources.length > 0 && (
                          <button
                            onClick={() => onResearchPanelOpen?.(m.research!.id, "sources")}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700/60 text-sm text-blue-400 hover:text-blue-300 hover:bg-neutral-700/80 hover:border-neutral-600 transition-all"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            {m.research.sources.length} source{m.research.sources.length !== 1 ? 's' : ''}
                          </button>
                        )}
                        <span className="text-base font-medium text-neutral-500">Research completed</span>
                        <span className="text-xs text-neutral-500">·</span>
                        <span className="text-base font-medium italic text-neutral-500">
                          {(() => {
                            const endTime = m.research.endTime || Date.now();
                            const seconds = Math.floor((endTime - m.research.startTime) / 1000);
                            if (seconds < 60) return `${seconds}s`;
                            const minutes = Math.floor(seconds / 60);
                            const remainingSeconds = seconds % 60;
                            return `${minutes}m ${remainingSeconds}s`;
                          })()}
                        </span>
                      </div>
                      {/* Research result box with border - full width */}
                      <div className="rounded-3xl border border-neutral-700/40 bg-neutral-800/50 px-6 pt-2 pb-4 shadow-lg shadow-black/25">
                        <div className="max-w-[48rem] mx-auto text-[15px] leading-relaxed text-neutral-200">
                          <Markdown sources={m.research.sources}>{m.research.result.replace(/^(?:#+ ?)?Final Report:?[\s\n]*/i, '').replace(/^\n+/, '').trim()}</Markdown>
                        </div>
                      </div>
                      {/* Action buttons OUTSIDE the box */}
                      <div className="flex items-center gap-1 mt-4">
                        <button
                          type="button"
                          className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                          title="Copy"
                          onClick={() => navigator.clipboard.writeText(m.research?.result || "")}
                        >
                          <Copy className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                        </button>
                        <button
                          type="button"
                          className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                          title="Good response"
                        >
                          <ThumbsUp className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                        </button>
                        <button
                          type="button"
                          className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                          title="Bad response"
                        >
                          <ThumbsDown className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                        </button>
                        <button
                          type="button"
                          className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                          title="More options"
                        >
                          <MoreHorizontal className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                        </button>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            }
            
            // Research message loaded from DB (has isResearch flag but no full research object)
            // Show in research-style box without the progress card
            if (m.isResearch && !m.research && m.content) {
              // Remove "Final Report:" prefix from content if present (to avoid duplication)
              const cleanContent = m.content.replace(/^(?:#+ ?)?Final Report:?[\s\n]*/i, '').trim();
              
              // Calculate duration if we have timing data
              const duration = (() => {
                if (m.researchStartTime && m.researchEndTime) {
                  const seconds = Math.floor((m.researchEndTime - m.researchStartTime) / 1000);
                  if (seconds < 60) return `${seconds}s`;
                  const minutes = Math.floor(seconds / 60);
                  const remainingSeconds = seconds % 60;
                  return `${minutes}m ${remainingSeconds}s`;
                }
                return null;
              })();
              
              return (
                <React.Fragment key={i}>
                  {showDateSeparator && m.createdAt && (
                    <div className="flex items-center justify-center w-full max-w-[48rem] mx-auto pt-6 pb-10">
                      <div className="flex-grow h-px bg-neutral-700/50" />
                      <span className="px-4 text-xs text-neutral-500 font-medium whitespace-nowrap">
                        {formatDateSeparator(m.createdAt)}
                      </span>
                      <div className="flex-grow h-px bg-neutral-700/50" />
                    </div>
                  )}
                  <div className="mt-4 w-full max-w-[54rem] mx-auto">
                    {/* Research completed heading with sources and time */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-base font-medium text-neutral-500">Research completed</span>
                      {duration && (
                        <>
                          <span className="text-xs text-neutral-500">·</span>
                          <span className="text-base font-medium italic text-neutral-500">{duration}</span>
                        </>
                      )}
                    </div>
                    {/* Research result box with border - full width */}
                    <div className="rounded-3xl border border-neutral-700/40 bg-neutral-800/50 px-6 pt-2 pb-4 shadow-lg shadow-black/25">
                      <div className="max-w-[48rem] mx-auto text-[15px] leading-relaxed text-neutral-200">
                        <Markdown>{(cleanContent || m.content).replace(/^\n+/, '').trim()}</Markdown>
                      </div>
                    </div>
                    {/* Action buttons OUTSIDE the box */}
                    <div className="flex items-center gap-1 mt-4">
                      <button
                        type="button"
                        className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                        title="Copy"
                        onClick={() => navigator.clipboard.writeText(resolveContent(m.content))}
                      >
                        <Copy className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                      </button>
                      <button
                        type="button"
                        className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                        title="Good response"
                      >
                        <ThumbsUp className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                      </button>
                      <button
                        type="button"
                        className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                        title="Bad response"
                      >
                        <ThumbsDown className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                      </button>
                      <button
                        type="button"
                        className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                        title="More options"
                      >
                        <MoreHorizontal className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                      </button>
                    </div>
                  </div>
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={i}>
                {showDateSeparator && m.createdAt && (
                  <div className="flex items-center justify-center w-full max-w-[48rem] mx-auto pt-6 pb-10">
                    <div className="flex-grow h-px bg-neutral-700/50" />
                    <span className="px-4 text-xs text-neutral-400 font-medium whitespace-nowrap">
                      {formatDateSeparator(m.createdAt)}
                    </span>
                    <div className="flex-grow h-px bg-neutral-700/50" />
                  </div>
                )}
                {/* Internal Chatpane - normal chat messages constrained width and centered */}
                <div
                  className="group max-w-[48rem] mx-auto"
                  data-chat-user-index={m.role === "user" ? i : undefined}
                >
                  <ChatBubble
                    role={m.role}
                    content={m.content}
                    agentId={agentId}
                    threadId={threadId}
                    createdAt={m.createdAt}
                    generatedDocId={m.generatedDocId}
                    generatedDocTitle={m.generatedDocTitle}
                    docBlockContent={m.docBlockContent}
                    contentBlocks={m.contentBlocks}
                    imageUrls={m.imageUrls}
                    sources={m.sources}
                    readOnly={readOnly}
                    isLatestMessage={i === messages.length - 1}
                    // We disable ChatBubble's internal edit UI; this pane owns editing UX.
                    showUserActions={false}
                    // Hide actions on last assistant message while sending/streaming (includes waiting for response)
                    hideActions={(isSending || isTyping) && m.role === "assistant" && i === lastAssistantIndex}
                    onGeneratedDocClick={onGeneratedDocClick}
                  onQuizOpen={onQuizOpen}
                  onChallengeOpen={onChallengeOpen}
                    onDocumentDownload={onDocumentDownload}
                    onAssistantRetry={
                      onAssistantRetry &&
                      m.role === "assistant" &&
                      i === lastAssistantIndex
                        ? () => onAssistantRetry(m, i)
                        : undefined
                    }
                    // Calculate response time for assistant messages (assistant.createdAt - previous user.createdAt)
                    responseTimeMs={
                      m.role === "assistant" && m.createdAt && i > 0 && messages[i - 1]?.role === "user" && messages[i - 1]?.createdAt
                        ? m.createdAt - (messages[i - 1].createdAt as number)
                        : undefined
                    }
                  />

                {showUserActions &&
                  m.role === "user" &&
                  editingIndex === null && (
                    <div className="flex justify-end gap-1 -mt-3 mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      {/* Copy button - shown for all user messages */}
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(resolveContent(m.content));
                          setCopiedIndex(i);
                          setTimeout(() => setCopiedIndex(null), 2000);
                        }}
                        className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                        title={copiedIndex === i ? "Copied!" : "Copy message"}
                      >
                        {copiedIndex === i ? (
                          <Check className="h-4 w-4 text-white" />
                        ) : (
                          <Copy className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                        )}
                      </button>

                      {/* Edit button - only shown for the last user message without images, and not if followed by research */}
                      {!!onUserMessageEdit && i === lastUserIndex && !m.imageUrls?.length && !messages[i + 1]?.isResearch && (
                        <button
                          type="button"
                          onClick={() =>
                            startEdit(i, m.content ? m.content : "")
                          }
                          className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                          title="Edit message"
                        >
                          <PencilLine className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })}
          
          {/* Typing indicator when waiting for response (not during streaming) */}
          {isSending && !isTyping && (
            <div className="mb-5 flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200 max-w-[48rem] mx-auto">
              {statusLabel ? (
                <div className="flex items-center gap-2.5 p-2">
                  <span className="h-3 w-3 shrink-0 rounded-full bg-white/70 [animation:pulse_1.4s_ease-in-out_infinite]" />
                  <span className="animate-pulse text-[15px] text-neutral-400">{statusLabel}…</span>
                </div>
              ) : (
                <div className="p-2">
                  <div className="bounce-ball rounded-full bg-white" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
