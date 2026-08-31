// src/components/assets/AssetContent.tsx
// Renders a saved asset with the same blocks the student saw, instead of raw JSON.

import { Check, X } from "lucide-react";
import clsx from "clsx";
import DocumentWithSectionRail from "@/components/assets/DocumentWithSectionRail";
import QuizBlock, { type QuizSubmitState } from "@/features/chat/QuizBlock";
import FlashcardBlock from "@/features/chat/FlashcardBlock";
import ChallengeBlock from "@/features/chat/ChallengeBlock";
import {
  parseAssetPayload,
  type AssetPayload,
} from "@/components/assets/assetPayload";

function ConceptInventoryAttempt({ attempt }: { attempt: AssetPayload }) {
  const score = attempt.score ?? 0;
  const total = attempt.totalQuestions ?? attempt.answers?.length ?? 0;
  return (
    <div>
      <section className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-neutral-800 pb-3">
        <p className="text-sm font-medium text-neutral-300">Concept inventory</p>
        <span className="text-neutral-700" aria-hidden="true">·</span>
        <time className="text-xs text-neutral-500" dateTime={attempt.submittedAt}>
          {attempt.submittedAt
            ? new Date(attempt.submittedAt).toLocaleString()
            : "Submission time unavailable"}
        </time>
        <span className="ml-auto text-lg font-semibold tabular-nums text-neutral-100">
          {score}/{total}
        </span>
      </section>

      <div className="space-y-3">
        {(attempt.answers ?? []).map((answer, index) => (
          <section
            key={`${index}-${answer.question ?? "question"}`}
            className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4"
          >
            <div className="flex items-start gap-3">
              {answer.isCorrect ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              )}
              <p className="text-sm text-neutral-200">{answer.question}</p>
            </div>
            <dl className="mt-3 space-y-1.5 pl-7 text-xs">
              <div className="flex gap-2">
                <dt className="shrink-0 text-neutral-500">Answered</dt>
                <dd
                  className={clsx(
                    answer.isCorrect ? "text-emerald-300" : "text-rose-300",
                  )}
                >
                  {(answer.selectedOptions ?? []).join(", ") || "No answer"}
                </dd>
              </div>
              {!answer.isCorrect && (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-neutral-500">Correct</dt>
                  <dd className="text-neutral-300">
                    {(answer.correctOptions ?? []).join(", ") || "—"}
                  </dd>
                </div>
              )}
              {answer.reason && (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-neutral-500">Reasoning</dt>
                  <dd className="text-neutral-400">{answer.reason}</dd>
                </div>
              )}
              {answer.explanation && (
                <p className="pt-1 text-neutral-500">{answer.explanation}</p>
              )}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

export function AssetContent({
  content,
  title,
  id,
  interactive = false,
  embedded = interactive,
  agentId,
  threadId,
  quizSubmitFormId,
  onQuizSubmitStateChange,
}: {
  content: string;
  title?: string;
  id?: string;
  /** Live chat quizzes stay answerable; saved assets are reviewed read-only. */
  interactive?: boolean;
  /** Panel layout, independent of answerability — a read-only shared chat still wants it. */
  embedded?: boolean;
  agentId?: string;
  threadId?: string;
  quizSubmitFormId?: string;
  onQuizSubmitStateChange?: (state: QuizSubmitState) => void;
}) {
  const trimmed = (content || "").trim();
  // Only JSON payloads carry structured assets; everything else is markdown.
  if (trimmed.startsWith("{")) {
    const parsed = parseAssetPayload(trimmed);

    if (parsed) {
      const firstAttempt = parsed.firstAttempt
        ?? (parsed.recordType === "concept_inventory_first_attempt" ? parsed : undefined);
      if (firstAttempt) {
        return <ConceptInventoryAttempt attempt={firstAttempt} />;
      }
      const quiz = parsed.quiz ?? parsed;
      if (Array.isArray(quiz.questions)) {
        return (
          <QuizBlock
            quizId={quiz.quizId || id || "asset-quiz"}
            title={quiz.title || title || "Quiz"}
            questions={quiz.questions}
            assessmentType={quiz.assessmentType}
            agentId={interactive ? agentId : undefined}
            threadId={interactive ? threadId : undefined}
            readOnly={!interactive}
            embedded={embedded}
            submitFormId={quizSubmitFormId}
            onSubmitStateChange={onQuizSubmitStateChange}
          />
        );
      }
      if (Array.isArray(parsed.cards)) {
        return (
          <FlashcardBlock
            flashcardId={parsed.flashcardId || id || "asset-flashcards"}
            title={parsed.title || title || "Flashcards"}
            cards={parsed.cards}
          />
        );
      }
      if (typeof parsed.solution === "string") {
        return (
          <ChallengeBlock
            key={parsed.challengeId || id || "asset-challenge"}
            challengeId={parsed.challengeId || id || "asset-challenge"}
            title={parsed.title || title || "Challenge"}
            description={parsed.description || ""}
            difficulty={parsed.difficulty || "medium"}
            hints={parsed.hints}
            solution={parsed.solution}
            challengeType={parsed.challengeType}
            embedded={embedded}
          />
        );
      }
      return (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-950 p-4 text-xs text-neutral-300">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    }
  }

  return <DocumentWithSectionRail content={content} title={title} />;
}

export default AssetContent;
