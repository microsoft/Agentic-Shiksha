import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMsg } from "@/lib/types";
import type { GeneratedDoc } from "@/features/create/markdownUtils";
import type { ChatTurnState } from "./chatTurnReducer";
import type { ChatTurnEvent } from "./chatTransport";

/** Owns only the displayed transcript and document animation, never durable state. */
export function useChatPresentation() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]);
  const [streamingDocContent, setStreamingDocContent] = useState("");
  const documentIds = useRef<{ turnId: string; ids: Set<string> } | null>(null);
  const frame = useRef<number | null>(null);
  const pendingContent = useRef("");

  const clearStreamingDocument = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pendingContent.current = "";
    setStreamingDocContent("");
  }, []);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const presentTurn = useCallback((turn: ChatTurnState, event?: ChatTurnEvent) => {
    if (event?.type !== "document_delta") {
      setMessages(current => {
        if (current.at(-1)?.role !== "assistant") return [...current, turn.message];
        return [...current.slice(0, -1), turn.message];
      });
      const previousIds = documentIds.current?.turnId === turn.id ? documentIds.current.ids : new Set<string>();
      documentIds.current = { turnId: turn.id, ids: new Set(turn.documents.map(doc => doc.id)) };
      setGeneratedDocs(current => {
        const next = [
          ...current.filter(doc => !previousIds.has(doc.id) && !turn.documents.some(item => item.id === doc.id)),
          ...turn.documents.map(doc => doc.isStreaming ? { ...doc, content: "" } : doc),
        ];
        return current.length === next.length && current.every((doc, index) => {
          const other = next[index];
          return doc.id === other.id && doc.title === other.title && doc.content === other.content &&
            doc.isStreaming === other.isStreaming && doc.hasExplicitTitle === other.hasExplicitTitle &&
            doc.messageGroupId === other.messageGroupId;
        }) ? current : next;
      });
    }
    const document = turn.documents.find(doc => doc.id === turn.streamingDocumentId);
    if (!document) {
      clearStreamingDocument();
    } else {
      pendingContent.current = document.content;
      if (frame.current === null) {
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          setStreamingDocContent(pendingContent.current);
        });
      }
    }
  }, [clearStreamingDocument]);

  return {
    messages, setMessages, generatedDocs, setGeneratedDocs,
    streamingDocContent, clearStreamingDocument, presentTurn,
  };
}
