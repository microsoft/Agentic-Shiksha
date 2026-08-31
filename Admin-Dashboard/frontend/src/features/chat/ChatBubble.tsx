// ChatBubble.tsx — Stripped version for Dashboard.
// Normal messages only. No quiz/flashcard/challenge/document/chemistry content blocks.
// All CSS classes match the main Frontend ChatBubble exactly.

import React from "react";
import clsx from "clsx";
import {
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import Markdown from "@/components/common/Markdown";
import type { ChatMsg as BaseChatMsg } from "@/lib/types";

export type ChatMsg = BaseChatMsg & {
  createdAt?: number;
};

type ChatBubbleProps = ChatMsg & {
  showUserActions?: boolean;
  hideActions?: boolean;
  showTimestamp?: boolean;
  onEdit?: (newContent: string) => void;
  onAssistantRetry?: () => void;
  isResearchResult?: boolean;
  sources?: Array<{ title: string; url?: string; domain?: string; favicon?: string; filename?: string; file_id?: string }>;
  responseTimeMs?: number;
  readOnly?: boolean;
};

function formatResponseTime(ms?: number): string {
  if (!ms || ms <= 0) return "";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function ChatBubble({
  role,
  content: rawContent,
  showUserActions,
  hideActions = false,
  onEdit,
  onAssistantRetry,
  isResearchResult = false,
  sources,
  responseTimeMs,
  readOnly: _readOnly,
}: ChatBubbleProps) {
  const isUser = role === "user";
  const content = rawContent;

  const [copied, setCopied] = React.useState(false);

  return (
    <div
      className={clsx(
        "mb-5 flex animate-in fade-in slide-in-from-bottom-2 duration-300",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={clsx(
          "flex flex-col items-stretch gap-1.5 group",
          isUser ? "items-end" : "w-full items-start"
        )}
      >
        {/* Message */}
        <div
          className={clsx(
            "max-w-full",
            isUser ? "flex justify-end" : "flex justify-start w-full"
          )}
        >
          <div
            className={clsx(
              "max-w-full",
              isUser
                ? "rounded-2xl rounded-br-sm px-4 py-3 bg-neutral-800 text-neutral-100 shadow-md shadow-black/20 whitespace-pre-wrap break-words"
                : "text-[15px] leading-relaxed text-neutral-200 w-full"
            )}
          >
            {isUser ? (
              <div className="text-[15px] leading-relaxed">{content}</div>
            ) : (
              <Markdown sources={sources}>{content}</Markdown>
            )}
          </div>
        </div>

        {/* Assistant actions */}
        {!isUser && !hideActions && (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
              title={copied ? "Copied!" : "Copy message"}
              onClick={() => {
                navigator.clipboard.writeText(content || "");
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? (
                <Check className="h-4 w-4 text-white" />
              ) : (
                <Copy className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
              )}
            </button>
            <button type="button" className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200" title="Good response">
              <ThumbsUp className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
            </button>
            <button type="button" className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200" title="Bad response">
              <ThumbsDown className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
            </button>
            {onAssistantRetry && !isResearchResult && (
              <button type="button" onClick={onAssistantRetry} className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200" title="Retry generation">
                <RotateCcw className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
              </button>
            )}
            <button type="button" className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200" title="More options">
              <MoreHorizontal className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
            </button>
            <span className="ml-2 text-[11px] text-neutral-400 min-w-[28px]" title={responseTimeMs ? "Response time" : ""}>
              {responseTimeMs ? formatResponseTime(responseTimeMs) : ""}
            </span>
          </div>
        )}

        {/* User actions (copy on hover) */}
        {isUser && showUserActions && (
          <div className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(content || "");
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="hover:opacity-70 transition-opacity duration-200"
              title={copied ? "Copied!" : "Copy message"}
            >
              {copied ? <Check className="h-4 w-4 text-white" /> : <Copy className="h-4 w-4 text-neutral-400" />}
            </button>
            {onEdit && (
              <button type="button" className="hover:opacity-70 transition-opacity duration-200" title="Edit this message">
                <Pencil className="h-4 w-4 text-neutral-400" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatBubble;
