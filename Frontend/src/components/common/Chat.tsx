import React, { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMsg } from "@/lib/types";

export function ChatBubble({ role, content }: ChatMsg) {
  const isUser = role === "user";
  return (
    <div className={`mb-3 flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        <div className="whitespace-pre-wrap leading-relaxed">{content}</div>
      </div>
    </div>
  );
}

export function ChatPane({ messages }: { messages: ChatMsg[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <ScrollArea className="h-[380px] pr-2" ref={ref as any}>
      <div className="px-1">
        {messages.length === 0 ? (
          <div className="mt-10 text-center text-muted-foreground">No conversation yet.</div>
        ) : (
          messages.map((m, i) => <ChatBubble key={i} role={m.role} content={m.content} />)
        )}
      </div>
    </ScrollArea>
  );
}