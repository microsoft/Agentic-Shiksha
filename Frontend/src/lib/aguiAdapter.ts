/**
 * Drop-in AG-UI transport for the existing chat hook.
 *
 * `streamAgentChatViaAGUI` has the exact same signature as `streamAgentChat`
 * from `@/lib/api`, but talks to the AG-UI endpoint and reconstructs the legacy
 * callbacks from AG-UI events plus A2UI surfaces.
 *
 * This lets `useAgentChat` switch transports with a one-line change while its
 * ~30 content-block callbacks stay untouched.
 */

import type { StreamAgentChatOptions, StreamEvent } from "@/lib/api";
import {
  AGUI,
  KIND_TO_COMPONENT,
  applyA2UIMessage,
  joinChunks,
  resolveBindings,
  streamAgentChatAGUI,
  type A2UISurface,
} from "@/lib/agui";

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return Object.values(value) as T[];
  return [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Find the most recently touched surface rendering the given component type. */
function findSurface(
  surfaces: Record<string, A2UISurface>,
  componentType: string
): A2UISurface | undefined {
  const matches = Object.values(surfaces).filter((surface) =>
    Object.values(surface.components).some(
      (component) => component.componentType === componentType
    )
  );
  return matches[matches.length - 1];
}

/** Resolve a surface's root component props. */
function surfaceProps(surface: A2UISurface | undefined): Record<string, any> {
  if (!surface?.root) return {};
  const component = surface.components[surface.root];
  if (!component) return {};
  return resolveBindings(surface, component);
}

export async function streamAgentChatViaAGUI(
  agent_id: string,
  text: string,
  thread_id: string | null,
  onEvent: (event: StreamEvent) => void,
  options: StreamAgentChatOptions
): Promise<void> {
  let surfaces: Record<string, A2UISurface> = {};

  // Tracks text already forwarded per surface so we can emit incremental deltas.
  const emitted: Record<string, string> = {};
  // Tracks document titles already forwarded, to avoid duplicate callbacks.
  const sentTitles: Record<string, string> = {};

  const startCallbacks: Record<string, (() => void) | undefined> = {
    quiz: options.onQuizStart,
    flashcard: options.onFlashcardStart,
    challenge: options.onChallengeStart,
    document: options.onDocumentStart,
    message_block: options.onMessageBlockStart,
    tikz_image: options.onTikzImageStart,
    sympy_image: options.onTikzImageStart,
    generated_image: options.onGeneratedImageStart,
  };

  const emitComplete = (kind: string) => {
    const componentType = KIND_TO_COMPONENT[kind];
    if (!componentType) return;
    const props = surfaceProps(findSurface(surfaces, componentType));

    switch (kind) {
      case "quiz":
        options.onQuiz?.({
          title: asString(props.title, "Quiz"),
          assessmentType: asString(props.assessmentType, "practice_quiz") as "concept_inventory" | "practice_quiz",
          thresholdConcept: asString(props.thresholdConcept) || undefined,
          questions: asArray(props.questions),
        });
        break;
      case "flashcard":
        options.onFlashcard?.({
          title: asString(props.title, "Flashcards"),
          cards: asArray(props.cards),
        });
        break;
      case "challenge":
        options.onChallenge?.({
          title: asString(props.title, "Challenge"),
          description: asString(props.description),
          difficulty: asString(props.difficulty, "medium"),
          hints: asArray<string>(props.hints),
          solution: asString(props.solution),
          // A2UI carries the tool's snake_case key; the callback expects camelCase.
          challengeType: asString(props.challenge_type, "problem"),
        });
        break;
      case "document":
        options.onDocument?.({
          title: asString(props.title),
          content: asString(props.content),
          doc_type: asString(props.doc_type, "markdown"),
        });
        break;
      case "message_block":
        options.onMessageBlock?.(asString(props.content));
        break;
      case "tikz_image":
      case "sympy_image":
        options.onTikzImage?.({
          title: asString(props.title),
          imageData: asString(props.imageData),
          caption: asString(props.caption),
          visualizationType: asString(props.visualizationType),
        });
        break;
      case "generated_image":
        options.onGeneratedImage?.({
          title: asString(props.title),
          imageData: asString(props.imageData),
          imageUrl: asString(props.imageUrl),
          caption: asString(props.caption),
          size: asString(props.size),
          quality: asString(props.quality),
        });
        break;
      case "clarify":
        options.onClarify?.({
          clarifyId: asString(props.clarifyId),
          questions: asArray<{ question: string; options: string[]; context?: string }>(props.questions),
        });
        break;
      case "suggested_queries":
        options.onSuggestedQueries?.({ queries: asArray<string>(props.queries) });
        break;
      default:
        break;
    }
  };

  /** Emit incremental text/title callbacks for surfaces still streaming. */
  const emitStreamingDeltas = () => {
    for (const surface of Object.values(surfaces)) {
      if (!surface.root) continue;
      const component = surface.components[surface.root];
      if (!component) continue;

      const { componentType } = component;
      if (componentType !== "Document" && componentType !== "MessageBlock") {
        continue;
      }

      const props = resolveBindings(surface, component);

      if (componentType === "Document") {
        const title = asString(props.title);
        if (title && sentTitles[surface.surfaceId] !== title) {
          sentTitles[surface.surfaceId] = title;
          options.onDocumentTitle?.(title);
        }
      }

      // While streaming, text arrives as indexed chunks under `content_chunks`;
      // the final value lands on `content` when the block completes.
      const streamed = joinChunks(surface.dataModel.content_chunks);
      const content = streamed || asString(props.content);
      const already = emitted[surface.surfaceId] ?? "";
      if (content.length > already.length && content.startsWith(already)) {
        const delta = content.slice(already.length);
        emitted[surface.surfaceId] = content;
        if (componentType === "Document") options.onDocumentDelta?.(delta);
        else options.onMessageBlockDelta?.(delta);
      } else if (content !== already) {
        // Non-append rewrite: resync without emitting a bogus delta.
        emitted[surface.surfaceId] = content;
      }
    }
  };

  await streamAgentChatAGUI(
    agent_id,
    {
      text,
      thread_id,
      user_id: options.user_id,
      usage_event_id: options.usage_event_id,
      user_profile: options.user_profile,
      inject_profile: options.inject_profile ?? true,
      research_mode: options.research_mode ?? false,
      web_search_enabled: options.web_search_enabled ?? false,
      image_urls: options.image_urls ?? [],
    },
    {
      onEvent: (event) => {
        switch (event.type) {
          case AGUI.RUN_STARTED:
            onEvent({ type: "thread_id", thread_id: event.threadId });
            break;

          case AGUI.TEXT_MESSAGE_CONTENT:
            onEvent({ type: "delta", content: event.delta ?? "" });
            break;

          case AGUI.STEP_STARTED:
            startCallbacks[event.stepName]?.();
            break;

          case AGUI.STEP_FINISHED:
            emitComplete(event.stepName);
            break;

          case AGUI.CUSTOM:
            if (event.name === "citations") {
              const citations = asArray<NonNullable<StreamEvent["citations"]>[number]>(
                event.value,
              );
              options.onCitations?.(citations);
              onEvent({ type: "citations", citations });
            } else if (event.name === "usage") {
              onEvent({ type: "usage", ...(event.value ?? {}) });
            } else if (event.name === "tool_status") {
              const tool = (event.value as { tool?: string } | undefined)?.tool;
              if (tool) options.onToolStart?.(tool);
            } else if (event.name === "block_cancel") {
              const tool = (event.value as { tool?: string } | undefined)?.tool;
              options.onBlockCancel?.(tool);
            }
            break;

          case AGUI.RUN_FINISHED:
            onEvent({ type: "done", thread_id: event.threadId });
            break;

          case AGUI.RUN_ERROR:
            onEvent({ type: "error", error: event.message });
            break;

          default:
            break;
        }
      },

      onSurfaces: (next) => {
        surfaces = next;
        emitStreamingDeltas();
      },
    },
    options.signal
  );
}

/**
 * Apply an A2UI message to a surface map.
 * Re-exported so callers can build their own surface state if needed.
 */
export { applyA2UIMessage };
