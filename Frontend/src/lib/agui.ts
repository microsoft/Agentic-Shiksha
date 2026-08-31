/**
 * AG-UI protocol client with an A2UI surface store.
 *
 * Connects to the backend's `/api/agents/{id}/chat/agui` endpoint, parses the
 * AG-UI event stream, and maintains A2UI surfaces built from `CUSTOM` events
 * named "a2ui".
 *
 * Protocol references:
 *   AG-UI  https://docs.ag-ui.com/concepts/events
 *   A2UI   https://a2ui.org/reference/messages/
 */

import { API_BASE_URL } from "@/lib/config";

/** Ensure the base ends with exactly one `/api` segment, matching api.ts. */
function withApiSuffix(base: string): string {
  const trimmed = (base || "").replace(/\/+$/, "");
  return /\/api$/i.test(trimmed) ? trimmed : `${trimmed}/api`;
}

const BASE = withApiSuffix(API_BASE_URL);
const RESPONSE_START_TIMEOUT_MS = 90_000;
// Must stay above the slowest server-side tool: generate_image allows 180s, so an
// equal client budget makes a slow image race the timeout and lose the whole turn.
const STREAM_IDLE_TIMEOUT_MS = 240_000;
const STREAM_TIMEOUT_MESSAGE = "The agent stopped responding. Please try again.";

/** Backend stream event name -> A2UI catalog component type. */
export const KIND_TO_COMPONENT: Record<string, string> = {
  quiz: "Quiz",
  flashcard: "Flashcard",
  challenge: "Challenge",
  document: "Document",
  message_block: "MessageBlock",
  tikz_image: "DiagramImage",
  generated_image: "GeneratedImage",
  // Compatibility for A2UI surfaces created by older backends.
  sympy_image: "DiagramImage",
  clarify: "Clarify",
  suggested_queries: "SuggestedQueries",
};

/* ------------------------------------------------------------------ */
/* AG-UI event types                                                    */
/* ------------------------------------------------------------------ */

export type AGUIEvent = {
  type: string;
  [key: string]: any;
};

export const AGUI = {
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_ERROR: "RUN_ERROR",
  STEP_STARTED: "STEP_STARTED",
  STEP_FINISHED: "STEP_FINISHED",
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END: "TEXT_MESSAGE_END",
  CUSTOM: "CUSTOM",
} as const;

/* ------------------------------------------------------------------ */
/* A2UI surface model                                                   */
/* ------------------------------------------------------------------ */

/** A component binding: either a literal or a data-model path. */
export type A2UIBinding =
  | { literalString: string }
  | { path: string }
  | Record<string, unknown>;

export type A2UIComponent = {
  /** Component type from the catalog, e.g. "Quiz". */
  componentType: string;
  /** Property name -> binding. */
  bindings: Record<string, A2UIBinding>;
};

export type A2UISurface = {
  surfaceId: string;
  root?: string;
  catalogId?: string;
  components: Record<string, A2UIComponent>;
  dataModel: Record<string, any>;
  /** Surfaces only render once `createSurface` has been received. */
  ready: boolean;
};

/** Decode one A2UI typed-value entry into a JS value. */
function decodeValue(entry: Record<string, any>): any {
  if ("valueString" in entry) return entry.valueString;
  if ("valueNumber" in entry) return entry.valueNumber;
  if ("valueBoolean" in entry) return entry.valueBoolean;
  if ("valueMap" in entry) return decodeContents(entry.valueMap ?? []);
  return undefined;
}

/**
 * Decode an A2UI `contents` adjacency list into a JS object, collapsing
 * sequentially-indexed maps ("0", "1", ...) back into arrays.
 */
export function decodeContents(contents: Array<Record<string, any>>): any {
  const out: Record<string, any> = {};
  for (const entry of contents) {
    if (!entry || typeof entry.key !== "string") continue;
    out[entry.key] = decodeValue(entry);
  }

  const keys = Object.keys(out);
  const isArray =
    keys.length > 0 && keys.every((k, i) => k === String(i));
  return isArray ? keys.map((k) => out[k]) : out;
}

/** Merge an object into the data model at a slash-delimited path.
 *
 * A2UI path updates are additive: patching `/user` with `email` must not drop
 * `name`. Replacing here would discard earlier streamed chunks.
 */
function mergeAtPath(
  model: Record<string, any>,
  path: string,
  value: Record<string, any>
): void {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return;
  let node = model;
  for (const part of parts) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part];
  }
  Object.assign(node, value);
}

/** Join indexed chunk maps ({"0":"a","1":"b"} or ["a","b"]) in key order. */
export function joinChunks(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, any>)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, v]) => (typeof v === "string" ? v : ""))
    .join("");
}

/**
 * Apply one A2UI message to a surface map, returning a new map.
 * Unknown message kinds are ignored so newer spec revisions degrade safely.
 */
