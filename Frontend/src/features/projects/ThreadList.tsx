import * as React from "react";
import { Button } from "@/components/ui/button";
import { MessageSquare, Trash2 } from "lucide-react";
import { useChatStore } from "@/lib/chatStore";
import { useShallow } from "zustand/react/shallow";
import type { ChatThread } from "@/lib/types";

const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");

export function ThreadList({ onOpen }: { onOpen: () => void }) {
  const { activeContext, threadsMap, setActiveThread, deleteThread } = useChatStore(
    useShallow((s) => ({
      activeContext: s.activeContext,
      threadsMap: s.threads,
      setActiveThread: s.setActiveThread,
      deleteThread: s.deleteThread,
    }))
  );

  // derive threads OUTSIDE zustand selector (safe)
  const threads: ChatThread[] = React.useMemo(() => {
    const c = activeContext;
    return Object.values(threadsMap)
      .filter((t) => {
        const x = t.context;
        return (
          x.projectId === c.projectId &&
          x.mode === c.mode &&
          x.courseSlug === c.courseSlug &&
          x.agentName === c.agentName
        );
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [threadsMap, activeContext]);

  return (
    <div className="space-y-2">
      {threads.length === 0 ? (
        <div className="text-sm text-neutral-400">No chats yet in this path.</div>
      ) : (
        threads.map((t) => (
          <div
            key={t.id}
            className="group flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2"
          >
            <button
              className="flex flex-1 items-center gap-2 text-left"
              onClick={() => {
                setActiveThread(t.id);
                onOpen();
              }}
            >
              <MessageSquare className="h-4 w-4 text-neutral-300" />
              <div className="min-w-0">
                <div className="truncate text-sm text-neutral-100">{t.title}</div>
                <div className="truncate text-xs text-neutral-500">
                  {t.context.mode}/{t.context.courseSlug}/{t.context.agentName}
                </div>
              </div>
            </button>

            <Button
              size="icon"
              variant="ghost"
              className={cx(
                "h-8 w-8 rounded-lg text-neutral-400 opacity-0 transition-opacity",
                "group-hover:opacity-100 hover:bg-neutral-800 hover:text-neutral-100"
              )}
              onClick={() => deleteThread(t.id)}
              aria-label="Delete chat"
              title="Delete chat"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
