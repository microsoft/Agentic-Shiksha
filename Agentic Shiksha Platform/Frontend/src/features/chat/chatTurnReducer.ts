import type { ChatMsg, ContentBlock } from "../../lib/types";
import { normalizeSources } from "../../lib/citationSources";
import { isRetiredTool } from "../../lib/retiredContent";
import { parseSlidesBlock, SLIDES_INTERRUPTED_MESSAGE, SLIDES_INVALID_MESSAGE } from "../../lib/slides";
import { extractJsonDocuments, type GeneratedDoc } from "../create/markdownUtils";
import { parseChatResponse } from "./chatResponse";
import { CONTEXTUALISING_LABEL, TOOL_STATUS_LABELS } from "./generationLifecycle";
import type { ArtifactKind, ChatTurnEvent } from "./chatTransport";

export type TurnBlock = Exclude<ContentBlock, { type: "flashcard" }> & { isStreaming?: boolean };
export type TurnDocument = GeneratedDoc & { docType?: string };
export type TurnPhase = "streaming" | "completed" | "interrupted" | "failed";

export interface ChatTurnState {
  id: string;
  agentId: string;
  phase: TurnPhase;
  sessionId: string | null;
  message: ChatMsg & { createdAt: number };
  blocks: TurnBlock[];
  documents: TurnDocument[];
  streamingDocumentId: string | null;
  messageBlockIndex: number;
  sequence: number;
  accumulatedContent: string;
  waiting: boolean;
  activeToolLabel: string | null;
  hasSlides: boolean;
  title: string | null;
}

export function createChatTurnState(input: {
  id: string;
  agentId: string;
  sessionId: string | null;
  createdAt: number;
  messageGroupId: string;
  retryNumber: number;
}): ChatTurnState {
  return {
    id: input.id, agentId: input.agentId, sessionId: input.sessionId,
    phase: "streaming", blocks: [], documents: [], streamingDocumentId: null,
    messageBlockIndex: -1, sequence: 0, accumulatedContent: "", waiting: true,
    activeToolLabel: CONTEXTUALISING_LABEL, hasSlides: false, title: null,
    message: {
      role: "assistant", content: "", createdAt: input.createdAt,
      messageGroupId: input.messageGroupId, retryNumber: input.retryNumber,
    },
  };
}

function nextId(state: ChatTurnState, kind: string): string {
  state.sequence += 1;
  return `${kind}-${state.id}-${state.sequence}`;
}

function promoteProse(state: ChatTurnState): void {
  if (state.blocks.some(block => block.type === "text")) return;
  const prose = state.phase === "streaming"
    ? parseChatResponse(state.accumulatedContent).response : state.message.content;
  if (!prose) return;
  state.blocks.unshift({ type: "text", content: prose, isStreaming: false });
  if (state.messageBlockIndex >= 0) state.messageBlockIndex += 1;
}

function addBlock(state: ChatTurnState, block: TurnBlock): void {
  promoteProse(state);
  state.blocks.push(block);
}

function completeBlock(state: ChatTurnState, block: TurnBlock): void {
  const index = lastBlockIndex(state.blocks, item => item.type === block.type && !!item.isStreaming);
  if (index < 0) addBlock(state, block);
  else state.blocks[index] = block;
}

function pendingBlock(state: ChatTurnState, type: ArtifactKind): TurnBlock | undefined {
  return state.blocks[lastBlockIndex(state.blocks, block => block.type === type && !!block.isStreaming)];
}

function lastBlockIndex(blocks: TurnBlock[], matches: (block: TurnBlock) => boolean): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (matches(blocks[index])) return index;
  }
  return -1;
}

function projectBlock(block: TurnBlock, persisted: boolean): ContentBlock {
  const { isStreaming, ...content } = block;
  switch (content.type) {
    case "text":
    case "document":
    case "circuit":
    case "slides":
      return persisted ? content : { ...content, isStreaming };
    case "generated_image":
      return { ...content, imageData: "" };
    case "quiz":
    case "challenge":
    case "tikz_image":
    case "clarify":
    case "suggested_queries":
    case "tool_activity":
      return content;
  }
}

function projectMessage(state: ChatTurnState): void {
  const firstDocument = state.documents.find(doc =>
    state.blocks.some(block => block.type === "document" && block.docId === doc.id),
  ) ?? state.documents[0];
  const content = state.blocks.length
    ? state.blocks.filter(block => block.type === "text").map(block => block.content).join("")
    : state.message.content;
  state.message = {
    ...state.message, content,
    contentBlocks: state.blocks.length ? state.blocks.map(block => projectBlock(block, false)) : undefined,
    generatedDocId: firstDocument?.id,
    generatedDocTitle: firstDocument?.title,
    generatedDocContent: firstDocument?.content || undefined,
  };
}

