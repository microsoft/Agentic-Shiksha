export type CatAction = "sit" | "walk" | "run" | "stretch" | "sleep";
export type CompanionBubbleVariant = "speech" | "thought" | "whisper" | "card";
export type CompanionScene =
  | "welcome" | "ready" | "composing" | "thinking" | "writing" | "asset"
  | "search" | "progress" | "waiting" | "stretch" | "sleep" | "night" | "inactive";

export const COMPANION_IDLE_MS = 120_000;
export const COMPANION_NIGHT_WAKE_MS = 60_000;
export const COMPANION_STRETCH_MS = 4_800;
export const COMPANION_MESSAGE_MS = 20_000;

export function resolveCompanionBubbleVariant(action: CatAction, override?: CompanionBubbleVariant): CompanionBubbleVariant {
  return override ?? (action === "sleep" ? "thought" : "speech");
}

export type CompanionState = {
  action: CatAction;
  scene: CompanionScene;
  working: boolean;
  standing: boolean;
  label: string;
};

export type CompanionContext = {
  now: number;
  openedAt: number;
  lastActivityAt: number | null;
  completedAt?: number | null;
  isSending?: boolean;
  isTyping?: boolean;
  statusLabel?: string | null;
  activityKey?: string;
  active?: boolean;
  readOnly?: boolean;
  empty?: boolean;
};

export function normalizeCompanionLabel(label?: string | null): string {
  return label?.trim().replace(/[.\u2026]+$/, "").trim() || "";
}

export function isDuplicateCompanionActivity(
  activity: { label: string; done?: boolean },
  companionLabel?: string | null,
): boolean {
  const normalize = (label?: string | null) => normalizeCompanionLabel(label).replace(/\s+/g, " ").toLowerCase();
  const label = normalize(companionLabel);
  return !activity.done && label !== "" && normalize(activity.label) === label;
}

export function resolveCompanionState({
  now, openedAt, lastActivityAt, completedAt, isSending = false, isTyping = false,
  statusLabel, activityKey = "", active = true, readOnly = false, empty = false,
}: CompanionContext): CompanionState {
  const label = normalizeCompanionLabel(statusLabel);
  const waiting = label.toLowerCase() === "waiting for your response";
  const state = (action: CatAction, scene: CompanionScene, working = false, standing = false): CompanionState =>
    ({ action, scene, working, standing, label });

  if (!active || readOnly) return state("sleep", "inactive");

  if ((isSending || isTyping) && !waiting) {
    if (/^(creating|generating|building|preparing|rendering|simulating)\b.*\b(document|quiz|challenge|diagram|image|infographic|circuit|slides?|slide deck|presentation|asset)\b/i.test(label)) {
      return state("run", "asset", true);
    }
    if (/^writing\b/i.test(label) || (!label && isTyping)) return state("run", "writing", true);
    if (/^(searching|retrieving|looking up)\b/i.test(label)) return state("walk", "search", true);
    if (/^(loading|saving|updating)\b/i.test(label)) return state("walk", "progress", true);
    return state("walk", "thinking", true);
  }

  if (!waiting && completedAt != null && now >= completedAt && now - completedAt < COMPANION_STRETCH_MS) {
    return state("stretch", "stretch");
  }

  const idleMs = Math.max(0, now - (lastActivityAt ?? openedAt));
  const hour = new Date(now).getHours();
  const night = hour >= 22 || hour < 6;
  if (idleMs >= COMPANION_IDLE_MS || (night && (lastActivityAt == null || idleMs >= COMPANION_NIGHT_WAKE_MS))) {
    return state("sleep", night ? "night" : "sleep");
  }
  if (waiting) {
    return state("stretch", "waiting", false, idleMs % (10_000 + COMPANION_STRETCH_MS) < 10_000);
  }
  return state("sit", activityKey.trim() ? "composing" : empty ? "welcome" : "ready");
}

export function getCompanionMessage(state: CompanionState, userName?: string, sequence = 0): {
  headline: string;
  detail?: string;
  announce: boolean;
} {
  const name = userName?.trim().split(/\s+/)[0];
  const pick = (messages: readonly string[]) => messages[sequence % messages.length];
  const resting: Partial<Record<CompanionScene, readonly string[]>> = {
    welcome: [
      `Hi ${name || "there"}! What would you like to learn today?`,
      "A question, an example, or a quick quiz?",
      "Pick a suggestion below, or bring your own question.",
    ],
    ready: [
      `Ready for your next question${name ? `, ${name}` : ""}.`,
      "We can go deeper, simplify this, or try an example.",
      "What would you like to explore next?",
    ],
    composing: [
      "Take your time. I'm listening.",
      "A rough idea is a perfectly good place to start.",
      "You can ask for an explanation, an example, or some practice.",
    ],
    stretch: [
      "A little stretch between questions.",
      "Resting my paws for a moment.",
      "Your next question can be as small or as big as you like.",
    ],
    sleep: [
      "Taking a catnap. Type whenever you're ready.",
      "Resting my paws while you're away.",
      "No rush. I'll wake when you start typing.",
    ],
    night: [
      "A quiet-night catnap. Type to wake me.",
      "Night mode: resting until your next question.",
      "Keeping things quiet. I'm here when you need me.",
    ],
  };
  if (state.scene === "inactive") return { headline: "", announce: false };
  const messages = resting[state.scene];
  if (messages) return { headline: pick(messages), announce: false };

  const details: Partial<Record<CompanionScene, readonly string[]>> = {
    asset: [
      "Putting the requested learning asset together.",
      "You can keep reading while the asset is generated.",
      "The tool step above will change when the agent moves on.",
    ],
    writing: [
      "You can read along as the response arrives.",
      "The answer is appearing in the conversation.",
      "I'll settle down when the response stops.",
    ],
    search: [
      "Looking for context relevant to your question.",
      "You can keep reading while the search runs.",
      "The current search step is shown above.",
    ],
    progress: [
      "Keeping the current progress step in view.",
      "You can keep reading while this step runs.",
      "This bubble will update when the tool changes.",
    ],
    waiting: [
      "Choose an answer above, or tell me more.",
      "Take your time. We can continue when you're ready.",
      "Need a different question? You can say so.",
    ],
    thinking: [
      "You can keep reading while I work.",
      "I'll update this bubble when the task changes.",
      "The current step stays visible here.",
    ],
  };
  const label = state.label === "Generating clarification questions" ? "Asking clarification questions" : state.label;
  const fallback = state.scene === "writing" ? "Writing your response" : "Working on your request";
  const detail = details[state.scene];
  return {
    headline: label ? `${label}\u2026` : `${fallback}...`,
    detail: detail ? pick(detail) : undefined,
    announce: true,
  };
}
