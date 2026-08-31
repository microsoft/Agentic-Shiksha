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

/**
 * Hand clarification answers to the agent turn that is blocked waiting on them.
 * Returns false when nothing is waiting (the turn already timed out).
 */
export async function submitClarification(
  clarifyId: string,
  answers: Array<{ answer: string }>,
): Promise<boolean> {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const url = `${base}${base.endsWith("/api") ? "" : "/api"}/clarify/${encodeURIComponent(clarifyId)}`;
  // The agent resumes server-side, so tell the UI to stop showing "waiting".
  window.dispatchEvent(new Event(CLARIFICATION_SUBMITTED_EVENT));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ answers }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
