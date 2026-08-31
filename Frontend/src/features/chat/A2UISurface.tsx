/**
 * A2UI renderer for EKALAIVA's custom catalog.
 *
 * A2UI surfaces describe *what* to render; this module decides *how*, by
 * mapping each catalog component type to the existing React block. The agent
 * can only request types present in this registry — anything else is ignored,
 * which is the security guarantee A2UI's catalog model is built on.
 */

import React from "react";
import type { A2UISurface } from "@/lib/agui";
import { resolveBindings } from "@/lib/agui";
import QuizBlock from "@/features/chat/QuizBlock";
import FlashcardBlock from "@/features/chat/FlashcardBlock";
import ChallengeBlock from "@/features/chat/ChallengeBlock";
import Markdown from "@/components/common/Markdown";

/** Coerce a decoded data-model value into an array. */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return Object.values(value) as T[];
  return [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Registry of trusted component types. Keys must match the backend catalog. */
const REGISTRY: Record<
  string,
  (props: Record<string, any>, key: string) => React.ReactNode
> = {
  Quiz: (p, key) => (
    <QuizBlock
      key={key}
      quizId={key}
      title={asString(p.title, "Quiz")}
      questions={asArray(p.questions)}
      assessmentType={asString(p.assessmentType, "practice_quiz") as "concept_inventory" | "practice_quiz"}
      thresholdConcept={asString(p.thresholdConcept) || undefined}
    />
  ),

  Flashcard: (p, key) => (
    <FlashcardBlock
      key={key}
      flashcardId={key}
      title={asString(p.title, "Flashcards")}
      cards={asArray(p.cards)}
    />
  ),

  Challenge: (p, key) => (
    <ChallengeBlock
      key={key}
      challengeId={key}
      title={asString(p.title, "Challenge")}
      description={asString(p.description)}
      difficulty={asString(p.difficulty, "medium")}
      hints={asArray<string>(p.hints)}
      solution={asString(p.solution)}
      challengeType={asString(p.challenge_type, "problem")}
    />
  ),

  Document: (p, key) => (
    <div key={key} className="my-3">
      {p.title ? (
        <div className="mb-2 text-sm font-semibold text-white/80">{p.title}</div>
      ) : null}
      <Markdown>{asString(p.content)}</Markdown>
    </div>
  ),

  MessageBlock: (p, key) => (
    <Markdown key={key}>{asString(p.content)}</Markdown>
  ),

  DiagramImage: (p, key) => {
    const imageData = asString(p.imageData);
    if (!imageData) return null;
    return (
      <figure key={key} className="my-3">
        <img
          src={`data:image/png;base64,${imageData}`}
          alt={asString(p.title) || asString(p.caption) || "Diagram"}
        />
        {p.caption ? (
          <figcaption className="mt-1 text-xs text-white/60">{p.caption}</figcaption>
        ) : null}
      </figure>
    );
  },
};

export function A2UISurfaceView({ surface }: { surface: A2UISurface }) {
  if (!surface.ready || !surface.root) return null;

  const component = surface.components[surface.root];
  if (!component) return null;

  const render = REGISTRY[component.componentType];
  if (!render) {
    console.warn(
      `[A2UI] component type "${component.componentType}" is not in the catalog registry`
    );
    return null;
  }

  return <>{render(resolveBindings(surface, component), surface.surfaceId)}</>;
}

export function A2UISurfaces({
  surfaces,
}: {
  surfaces: Record<string, A2UISurface>;
}) {
  return (
    <>
      {Object.values(surfaces).map((surface) => (
        <A2UISurfaceView key={surface.surfaceId} surface={surface} />
      ))}
    </>
  );
}

export default A2UISurfaces;