export function persistedTurnMessage(state: ChatTurnState): ChatMsg & { createdAt: number } {
  return {
    ...state.message,
    contentBlocks: state.blocks.length ? state.blocks.map(block => projectBlock(block, true)) : undefined,
  };
}

export function hasTurnContent(state: ChatTurnState): boolean {
  return !!state.message.content.trim() || state.blocks.some(block => block.type !== "text" && block.type !== "tool_activity");
}

function finish(state: ChatTurnState, at: number, phase: TurnPhase): void {
  const streamingDoc = state.documents.find(doc => doc.id === state.streamingDocumentId);
  if (streamingDoc && !streamingDoc.content.trim()) {
    state.documents = state.documents.filter(doc => doc.id !== streamingDoc.id);
    state.blocks = state.blocks.filter(block => block.type !== "document" || block.docId !== streamingDoc.id);
  }
  state.documents = state.documents.map(doc => ({ ...doc, isStreaming: false }));
  state.streamingDocumentId = null;
  state.blocks = state.blocks
    .filter(block => block.type !== "tool_activity" && (block.type !== "circuit" || (!!block.circuit && !!block.result)))
    .map(block => block.type === "slides" && !block.deck
      ? { type: "text", content: SLIDES_INTERRUPTED_MESSAGE, isStreaming: false }
      : { ...block, isStreaming: false });
  const parsed = parseChatResponse(state.accumulatedContent || state.message.content);
  state.title = parsed.title;
  if (!state.blocks.length) {
    const extracted = !state.documents.length ? extractJsonDocuments(parsed.response) : null;
    if (extracted?.documents.length) {
      state.documents = extracted.documents.map(doc => ({
        ...doc, id: nextId(state, "document"), hasExplicitTitle: true,
        messageGroupId: state.message.messageGroupId,
      }));
      const firstDoc = state.documents[0];
      const single = state.documents.length === 1;
      state.message.content = single
        ? extracted.textParts[0] || `Generated document: ${firstDoc.title}`
        : extracted.textParts.join("\n\n").trim() ||
          `Generated ${state.documents.length} documents: ${state.documents.map(doc => doc.title).join(", ")}`;
      state.message.docBlockContent = single ? extracted.textParts.slice(1).join("\n\n").trim() || undefined : undefined;
    } else {
      state.message.content = parsed.response;
    }
  }
  state.phase = phase;
  state.waiting = false;
  state.activeToolLabel = null;
  state.message.createdAt = at;
}

const toolKinds: Readonly<Record<string, ArtifactKind>> = {
  add_document: "document", add_quiz: "quiz", add_challenge: "challenge",
  add_tikz_diagram: "tikz_image", add_circuit: "circuit", add_slides: "slides",
  generate_image: "generated_image",
};

function cancelBlock(state: ChatTurnState, tool?: string): void {
  if (isRetiredTool(tool)) return;
  if (tool === "plain_text") {
    const index = lastBlockIndex(state.blocks, block => block.type === "text" && !!block.isStreaming);
    if (index >= 0) state.blocks.splice(index, 1);
    state.messageBlockIndex = -1;
    return;
  }
  const label = tool ? TOOL_STATUS_LABELS[tool] : undefined;
  state.blocks = state.blocks.filter(block => block.type !== "tool_activity" || !!block.done || (!!label && block.label !== label));
  const kind = tool ? toolKinds[tool] : undefined;
  const index = lastBlockIndex(state.blocks, block => !!block.isStreaming && block.type !== "text" && (!kind || block.type === kind));
  const block = state.blocks[index];
  if (block?.type === "document") {
    state.documents = state.documents.filter(doc => doc.id !== block.docId);
    if (state.streamingDocumentId === block.docId) state.streamingDocumentId = null;
  }
  if (tool === "add_slides") {
    const replacement: TurnBlock = { type: "text", content: SLIDES_INVALID_MESSAGE, isStreaming: false };
    if (index >= 0) state.blocks[index] = replacement;
    else addBlock(state, replacement);
    state.waiting = false;
  } else if (index >= 0) {
    state.blocks.splice(index, 1);
  }
  state.messageBlockIndex = -1;
  state.activeToolLabel = null;
}

