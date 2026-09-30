export const BASE_TICK_INTERVAL_MS = 12;
export const CONTEXTUALISING_LABEL = "Contextualising";

const MIN_CHARS_PER_TICK = 2;
const MAX_CHARS_PER_TICK = 15;
const TARGET_TYPING_DURATION_MS = 2500;

export const TOOL_STATUS_LABELS: Readonly<Record<string, string>> = {
  add_tikz_diagram: "Creating image",
  add_document: "Generating a document",
  add_quiz: "Generating a quiz",
  add_challenge: "Generating a challenge",
  add_circuit: "Simulating circuit",
  add_slides: "Creating slide deck",
  add_message: "Writing a response",
  ask_clarification: "Generating clarification questions",
  suggest_next_queries: "Suggesting follow-ups",
  get_threshold_concepts: "Loading threshold concept progress",
  update_topic_progress: "Saving your progress",
  search_knowledge_base: "Searching course material",
  memory_search: "Searching your memories",
  declare_plan: "Planning",
};

export function getAdaptiveCharsPerTick(
  totalLength: number,
  currentPosition: number,
): number {
  const ticksNeeded = TARGET_TYPING_DURATION_MS / BASE_TICK_INTERVAL_MS;
  let baseChars = Math.ceil(totalLength / ticksNeeded);
  baseChars = Math.max(
    MIN_CHARS_PER_TICK,
    Math.min(MAX_CHARS_PER_TICK, baseChars),
  );
  const progress = currentPosition / totalLength;
  return Math.ceil(baseChars * (1 + progress * 0.5));
}

let generationIdCounter = 0;

export function nextGenerationId(): number {
  generationIdCounter += 1;
  return generationIdCounter;
}

export interface ChatGeneration {
  readonly id: number;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  finish(): boolean;
}

/** One owner per mounted conversation; no request state is shared between owners. */
export function createGenerationOwner() {
  let current: ChatGeneration | null = null;

  function cancel() {
    const previous = current;
    current = null;
    previous?.controller.abort();
  }

  function begin(): ChatGeneration {
    cancel();
    const controller = new AbortController();
    let running = true;
    const generation: ChatGeneration = {
      id: nextGenerationId(),
      controller,
      signal: controller.signal,
      isCurrent: () => current === generation && !controller.signal.aborted,
      finish: () => {
        if (!generation.isCurrent() || !running) return false;
        running = false;
        return true;
      },
    };
    current = generation;
    return generation;
  }

  return { begin, cancel };
}
