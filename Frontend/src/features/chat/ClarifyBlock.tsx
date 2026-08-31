import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowRight, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import type { ClarifyQuestion } from "@/lib/types";
import { submitClarification } from "@/features/chat/chatQueryEvent";

// Mirrors clarification_registry.DEFAULT_TIMEOUT_SECONDS on the backend.
const ANSWER_WINDOW_SECONDS = 60;

const answerStoreKey = (clarifyId: string) => `clarify-answers:${clarifyId}`;

/** Answers are replayed on revisit; the agent run they belonged to is long gone. */
function loadStoredAnswers(clarifyId: string): Record<number, string> | null {
  if (!clarifyId) return null;
  try {
    const raw = window.localStorage.getItem(answerStoreKey(clarifyId));
    return raw ? (JSON.parse(raw) as Record<number, string>) : null;
  } catch {
    return null;
  }
}

function storeAnswers(clarifyId: string, answers: Record<number, string>) {
  if (!clarifyId) return;
  try {
    window.localStorage.setItem(answerStoreKey(clarifyId), JSON.stringify(answers));
  } catch {
    // A full or blocked store only costs us the replay, so carry on.
  }
}

export default function ClarifyBlock({
  clarifyId,
  questions,
  createdAt,
  readOnly = false,
}: {
  clarifyId: string;
  questions: ClarifyQuestion[];
  createdAt?: number;
  readOnly?: boolean;
}) {
  const stored = loadStoredAnswers(clarifyId);
  const [answers, setAnswers] = useState<Record<number, string>>(stored ?? {});
  const [index, setIndex] = useState(0);
  const [customAnswer, setCustomAnswer] = useState("");
  const [submitted, setSubmitted] = useState(stored !== null);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  // Reloading a past chat must not reopen the form: the window is measured from
  // when the question was asked, not from when this component mounted.
  const [secondsLeft, setSecondsLeft] = useState(() => {
    if (!createdAt) return ANSWER_WINDOW_SECONDS;
    const elapsed = Math.floor((Date.now() - createdAt) / 1000);
    return Math.max(0, ANSWER_WINDOW_SECONDS - elapsed);
  });

  // The agent only blocks for a fixed window, so stop accepting answers when it lapses.
  useEffect(() => {
    if (submitted || readOnly) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [submitted, readOnly]);

  const expired = secondsLeft <= 0;

  if (questions.length === 0) return null;

  const total = questions.length;
  const current = questions[Math.min(index, total - 1)];

  const finish = (finalAnswers: Record<number, string>) => {
    setSubmitted(true);
    storeAnswers(clarifyId, finalAnswers);
    // Order matters: the agent maps answers back onto its questions by index.
    void submitClarification(
      clarifyId,
      questions.map((_, position) => ({ answer: finalAnswers[position] || "" })),
    ).then((delivered) => {
      if (!delivered) setDeliveryFailed(true);
    });
  };

  // Move to the next unresolved question, or send once every question is resolved.
  const advance = (nextAnswers: Record<number, string>) => {
    setCustomAnswer("");
    const nextIndex = questions.findIndex(
      (_, position) => position !== index && !(position in nextAnswers),
    );
    if (nextIndex === -1) finish(nextAnswers);
    else setIndex(nextIndex);
  };

  const answer = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || readOnly || submitted || expired) return;
    const next = { ...answers, [index]: trimmed };
    setAnswers(next);
    advance(next);
  };

  const skip = () => {
    if (readOnly || submitted || expired) return;
    // A skipped question counts as resolved but contributes no answer.
    const next = { ...answers, [index]: "" };
    setAnswers(next);
    advance(next);
  };

  if (submitted || expired || readOnly) {
    const answered = questions
      .map((entry, position) => ({ entry, answer: answers[position] }))
      .filter((pair) => pair.answer);
    if (answered.length === 0) {
      return (
        <div className="my-3 w-full rounded-3xl border-[1.5px] border-white/[0.05] bg-transparent px-6 py-5">
          <p className="text-[13px] font-light leading-relaxed text-neutral-500">
            No answer given — I went ahead with my best interpretation.
          </p>
        </div>
      );
    }
    return (
      <div className="my-3 w-full rounded-3xl border-[1.5px] border-white/[0.05] bg-transparent px-6 py-5">
        {answered.map((pair, position) => (
          <div key={pair.entry.question} className={clsx(position > 0 && "mt-5")}>
            <p className="text-[13px] font-normal leading-relaxed text-neutral-300">
              {pair.entry.question}
            </p>
            <p className="mt-0.5 text-[13px] font-light leading-relaxed text-neutral-500">
              {pair.answer}
            </p>
          </div>
        ))}
        {deliveryFailed && (
          <p className="mt-4 text-xs text-amber-400">
            This didn't reach me in time — I answered with my best interpretation. Send it as a
            message if you'd like me to redo it.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="my-3 w-full rounded-2xl border border-white/10 bg-neutral-800/70 p-2">
      <div className="flex items-start justify-between gap-3 px-3 pb-1 pt-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-snug text-neutral-100">
            {current.question}
          </p>
          {current.context && (
            <p className="mt-0.5 text-xs text-neutral-400">{current.context}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-neutral-500">
          <span
            className="relative mr-1 inline-flex h-6 w-6 items-center justify-center"
            title="Time left to answer before I continue on my own"
          >
            <svg className="absolute inset-0 h-6 w-6 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/15" />
              <circle
                cx="18" cy="18" r="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 16}
                strokeDashoffset={2 * Math.PI * 16 * (1 - secondsLeft / ANSWER_WINDOW_SECONDS)}
                className={clsx(
                  "transition-[stroke-dashoffset] duration-1000 ease-linear",
                  secondsLeft <= 10 ? "text-amber-400" : "text-white",
                )}
              />
            </svg>
            <span
              className={clsx(
                "text-[10px] font-medium tabular-nums",
                secondsLeft <= 10 ? "text-amber-400" : "text-neutral-200",
              )}
            >
              {secondsLeft}
            </span>
          </span>
          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
                disabled={index === 0}
                aria-label="Previous question"
                className="rounded-md p-1 transition-colors hover:bg-white/5 hover:text-neutral-200 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="text-xs tabular-nums text-neutral-400">
                {index + 1} of {total}
              </span>
              <button
                type="button"
                onClick={() => setIndex((value) => Math.min(total - 1, value + 1))}
                disabled={index === total - 1}
                aria-label="Next question"
                className="rounded-md p-1 transition-colors hover:bg-white/5 hover:text-neutral-200 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-1 flex flex-col">
        {current.options.map((option, position) => {
          const isChosen = answers[index] === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => answer(option)}
              disabled={readOnly}
              aria-pressed={isChosen}
              className={clsx(
                "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                isChosen ? "bg-neutral-700" : !readOnly && "hover:bg-neutral-700/70",
                readOnly && "cursor-not-allowed",
              )}
            >
              {position > 0 && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-3 top-0 h-px bg-white/[0.06] group-hover:opacity-0"
                />
              )}
              <span
                aria-hidden="true"
                className={clsx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                  isChosen
                    ? "bg-neutral-600 text-neutral-100"
                    : "bg-white/[0.04] text-neutral-500 group-hover:bg-neutral-600 group-hover:text-neutral-100",
                )}
              >
                {position + 1}
              </span>
              <span
                className={clsx(
                  "min-w-0 flex-1 truncate text-[15px] transition-colors",
                  isChosen ? "text-neutral-100" : "text-neutral-300 group-hover:text-neutral-100",
                )}
              >
                {option}
              </span>
              <ArrowRight
                aria-hidden="true"
                className={clsx(
                  "h-4 w-4 shrink-0 text-neutral-400 transition-opacity",
                  isChosen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              />
            </button>
          );
        })}
      </div>

      <form
        className="relative flex items-center gap-3 rounded-xl px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          answer(customAnswer);
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 top-0 h-px bg-white/[0.06]"
        />
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-neutral-500"
        >
          <Pencil className="h-3.5 w-3.5" />
        </span>
        <input
          type="text"
          value={customAnswer}
          onChange={(event) => setCustomAnswer(event.target.value)}
          disabled={readOnly}
          placeholder="Something else"
          aria-label="Describe what you need instead"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:cursor-not-allowed"
        />
        {customAnswer.trim() ? (
          <button
            type="submit"
            disabled={readOnly}
            className="shrink-0 rounded-lg bg-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-500"
          >
            Send
          </button>
        ) : (
          <button
            type="button"
            onClick={skip}
            disabled={readOnly}
            className="shrink-0 rounded-lg bg-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-600 disabled:cursor-not-allowed"
          >
            Skip
          </button>
        )}
      </form>
    </div>
  );
}