export function applyA2UIMessage(
  surfaces: Record<string, A2UISurface>,
  message: Record<string, any>
): Record<string, A2UISurface> {
  const next = { ...surfaces };

  const ensure = (surfaceId: string): A2UISurface => {
    const existing = next[surfaceId];
    const surface: A2UISurface = existing
      ? { ...existing, components: { ...existing.components }, dataModel: { ...existing.dataModel } }
      : { surfaceId, components: {}, dataModel: {}, ready: false };
    next[surfaceId] = surface;
    return surface;
  };

  // v0.9 names, with v0.8 aliases accepted for forward/backward tolerance.
  const update = message.updateComponents ?? message.surfaceUpdate;
  if (update?.surfaceId) {
    const surface = ensure(update.surfaceId);
    for (const item of update.components ?? []) {
      if (!item?.id || !item.component) continue;
      const componentType = Object.keys(item.component)[0];
      if (!componentType) continue;
      surface.components[item.id] = {
        componentType,
        bindings: item.component[componentType] ?? {},
      };
    }
  }

  const data = message.updateDataModel ?? message.dataModelUpdate;
  if (data?.surfaceId) {
    const surface = ensure(data.surfaceId);
    if (data.path) {
      // Path-scoped updates merge; decode entries individually so indexed
      // chunk keys accumulate instead of collapsing to a partial array.
      const incoming: Record<string, any> = {};
      for (const entry of data.contents ?? []) {
        if (entry && typeof entry.key === "string") {
          incoming[entry.key] = decodeValue(entry);
        }
      }
      mergeAtPath(surface.dataModel, data.path, incoming);
    } else {
      const decoded = decodeContents(data.contents ?? []);
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
        surface.dataModel = { ...surface.dataModel, ...decoded };
      }
    }
  }

  const create = message.createSurface ?? message.beginRendering;
  if (create?.surfaceId) {
    const surface = ensure(create.surfaceId);
    surface.root = create.root;
    surface.catalogId = create.catalogId;
    surface.ready = true;
  }

  const remove = message.deleteSurface;
  if (remove?.surfaceId) {
    delete next[remove.surfaceId];
  }

  return next;
}

/** Resolve a component's bindings against its surface data model. */
export function resolveBindings(
  surface: A2UISurface,
  component: A2UIComponent
): Record<string, any> {
  const props: Record<string, any> = {};
  for (const [name, binding] of Object.entries(component.bindings)) {
    if (binding && typeof binding === "object") {
      if ("literalString" in binding) {
        props[name] = (binding as { literalString: string }).literalString;
        continue;
      }
      if ("path" in binding) {
        const path = (binding as { path: string }).path;
        const parts = path.split("/").filter(Boolean);
        let node: any = surface.dataModel;
        for (const part of parts) {
          node = node?.[part];
          if (node === undefined) break;
        }
        props[name] = node;
        continue;
      }
    }
    props[name] = binding;
  }
  return props;
}

/* ------------------------------------------------------------------ */
/* Streaming client                                                     */
/* ------------------------------------------------------------------ */

export type AGUIHandlers = {
  /** Called for every AG-UI event, after built-in surface handling. */
  onEvent?: (event: AGUIEvent) => void;
  /** Streaming assistant text (concatenate deltas). */
  onTextDelta?: (delta: string, messageId: string) => void;
  /** Called whenever the A2UI surface map changes. */
  onSurfaces?: (surfaces: Record<string, A2UISurface>) => void;
  onRunStarted?: (threadId: string, runId: string) => void;
  onRunFinished?: (threadId: string) => void;
  onError?: (message: string) => void;
};

export type AGUIRequest = {
  text: string;
  /** Required: keys the student's learning state on the backend. */
  user_id: string;
  usage_event_id?: string;
  thread_id?: string | null;
  user_profile?: Record<string, any>;
  inject_profile?: boolean;
  tool_choice?: string;
  research_mode?: boolean;
  web_search_enabled?: boolean;
  image_urls?: string[];
};

/**
 * Stream an AG-UI chat run.
 *
 * Returns the final thread id so callers can continue the conversation.
 */
export async function streamAgentChatAGUI(
  agentId: string,
  request: AGUIRequest,
  handlers: AGUIHandlers = {},
  signal?: AbortSignal
): Promise<string | null> {
  const requestController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const scheduleTimeout = (delayMs: number) => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, delayMs);
  };
  const forwardAbort = () => requestController.abort(signal?.reason);

  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  const decoder = new TextDecoder();

  let buffer = "";
  let threadId: string | null = request.thread_id ?? null;
  let surfaces: Record<string, A2UISurface> = {};

  scheduleTimeout(RESPONSE_START_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BASE}/agents/${encodeURIComponent(agentId)}/chat/agui`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(request),
        signal: requestController.signal,
      }
    );

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`AG-UI stream failed (${response.status}): ${detail}`);
    }

    reader = response.body.getReader();

    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      scheduleTimeout(STREAM_IDLE_TIMEOUT_MS);

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;

          const raw = line.slice(5).trim();
          if (!raw) continue;

          let event: AGUIEvent;
          try {
            event = JSON.parse(raw);
          } catch {
            console.warn("[AG-UI] skipping malformed frame", raw.slice(0, 120));
            continue;
          }

          switch (event.type) {
            case AGUI.RUN_STARTED:
              threadId = event.threadId ?? threadId;
              handlers.onRunStarted?.(event.threadId, event.runId);
              break;

            case AGUI.TEXT_MESSAGE_CONTENT:
              handlers.onTextDelta?.(event.delta ?? "", event.messageId);
              break;

            case AGUI.CUSTOM:
              if (event.name === "a2ui" && event.value) {
                surfaces = applyA2UIMessage(surfaces, event.value);
                handlers.onSurfaces?.(surfaces);
              }
              break;

            case AGUI.RUN_FINISHED:
              threadId = event.threadId ?? threadId;
              handlers.onRunFinished?.(event.threadId);
              break;

            case AGUI.RUN_ERROR:
              handlers.onError?.(event.message ?? "Unknown agent error");
              break;

            default:
              break;
          }

          handlers.onEvent?.(event);
        }
      }
    }
  } catch (error) {
    if (timedOut) throw new Error(STREAM_TIMEOUT_MESSAGE);
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    signal?.removeEventListener("abort", forwardAbort);
    reader?.cancel().catch(() => {});
  }

  return threadId;
}
