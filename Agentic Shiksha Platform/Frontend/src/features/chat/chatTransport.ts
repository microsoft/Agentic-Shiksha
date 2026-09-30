import type { ChatContextStatus, StreamAgentChatOptions, StreamEvent } from "../../lib/api";
import type { ChatMsg, ChatSource } from "../../lib/types";

type Payload<K extends keyof StreamAgentChatOptions> =
  StreamAgentChatOptions[K] extends ((value: infer T) => void) | undefined ? T : never;

export type ArtifactKind = "document" | "quiz" | "challenge" | "tikz_image" | "generated_image" | "circuit" | "slides";

export type ChatTurnEvent =
  | { type: "session"; sessionId: string }
  | { type: "context"; status: ChatContextStatus }
  | { type: "delta"; content: string }
  | { type: "citations"; sources: Array<Partial<ChatSource>> }
  | { type: "usage"; usage: NonNullable<ChatMsg["tokenUsage"]> }
  | { type: "done"; at: number }
  | { type: "end"; at: number; reason: "interrupted" | "eof" }
  | { type: "error"; at: number; message: string }
  | { type: "artifact_start"; kind: ArtifactKind }
  | { type: "document_title"; title: string }
  | { type: "document_delta"; content: string }
  | { type: "document"; document: Payload<"onDocument"> }
  | { type: "message_start" }
  | { type: "message_delta"; content: string }
  | { type: "message"; content: string }
  | { type: "tool"; tool: string }
  | { type: "cancel_block"; tool?: string }
  | { type: "quiz"; quiz: Payload<"onQuiz"> }
  | { type: "challenge"; challenge: Payload<"onChallenge"> }
  | { type: "tikz_image"; image: Payload<"onTikzImage"> }
  | { type: "generated_image"; image: Payload<"onGeneratedImage"> }
  | { type: "circuit"; circuit: Payload<"onCircuit"> }
  | { type: "slides"; slides: Payload<"onSlides"> }
  | { type: "clarify"; clarification: Payload<"onClarify"> }
  | { type: "clarification_done"; clarifyId?: string }
  | { type: "clarification_submitted"; clarifyId: string }
  | { type: "suggestions"; queries: string[] };

export type ChatRequestOptions = Pick<StreamAgentChatOptions,
  "user_id" | "usage_event_id" | "event_id" | "supersedes_event_id" |
  "web_search_enabled" | "answer_depth" | "inject_profile" | "user_profile" | "image_urls"
>;

export interface ChatTurnRequest {
  agentId: string;
  text: string;
  sessionId: string | null;
  options: ChatRequestOptions;
}

export type ChatWireTransport = (
  agentId: string,
  text: string,
  sessionId: string | null,
  onEvent: (event: StreamEvent) => void,
  options: StreamAgentChatOptions,
) => Promise<void>;

/** Both existing wire adapters terminate at this feature-owned event boundary. */
export function streamChatTurn(
  transport: ChatWireTransport,
  request: ChatTurnRequest,
  signal: AbortSignal,
  emit: (event: ChatTurnEvent) => void,
): Promise<void> {
  const onEvent = (event: StreamEvent) => {
    switch (event.type) {
      case "thread_id":
        if (event.thread_id) emit({ type: "session", sessionId: event.thread_id });
        break;
      case "delta":
        if (event.content) emit({ type: "delta", content: event.content });
        break;
      case "citations":
        if (event.citations?.length) emit({ type: "citations", sources: event.citations });
        break;
      case "usage":
        emit({ type: "usage", usage: {
          input_tokens: event.input_tokens ?? 0,
          output_tokens: event.output_tokens ?? 0,
          total_tokens: event.total_tokens ?? 0,
          rounds: event.rounds ?? 1,
          per_round: event.per_round ?? [],
        } });
        break;
      case "done":
        emit({ type: "done", at: Date.now() });
        break;
      case "error":
        emit({ type: "error", at: Date.now(), message: `Error: ${event.error || "Failed to get response"}` });
        break;
      // These are delivered through typed callbacks below (or the research path).
      case "document":
      case "tikz_image":
      case "generated_image":
      case "clarification_done":
      case "research_triggered":
      case "thinking":
      case "research_status":
      case "research_complete":
        break;
    }
  };

  return transport(request.agentId, request.text, request.sessionId, onEvent, {
    ...request.options,
    signal,
    onContextStatus: status => emit({ type: "context", status }),
    onDocumentStart: () => emit({ type: "artifact_start", kind: "document" }),
    onDocumentTitle: title => emit({ type: "document_title", title }),
    onDocumentDelta: content => emit({ type: "document_delta", content }),
    onDocument: document => emit({ type: "document", document }),
    onMessageBlockStart: () => emit({ type: "message_start" }),
    onMessageBlockDelta: content => emit({ type: "message_delta", content }),
    onMessageBlock: content => emit({ type: "message", content }),
    onToolStart: tool => emit({ type: "tool", tool }),
    onBlockCancel: tool => emit({ type: "cancel_block", tool }),
    onQuizStart: () => emit({ type: "artifact_start", kind: "quiz" }),
    onQuiz: quiz => emit({ type: "quiz", quiz }),
    onChallengeStart: () => emit({ type: "artifact_start", kind: "challenge" }),
    onChallenge: challenge => emit({ type: "challenge", challenge }),
    onTikzImageStart: () => emit({ type: "artifact_start", kind: "tikz_image" }),
    onTikzImage: image => emit({ type: "tikz_image", image }),
    onGeneratedImageStart: () => emit({ type: "artifact_start", kind: "generated_image" }),
    onGeneratedImage: image => emit({ type: "generated_image", image }),
    onCircuitStart: () => emit({ type: "artifact_start", kind: "circuit" }),
    onCircuit: circuit => emit({ type: "circuit", circuit }),
    onSlidesStart: () => emit({ type: "artifact_start", kind: "slides" }),
    onSlides: slides => emit({ type: "slides", slides }),
    onClarify: clarification => emit({ type: "clarify", clarification }),
    onClarificationDone: clarifyId => emit({ type: "clarification_done", clarifyId }),
    onSuggestedQueries: ({ queries }) => emit({ type: "suggestions", queries }),
  });
}
