// ChatPane.tsx — Stripped for Dashboard. Normal messages only.
// CSS classes match the main Frontend ChatPane exactly.

import React from "react";
import clsx from "clsx";
import ChatBubble, { type ChatMsg } from "@/features/dashboard/chat/ChatBubble";
import type { EvidenceCitation } from "@/features/dashboard/lib/types";

export type { ChatMsg };

interface ChatPaneProps {
  messages: ChatMsg[];
  isSending?: boolean;
  isTyping?: boolean;
  onEdit?: (index: number, newContent: string) => void;
  onAssistantRetry?: () => void;
  onEvidenceNavigate?: (citation: EvidenceCitation) => void;
  padBottom?: boolean;
  disableAutoScroll?: boolean;
  readOnly?: boolean;
}

function getDateKey(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateSeparator(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today.getTime() - msgDay.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 1) return "Today";
  if (diff < 2) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export default function ChatPane({
  messages,
  isSending = false,
  isTyping,
  onEdit: _onEdit,
  onAssistantRetry,
  onEvidenceNavigate,
  padBottom = true,
  disableAutoScroll = false,
  readOnly = false,
}: ChatPaneProps) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const lastAssistantIndex = React.useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant") return index;
    }
    return -1;
  }, [messages]);

  return (
    <div
      ref={listRef}
      className={clsx(
        "flex-1 min-h-0",
        !disableAutoScroll && "overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-600 hover:scrollbar-thumb-neutral-500 scrollbar-track-transparent",
        "px-0",
        padBottom ? "pb-4" : "pb-0",
      )}
      style={{ overscrollBehavior: !disableAutoScroll ? "contain" : undefined }}
    >
      <div className="py-2 space-y-2 pb-24">
        {messages.map((m, i) => {
          const isUser = m.role === "user";

          // Date separator
          const currentDateKey = getDateKey(m.createdAt);
          const prevDateKey = i > 0 ? getDateKey(messages[i - 1].createdAt) : null;
          const showDateSeparator = m.createdAt && (i === 0 || currentDateKey !== prevDateKey);

          // Response time
          let responseTimeMs: number | undefined;
          if (!isUser && m.createdAt && i > 0 && messages[i - 1]?.createdAt) {
            responseTimeMs = m.createdAt - messages[i - 1].createdAt!;
          }

          // Is this the latest assistant message?
          const isLatestAssistant = !isUser && i === messages.length - 1;

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
              <div className="max-w-[48rem] mx-auto">
                <ChatBubble
                  {...m}
                  showUserActions={isUser && !readOnly}
                  hideActions={
                    (isSending || isTyping) &&
                    m.role === "assistant" &&
                    i === lastAssistantIndex
                  }
                  onAssistantRetry={isLatestAssistant ? onAssistantRetry : undefined}
                  onEvidenceNavigate={onEvidenceNavigate}
                  responseTimeMs={responseTimeMs}
                  readOnly={readOnly}
                />
              </div>
            </React.Fragment>
          );
        })}

        {/* Match the teaching-assistant pane: one ball only while awaiting the first chunk. */}
        {isSending && !isTyping && (
          <div className="max-w-[48rem] mx-auto mb-5 flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="p-2">
              <div className="bounce-ball rounded-full bg-white" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
