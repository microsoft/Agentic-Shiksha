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
import { parseQuizContent } from "@/lib/quizContract";
import ChallengeBlock from "@/features/chat/ChallengeBlock";
import Markdown from "@/components/common/Markdown";
import { CircuitLaunchCard } from "./CircuitBlock";
import { parseCircuitBlock, type CircuitContentBlock } from "@/lib/circuit";
import { SlidesLaunchCard } from "./SlidesBlock";
import { parseA2UISlidesBlock, SLIDES_INVALID_MESSAGE, type CompleteSlidesBlock } from "@/lib/slides";

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
  (props: Record<string, any>, key: string, onCircuitOpen?: (block: CircuitContentBlock) => void, agentId?: string, readOnly?: boolean, onSlidesOpen?: (block: CompleteSlidesBlock) => void) => React.ReactNode
> = {
  Slides: (props, key, _onCircuitOpen, agentId, readOnly, onSlidesOpen) => {
    const block = parseA2UISlidesBlock(props);
    return block ? <SlidesLaunchCard key={key} block={block} agentId={agentId} allowDownload={!readOnly} onOpen={onSlidesOpen} />
      : <p key={key} role="alert" className="slides-notice">{SLIDES_INVALID_MESSAGE}</p>;
  },
  Circuit: (props, key, onCircuitOpen) => {
    const block = parseCircuitBlock({
      ...props, circuitId: key,
      circuit: { ...props.circuit, grounds: asArray(props.circuit?.grounds), instruments: asArray(props.circuit?.instruments).map((item: any) => ({ ...item, conductors: asArray(item.conductors) })), analysis: { ...props.circuit?.analysis, probes: asArray(props.circuit?.analysis?.probes) } },
      result: { ...props.result, time_seconds: asArray(props.result?.time_seconds), measurements: asArray(props.result?.measurements).map((item: any) => ({ ...item, quantities: asArray(item.quantities), channels: asArray(item.channels) })) },
    });
    return block ? <CircuitLaunchCard key={key} block={block} onOpen={onCircuitOpen} /> : null;
  },
  Quiz: (p, key, _onCircuitOpen, agentId, readOnly) => {
    const quiz = parseQuizContent(p, key);
    return quiz ? <QuizBlock key={quiz.quizId} {...quiz} agentId={agentId} readOnly={readOnly} /> : null;
  },

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

export function A2UISurfaceView({ surface, onCircuitOpen, onSlidesOpen, agentId, readOnly }: { surface: A2UISurface; onCircuitOpen?: (block: CircuitContentBlock) => void; onSlidesOpen?: (block: CompleteSlidesBlock) => void; agentId?: string; readOnly?: boolean }) {
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

  return <>{render(resolveBindings(surface, component), surface.surfaceId, onCircuitOpen, agentId, readOnly, onSlidesOpen)}</>;
}

export function A2UISurfaces({
  surfaces,
  onCircuitOpen,
  onSlidesOpen,
  agentId,
  readOnly,
}: {
  surfaces: Record<string, A2UISurface>;
  onCircuitOpen?: (block: CircuitContentBlock) => void;
  onSlidesOpen?: (block: CompleteSlidesBlock) => void;
  agentId?: string;
  readOnly?: boolean;
}) {
  return (
    <>
      {Object.values(surfaces).map((surface) => (
        <A2UISurfaceView key={surface.surfaceId} surface={surface} onCircuitOpen={onCircuitOpen} onSlidesOpen={onSlidesOpen} agentId={agentId} readOnly={readOnly} />
      ))}
    </>
  );
}

export default A2UISurfaces;