/** No clocks, IDs, React state, store lookups, or I/O are read during reduction. */
export function reduceChatTurn(previous: ChatTurnState, event: ChatTurnEvent): ChatTurnState {
  if (previous.phase !== "streaming" && event.type !== "usage" && event.type !== "suggestions") return previous;
  const state: ChatTurnState = {
    ...previous, message: { ...previous.message }, blocks: [...previous.blocks], documents: [...previous.documents],
  };
  switch (event.type) {
    case "session":
      state.sessionId = event.sessionId;
      break;
    case "context":
      state.activeToolLabel = event.status === "preparing" ? CONTEXTUALISING_LABEL
        : state.activeToolLabel === CONTEXTUALISING_LABEL ? null : state.activeToolLabel;
      break;
    case "delta": {
      if (!event.content) return previous;
      state.waiting = false;
      state.activeToolLabel = null;
      state.accumulatedContent += event.content;
      if (!state.blocks.length) state.message.content = parseChatResponse(state.accumulatedContent).response;
      else {
        const last = state.blocks.at(-1);
        if (last?.type === "text" && last.isStreaming) {
          state.blocks[state.blocks.length - 1] = { ...last, content: last.content + event.content };
        } else {
          state.blocks.push({ type: "text", content: event.content, isStreaming: true });
        }
      }
      break;
    }
    case "citations":
      state.message.sources = normalizeSources([...(state.message.sources ?? []), ...event.sources]);
      break;
    case "usage":
      state.message.tokenUsage = event.usage;
      break;
    case "message_start":
      addBlock(state, { type: "text", content: "", isStreaming: true });
      state.messageBlockIndex = state.blocks.length - 1;
      state.waiting = false;
      state.activeToolLabel = null;
      break;
    case "message_delta":
    case "message": {
      const block = state.blocks[state.messageBlockIndex];
      if (block?.type === "text") {
        state.blocks[state.messageBlockIndex] = {
          ...block,
          content: event.type === "message_delta" ? block.content + event.content : event.content,
          isStreaming: event.type === "message_delta",
        };
      } else {
        addBlock(state, { type: "text", content: event.content, isStreaming: event.type === "message_delta" });
        state.messageBlockIndex = state.blocks.length - 1;
      }
      state.waiting = false;
      state.activeToolLabel = null;
      break;
    }
    case "artifact_start": {
      const id = nextId(state, event.kind);
      let block: TurnBlock;
      switch (event.kind) {
        case "document":
          state.streamingDocumentId = id;
          state.documents.push({
            id, title: "Generating document...", content: "", hasExplicitTitle: false,
            messageGroupId: state.message.messageGroupId, isStreaming: true,
          });
          block = { type: "document", docId: id, title: "", isStreaming: true };
          break;
        case "quiz":
          block = { type: "quiz", quizId: id, title: "Generating quiz...", questions: [], isStreaming: true };
          break;
        case "challenge":
          block = {
            type: "challenge", challengeId: id, title: "Loading challenge...", description: "",
            difficulty: "medium", hints: [], solution: "", challengeType: "problem", isStreaming: true,
          };
          break;
        case "tikz_image":
          block = { type: "tikz_image", tikzImageId: id, title: "Generating diagram...", imageData: "", caption: "", isStreaming: true };
          break;
        case "generated_image":
          block = { type: "generated_image", generatedImageId: id, title: "Generating image...", imageData: "", caption: "", isStreaming: true };
          break;
        case "circuit":
          block = { type: "circuit", circuitId: id, title: "Circuit", isStreaming: true };
          break;
        case "slides":
          block = { type: "slides", slidesId: id, title: "Slides", agentId: state.agentId, isStreaming: true };
          state.hasSlides = true;
          state.waiting = false;
          break;
      }
      addBlock(state, block);
      break;
    }
    case "document_title":
      state.documents = state.documents.map(doc => doc.id === state.streamingDocumentId
        ? { ...doc, title: event.title, hasExplicitTitle: true } : doc);
      state.blocks = state.blocks.map(block => block.type === "document" && block.docId === state.streamingDocumentId
        ? { ...block, title: event.title } : block);
      break;
    case "document_delta":
      state.documents = state.documents.map(doc => doc.id === state.streamingDocumentId
        ? { ...doc, content: doc.content + event.content } : doc);
      break;
    case "document": {
      const id = state.streamingDocumentId ?? nextId(state, "document");
      const doc: TurnDocument = {
        id, ...event.document, docType: event.document.doc_type, hasExplicitTitle: true,
        messageGroupId: state.message.messageGroupId, isStreaming: false,
      };
      state.documents = [...state.documents.filter(item => item.id !== id), doc];
      const index = state.blocks.findIndex(block => block.type === "document" && block.docId === id);
      const block: TurnBlock = { type: "document", docId: id, title: doc.title, isStreaming: false };
      if (index >= 0) state.blocks[index] = block;
      else addBlock(state, block);
      state.streamingDocumentId = null;
      break;
    }
    case "tool": {
      if (isRetiredTool(event.tool) || (event.tool === "ask_clarification" && state.blocks.some(block => block.type === "clarify"))) return previous;
      const label = TOOL_STATUS_LABELS[event.tool] ?? "Working";
      const last = state.blocks[lastBlockIndex(state.blocks, block => block.type === "tool_activity")];
      if (last?.type !== "tool_activity" || last.label !== label) {
        state.blocks = state.blocks.map(block => block.type === "tool_activity" ? { ...block, done: true } : block);
        addBlock(state, { type: "tool_activity", activityId: nextId(state, "activity"), label, done: false });
      }
      state.activeToolLabel = null;
      break;
    }
    case "cancel_block":
      cancelBlock(state, event.tool);
      break;
    case "quiz": {
      const pending = pendingBlock(state, "quiz");
      completeBlock(state, {
        type: "quiz", ...event.quiz,
        quizId: event.quiz.assessmentInstanceId || event.quiz.quizId || (pending?.type === "quiz" ? pending.quizId : nextId(state, "quiz")),
        isStreaming: false,
      });
      break;
    }
    case "challenge": {
      const pending = pendingBlock(state, "challenge");
      completeBlock(state, { type: "challenge", challengeId: pending?.type === "challenge" ? pending.challengeId : nextId(state, "challenge"), ...event.challenge, isStreaming: false });
      break;
    }
    case "tikz_image": {
      const pending = pendingBlock(state, "tikz_image");
      completeBlock(state, { type: "tikz_image", tikzImageId: pending?.type === "tikz_image" ? pending.tikzImageId : nextId(state, "tikz"), ...event.image, isStreaming: false });
      break;
    }
    case "generated_image": {
      const pending = pendingBlock(state, "generated_image");
      completeBlock(state, { type: "generated_image", generatedImageId: pending?.type === "generated_image" ? pending.generatedImageId : nextId(state, "image"), ...event.image, isStreaming: false });
      break;
    }
    case "circuit": {
      const pending = pendingBlock(state, "circuit");
      completeBlock(state, { type: "circuit", circuitId: pending?.type === "circuit" ? pending.circuitId : nextId(state, "circuit"), ...event.circuit, isStreaming: false });
      break;
    }
    case "slides": {
      const block = parseSlidesBlock({ ...event.slides, agentId: state.agentId });
      if (!block) {
        cancelBlock(state, "add_slides");
        break;
      }
      if (!state.blocks.some(item => item.type === "slides" && item.slidesId === block.slidesId)) {
        completeBlock(state, { ...block, isStreaming: false });
      }
      state.hasSlides = true;
      state.waiting = false;
      break;
    }
    case "clarify":
      state.blocks = state.blocks.filter(block => block.type !== "tool_activity" || block.label !== TOOL_STATUS_LABELS.ask_clarification);
      if (!state.blocks.some(block => block.type === "clarify" && block.clarifyId === event.clarification.clarifyId)) {
        addBlock(state, {
          type: "clarify", clarifyId: event.clarification.clarifyId || nextId(state, "clarify"),
          questions: event.clarification.questions,
        });
      }
      state.activeToolLabel = "Waiting for your response";
      break;
    case "clarification_done":
    case "clarification_submitted":
      if (!event.clarifyId || state.blocks.some(block => block.type === "clarify" && block.clarifyId === event.clarifyId)) {
        if (state.activeToolLabel === "Waiting for your response") state.activeToolLabel = null;
      }
      break;
    case "suggestions":
      if (state.blocks.some(block => block.type === "suggested_queries")) return previous;
      addBlock(state, { type: "suggested_queries", suggestionsId: nextId(state, "suggestions"), queries: event.queries });
      break;
    case "done":
      finish(state, event.at, "completed");
      break;
    case "end":
      finish(state, event.at, "interrupted");
      break;
    case "error":
      if (state.hasSlides) {
        addBlock(state, { type: "text", content: "The response was interrupted. Completed slides are still available." });
      }
      finish(state, event.at, "failed");
      projectMessage(state);
      if (!hasTurnContent(state)) {
        state.blocks = [];
        state.message.content = event.message;
      }
      break;
  }
  projectMessage(state);
  return state;
}
