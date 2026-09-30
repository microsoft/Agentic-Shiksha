import { API_BASE_URL } from "@/lib/config";

export const CHAT_SEND_QUERY_EVENT = "chat-send-query";
export const CLARIFICATION_SUBMITTED_EVENT = "clarification-submitted";
export const ASK_TA_QUOTE_EVENT = "ask-ta-quote";

/** Attach `text` selected in a message to the composer as quoted context. */
export function dispatchAskTAQuote(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  window.dispatchEvent(
    new CustomEvent(ASK_TA_QUOTE_EVENT, { detail: { text: trimmed } }),
  );
}

/** Ask ChatView to send `text` to the agent as a normal user message. */
export function dispatchChatQuery(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  window.dispatchEvent(
    new CustomEvent(CHAT_SEND_QUERY_EVENT, { detail: { text: trimmed } }),
  );
}

export interface ClarificationState {
  clarify_id: string;
  phase: "answering" | "decision";
  answer_deadline_ms: number;
  decision_deadline_ms: number;
  server_now_ms: number;
  answer_window_seconds: number;
  decision_window_seconds: number;
  revision: number;
  answers: Array<{ answer: string }>;
}

export class ClarificationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ClarificationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function clarificationRequest(clarifyId: string, suffix: string, init: RequestInit): Promise<unknown> {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const url = `${base}${base.endsWith("/api") ? "" : "/api"}/clarify/${encodeURIComponent(clarifyId)}${suffix}`;
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ClarificationError(
      isRecord(data) && typeof data.detail === "string" ? data.detail : "The clarification could not be updated. Please retry.",
      response.status,
    );
  }
  return data;
}

function readClarificationState(data: unknown, clarifyId: string): ClarificationState {
  if (!isRecord(data) || data.clarify_id !== clarifyId
    || (data.phase !== "answering" && data.phase !== "decision")
    || typeof data.answer_deadline_ms !== "number" || !Number.isFinite(data.answer_deadline_ms)
    || typeof data.decision_deadline_ms !== "number" || !Number.isFinite(data.decision_deadline_ms)
    || data.decision_deadline_ms <= data.answer_deadline_ms
    || typeof data.server_now_ms !== "number" || !Number.isFinite(data.server_now_ms)
    || typeof data.answer_window_seconds !== "number" || !(data.answer_window_seconds > 0)
    || typeof data.decision_window_seconds !== "number" || !(data.decision_window_seconds > 0)
    || typeof data.revision !== "number" || !Number.isInteger(data.revision) || data.revision < 0
    || !Array.isArray(data.answers) || !data.answers.every((answer): answer is { answer: string } =>
      isRecord(answer) && typeof answer.answer === "string")) {
    throw new Error("The clarification timer could not be verified. Please retry.");
  }
  return {
    clarify_id: clarifyId, phase: data.phase, answer_deadline_ms: data.answer_deadline_ms,
    decision_deadline_ms: data.decision_deadline_ms, server_now_ms: data.server_now_ms,
    answer_window_seconds: data.answer_window_seconds, decision_window_seconds: data.decision_window_seconds,
    revision: data.revision, answers: data.answers,
  };
}

export async function getClarificationState(clarifyId: string, signal?: AbortSignal): Promise<ClarificationState> {
  return readClarificationState(await clarificationRequest(clarifyId, "", { method: "GET", signal }), clarifyId);
}

export async function saveClarificationDraft(
  clarifyId: string, answers: Array<{ answer: string }>,
): Promise<ClarificationState> {
  return readClarificationState(await clarificationRequest(clarifyId, "", {
    method: "PATCH", body: JSON.stringify({ answers }),
  }), clarifyId);
}

export async function extendClarification(clarifyId: string, revision: number): Promise<ClarificationState> {
  return readClarificationState(await clarificationRequest(clarifyId, "/extend", {
    method: "POST", body: JSON.stringify({ revision }),
  }), clarifyId);
}

export function notifyClarificationFinished(clarifyId: string) {
  window.dispatchEvent(new CustomEvent(CLARIFICATION_SUBMITTED_EVENT, { detail: { clarifyId } }));
}

export async function submitClarification(clarifyId: string, answers: Array<{ answer: string }>): Promise<void> {
  const data = await clarificationRequest(clarifyId, "", { method: "POST", body: JSON.stringify({ answers }) });
  if (!isRecord(data) || data.status !== "ok" || data.answers !== answers.length) {
    throw new Error("Answer delivery could not be confirmed. Recheck the timer before trying again.");
  }
  notifyClarificationFinished(clarifyId);
}
