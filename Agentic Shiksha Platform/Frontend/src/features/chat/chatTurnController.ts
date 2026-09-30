import type { ChatGeneration } from "./generationLifecycle";
import type { ChatTurnPersistence } from "./chatPersistence";
import { chatFailureMessage } from "./chatResponse";
import { reduceChatTurn, type ChatTurnState } from "./chatTurnReducer";
import { streamChatTurn, type ChatTurnEvent, type ChatTurnRequest, type ChatWireTransport } from "./chatTransport";

export interface ChatTurnController {
  readonly state: ChatTurnState;
  run(): Promise<void>;
  interrupt(): void;
  dispatch(event: ChatTurnEvent): void;
}

export function createChatTurnController(options: {
  initial: ChatTurnState;
  request: ChatTurnRequest;
  generation: ChatGeneration;
  transport: ChatWireTransport;
  persistence: ChatTurnPersistence;
  present: (state: ChatTurnState, event?: ChatTurnEvent) => void;
}): ChatTurnController {
  const { request, generation, persistence, present } = options;
  let state = options.initial;
  let started = false;

  function dispatch(event: ChatTurnEvent) {
    if (!generation.isCurrent()) return;
    const next = reduceChatTurn(state, event);
    if (next === state) return;
    const sessionChanged = next.sessionId && next.sessionId !== state.sessionId;
    const finished = state.phase === "streaming" && next.phase !== "streaming";
    state = next;
    if (sessionChanged && next.sessionId) persistence.setSession(next.sessionId);
    persistence.saveCompletedSlides(state);
    if (state.phase !== "streaming") persistence.commit(state);
    present(state, event);
    if (finished) {
      generation.finish();
      if (state.phase === "completed" || (event.type === "end" && event.reason === "eof")) {
        void persistence.complete(state, generation.signal).then(queries => {
          if (queries?.length) dispatch({ type: "suggestions", queries });
        }).catch(error => persistence.reportFailure(error));
      }
    }
  }

  return {
    get state() { return state; },
    dispatch,
    interrupt() {
      if (state.phase === "streaming") dispatch({ type: "end", at: Date.now(), reason: "interrupted" });
      generation.controller.abort();
    },
    async run() {
      if (started || !generation.isCurrent()) return;
      started = true;
      present(state);
      try {
        await streamChatTurn(options.transport, request, generation.signal, dispatch);
        if (state.phase === "streaming") dispatch({ type: "end", at: Date.now(), reason: "eof" });
      } catch (error) {
        if (!generation.isCurrent()) return;
        if (error instanceof Error && error.name === "AbortError") {
          dispatch({ type: "end", at: Date.now(), reason: "interrupted" });
          return;
        }
        persistence.reportFailure(error);
        dispatch({ type: "error", at: Date.now(), message: chatFailureMessage(error) });
      }
    },
  };
}
