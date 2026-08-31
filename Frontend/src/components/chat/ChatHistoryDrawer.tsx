import React, { useMemo, useCallback, useRef, useState, useEffect } from "react";
import { X, MessageSquare, Pencil, Share2, Trash2, Link as LinkIcon, Copy, Check } from "lucide-react";
import { useChatStore } from "@/lib/chatStore";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ChatHistoryDrawerProps {
  agentId: string | null;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  isOpen: boolean;
  onClose: () => void;
  onNewChat?: () => void;
}

/** Group threads into time buckets (Today, Yesterday, This Week, This Month, Older). */
function getBucket(d: Date): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  const dow = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - ((dow + 6) % 7));
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  if (!d || isNaN(d.getTime())) return "Older";
  if (d >= todayStart) return "Today";
  if (d >= yesterdayStart) return "Yesterday";
  if (d >= weekStart) return "This Week";
  if (d >= thisMonthStart) return "This Month";
  return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "This Week", "This Month", "Older"];

export function ChatHistoryDrawer({
  agentId,
  activeThreadId,
  onSelectThread,
  isOpen,
  onClose,
  onNewChat,
}: ChatHistoryDrawerProps) {
  const { threads, messagesByThreadId, renameThread, deleteThread, shareThread } = useChatStore(
    useShallow((s) => ({
      threads: s.threads,
      messagesByThreadId: s.messagesByThreadId,
      renameThread: s.renameThread,
      deleteThread: s.deleteThread,
      shareThread: s.shareThread,
    }))
  );

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const deleteConfirmThread = deleteConfirmId ? threads[deleteConfirmId] : null;

  // Share dialog state
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTokenValue, setShareTokenValue] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const handleShareThread = async (threadId: string) => {
    setIsSharing(true);
    setShareDialogOpen(true);
    try {
      const token = await shareThread(threadId);
      if (token) {
        setShareTokenValue(token);
      } else {
        toast.error("Failed to create share link");
        setShareDialogOpen(false);
      }
    } catch {
      toast.error("Failed to create share link");
      setShareDialogOpen(false);
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareTokenValue) return;
    const shareUrl = `${window.location.origin}/shared/${shareTokenValue}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };


  // Get threads for the current agent that have messages, sorted by updatedAt desc
  const agentThreads = useMemo(() => {
    if (!agentId) return [];
    return Object.values(threads)
      .filter(
        (t) =>
          t.agentId === agentId &&
          (messagesByThreadId[t.id]?.length ?? 0) > 0
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [agentId, threads, messagesByThreadId]);

  // Group into buckets
  const groupedThreads = useMemo(() => {
    const groups: Record<string, typeof agentThreads> = {};
    for (const thread of agentThreads) {
      const bucket = getBucket(new Date(thread.updatedAt));
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(thread);
    }
    return BUCKET_ORDER.filter((b) => groups[b]?.length).map((b) => ({
      label: b,
      threads: groups[b],
    }));
  }, [agentThreads]);

  const handleSelect = useCallback(
    (threadId: string) => {
      onSelectThread(threadId);
      onClose(); // close panel after selection
    },
    [onSelectThread, onClose]
  );

  // Format time / date for each thread
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="w-1/2 flex-none border-l border-white/[0.08] bg-neutral-800/80 flex flex-col h-full animate-in slide-in-from-right-5 duration-300">
        {/* Header */}
        <div className="flex items-center gap-3 pl-5 pr-1 py-3 border-b border-white/[0.08]">
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-white truncate">Chat History</p>
          </div>
          <div className="flex-shrink-0 flex items-center pr-1">
            <button
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-white border border-neutral-600 rounded-md bg-neutral-800 hover:bg-neutral-700 transition-colors"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Thread list */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgb(64 64 64) transparent" }}
        >
          {groupedThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-neutral-500">
              <MessageSquare className="w-10 h-10 mb-3 text-neutral-600" />
              <p className="text-sm font-medium">No chat history yet</p>
            </div>
          ) : (
            <div className="px-3 py-3 space-y-4">
              {groupedThreads.map(({ label, threads: bucketThreads }) => (
                <div key={label}>
                  {/* Bucket header */}
                  <div className="flex items-center gap-3 mb-2 px-1">
                    <div className="flex-1 h-px bg-neutral-700/60" />
                    <h3 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider shrink-0">
                      {label}
                    </h3>
                    <div className="flex-1 h-px bg-neutral-700/60" />
                  </div>

                  {/* Threads */}
                  <div className="space-y-0.5">
                    {bucketThreads.map((thread) => {
                      const isActive = thread.id === activeThreadId;
                      const msgs = messagesByThreadId[thread.id] || [];
                      const userMsgs = msgs.filter((m) => m.role === "user");
                      const lastUserMsg = userMsgs[userMsgs.length - 1];
                      const preview = lastUserMsg
                        ? lastUserMsg.content.slice(0, 80) + (lastUserMsg.content.length > 80 ? "\u2026" : "")
                        : "";

                      return (
                        <div
                          key={thread.id}
                          onClick={() => {
                            if (renamingId !== thread.id) handleSelect(thread.id);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 group cursor-pointer ${
                            isActive
                              ? "bg-neutral-700/50 border border-neutral-600/50"
                              : "hover:bg-neutral-800/60 border border-transparent"
                          }`}
                        >
                          {/* Left: title + preview */}
                          <div className="flex-1 min-w-0">
                            {renamingId === thread.id ? (
                              <input
                                ref={renameInputRef}
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    renameThread(thread.id, renameValue.trim() || thread.title || "Untitled Chat");
                                    setRenamingId(null);
                                  } else if (e.key === "Escape") {
                                    setRenamingId(null);
                                  }
                                }}
                                onBlur={() => {
                                  renameThread(thread.id, renameValue.trim() || thread.title || "Untitled Chat");
                                  setRenamingId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full text-sm font-medium bg-neutral-800 text-white rounded px-1.5 py-0.5 outline-none ring-1 ring-neutral-600"
                              />
                            ) : (
                              <span
                                className={`text-sm font-medium truncate block ${
                                  isActive ? "text-white" : "text-neutral-300 group-hover:text-white"
                                }`}
                              >
                                {thread.title || "New Chat"}
                              </span>
                            )}
                            {preview && renamingId !== thread.id && (
                              <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1 group-hover:text-neutral-400">
                                {preview}
                              </p>
                            )}
                          </div>

                          {/* Right: time (default) → action icons (on hover) */}
                          <div className="shrink-0 flex items-center self-center">
                            {/* Time — visible by default, hidden on hover */}
                            <span className="text-[10px] text-neutral-500 group-hover:hidden">
                              {formatTime(thread.updatedAt)}
                            </span>

                            {/* Actions — hidden by default, visible on hover */}
                            <div className="hidden group-hover:flex items-center gap-1">
                              <button
                                title="Rename"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingId(thread.id);
                                  setRenameValue(thread.title || "");
                                  setTimeout(() => renameInputRef.current?.focus(), 0);
                                }}
                                className="p-1.5 rounded border border-neutral-600 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                title="Share"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleShareThread(thread.id);
                                }}
                                className="p-1.5 rounded border border-neutral-600 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors"
                              >
                                <Share2 size={13} />
                              </button>
                              <button
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirmId(thread.id);
                                }}
                                className="p-1.5 rounded border border-neutral-600 hover:bg-neutral-700 text-neutral-400 hover:text-red-400 transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Share Chat Dialog */}
      <Dialog open={shareDialogOpen} onOpenChange={(open) => {
        setShareDialogOpen(open);
        if (!open) {
          setShareTokenValue(null);
          setShareCopied(false);
        }
      }}>
        <DialogContent className="bg-neutral-900 border-neutral-800 sm:max-w-md overflow-hidden [&>*]:min-w-0 gap-3 pb-5">
          <DialogHeader>
            <DialogTitle className="text-neutral-100 flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Share
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              Anyone with this link can view this chat (read-only).
            </DialogDescription>
          </DialogHeader>
          <div className="w-full overflow-hidden">
            {isSharing ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
            ) : shareTokenValue ? (
              <div className="space-y-2.5 w-full overflow-hidden">
                <div className="p-3 bg-neutral-800 rounded-lg w-full overflow-hidden" style={{ maxWidth: '100%' }}>
                  <div className="flex items-center gap-2 overflow-hidden">
                    <LinkIcon className="h-4 w-4 text-neutral-400 flex-shrink-0" />
                    <span className="text-sm text-neutral-300 block overflow-hidden text-ellipsis whitespace-nowrap" style={{ maxWidth: 'calc(100% - 24px)' }}>
                      {window.location.origin}/shared/{shareTokenValue}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleCopyShareLink}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-neutral-200 text-black hover:bg-neutral-300 transition-colors"
                >
                  {shareCopied ? (
                    <>
                      <Check className="h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy Link
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="text-center py-4 text-neutral-400">
                Failed to create share link
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Chat Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="bg-neutral-900 border-neutral-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">
              Delete "{deleteConfirmThread?.title || "New Chat"}"?
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              This will permanently delete this chat and all its messages. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              onClick={() => {
                if (deleteConfirmId) {
                  deleteThread(deleteConfirmId);
                  toast.success("Chat deleted");
                  setDeleteConfirmId(null);
                }
              }}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
