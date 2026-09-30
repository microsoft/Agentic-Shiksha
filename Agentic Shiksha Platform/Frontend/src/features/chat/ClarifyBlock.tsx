import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowRight, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import type { ClarifyQuestion } from "@/lib/types";
import {
  CLARIFICATION_SUBMITTED_EVENT, ClarificationError, extendClarification,
  getClarificationState, notifyClarificationFinished, saveClarificationDraft,
  submitClarification, type ClarificationState,
} from "@/features/chat/chatQueryEvent";

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
  readOnly = false,
}: {
  clarifyId: string;
  questions: ClarifyQuestion[];
  readOnly?: boolean;
}) {
  const stored = loadStoredAnswers(clarifyId);
  const [answers, setAnswers] = useState<Record<number, string>>(stored ?? {});
  const [confirmedAnswers, setConfirmedAnswers] = useState<Record<number, string>>(stored ?? {});
  const [index, setIndex] = useState(0);
  const [customAnswer, setCustomAnswer] = useState("");
  const [submitted, setSubmitted] = useState(stored !== null);
  const [closed, setClosed] = useState(false);
  const [timing, setTiming] = useState<ClarificationState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAction, setRetryAction] = useState<"load" | "draft" | "submit">("load");
  const [loadAttempt, setLoadAttempt] = useState(0);

  const applyTiming = useCallback((state: ClarificationState) => {
    setClockOffset(state.server_now_ms - Date.now());
    setNow(Date.now());
    setTiming(state);
    const saved: Record<number, string> = {};
    state.answers.forEach((entry, position) => { if (entry.answer) saved[position] = entry.answer; });
    setConfirmedAnswers(saved);
    setAnswers(currentAnswers => ({ ...saved, ...currentAnswers }));
  }, []);

  const reportError = useCallback((failure: unknown) => {
    if (failure instanceof ClarificationError && failure.status === 410) {
      setClosed(true);
      notifyClarificationFinished(clarifyId);
    } else {
      setError(failure instanceof Error ? failure.message : "The clarification could not be updated. Please retry.");
    }
  }, [clarifyId]);

  const serverNow = now + clockOffset;
  const choosing = !!timing && serverNow >= timing.answer_deadline_ms;
  const expired = !!timing && serverNow >= timing.decision_deadline_ms;
  const secondsLeft = timing ? Math.max(0, Math.ceil(
    ((choosing ? timing.decision_deadline_ms : timing.answer_deadline_ms) - serverNow) / 1000,
  )) : 0;

  useEffect(() => {
    if (submitted || closed || readOnly) return;
    const controller = new AbortController();
    setError("");
    getClarificationState(clarifyId, controller.signal).then(state => {
      if (!controller.signal.aborted) applyTiming(state);
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setRetryAction("load");
        reportError(failure);
      }
    });
    return () => controller.abort();
  }, [clarifyId, submitted, closed, readOnly, loadAttempt, expired, applyTiming, reportError]);

  useEffect(() => {
    if (submitted || closed || readOnly) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [submitted, closed, readOnly]);

  useEffect(() => {
    const onFinished = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.clarifyId === clarifyId) setClosed(true);
    };
    window.addEventListener(CLARIFICATION_SUBMITTED_EVENT, onFinished);
    return () => window.removeEventListener(CLARIFICATION_SUBMITTED_EVENT, onFinished);
  }, [clarifyId]);

  useEffect(() => {
    if (closed && !submitted && !readOnly) storeAnswers(clarifyId, confirmedAnswers);
  }, [closed, submitted, readOnly, clarifyId, confirmedAnswers]);

  if (questions.length === 0) return null;

  const total = questions.length;
  const current = questions[Math.min(index, total - 1)];
  const disabled = busy || !timing || expired || closed || readOnly || submitted;

  const save = async (nextAnswers: Record<number, string>, finish: boolean) => {
    setBusy(true);
    setError("");
    setRetryAction(finish ? "submit" : "draft");
    try {
      const ordered = questions.map((_, position) => ({ answer: nextAnswers[position] || "" }));
      if (finish) {
        await submitClarification(clarifyId, ordered);
        storeAnswers(clarifyId, nextAnswers);
        setConfirmedAnswers(nextAnswers);
        setSubmitted(true);
      } else {
        applyTiming(await saveClarificationDraft(clarifyId, ordered));
      }
    } catch (failure) {
      reportError(failure);
    } finally {
      setBusy(false);
    }
  };

  const moreTime = async () => {
    if (!timing || busy || expired) return;
    setBusy(true);
    setError("");
    setRetryAction("load");
    try {
      applyTiming(await extendClarification(clarifyId, timing.revision));
    } catch (failure) {
      reportError(failure);
    } finally {
      setBusy(false);
    }
  };

  const advance = (nextAnswers: Record<number, string>) => {
    setCustomAnswer("");
    const nextIndex = questions.findIndex(
      (_, position) => position !== index && !(position in nextAnswers),
    );
    if (nextIndex !== -1) setIndex(nextIndex);
    void save(nextAnswers, nextIndex === -1);
  };

  const answer = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    const next = { ...answers, [index]: trimmed };
    setAnswers(next);
    advance(next);
  };

  const skip = () => {
    if (disabled) return;
    // A skipped question counts as resolved but contributes no answer.
    const next = { ...answers, [index]: "" };
    setAnswers(next);
    advance(next);
  };

  if (submitted || closed || readOnly) {
    const displayedAnswers = closed && !submitted ? confirmedAnswers : answers;
    const answered = questions
      .map((entry, position) => ({ entry, answer: displayedAnswers[position] }))
      .filter((pair) => pair.answer);
    if (answered.length === 0) {
      return (
        <div className="my-3 w-full rounded-3xl border-[1.5px] border-white/[0.05] bg-transparent px-6 py-5">
          <p className="text-[13px] font-light leading-relaxed text-neutral-500">
            This clarification is closed. You can send any additional details in chat.
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
        {closed && !submitted && !readOnly && (
          <p className="mt-4 text-xs text-amber-400">
            The answer window has closed. Saved answers are used with defaults for any unanswered questions.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="my-3 w-full rounded-2xl border border-white/10 bg-neutral-800/70 p-2">
      {!timing && !error && <p role="status" className="px-3 py-2 text-xs text-neutral-400">Checking answer time...</p>}
      {expired && !error && <p role="status" className="px-3 py-2 text-xs text-neutral-400">Checking clarification status...</p>}
      {choosing && !expired && timing && (
        <div role="group" aria-label="More time to answer" className="mx-1 mb-2 space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
          <p className="text-sm font-medium text-neutral-100">Need more time?</p>
          <p className="text-xs leading-relaxed text-neutral-400">
            Continue with your saved answers and defaults for the rest, or take another {timing.answer_window_seconds} seconds.
            If you do not choose, I will continue in {secondsLeft} seconds.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void save(answers, true)}
              className="rounded-lg border border-neutral-600 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50">
              Continue with defaults
            </button>
            <button type="button" disabled={busy} onClick={() => void moreTime()}
              className="rounded-lg bg-neutral-200 px-3 py-2 text-xs font-medium text-neutral-900 hover:bg-white disabled:opacity-50">
              Give me {timing.answer_window_seconds} more seconds
            </button>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="mx-1 mb-2 rounded-xl border border-amber-400/20 px-3 py-2 text-xs text-amber-300">
          <p>{error}</p>
          <button type="button" disabled={busy} className="mt-2 underline disabled:opacity-50" onClick={() => {
            if (retryAction === "load") setLoadAttempt(value => value + 1);
            else void save(answers, retryAction === "submit");
          }}>{retryAction === "load" ? "Recheck timer" : "Retry saving answers"}</button>
        </div>
      )}
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
            role="timer"
            aria-label={choosing ? "Time left to choose more time" : "Time left to answer"}
            title={choosing ? "Choose defaults or more time before this countdown ends" : "Time left before the extra-time choice"}
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
                strokeDashoffset={2 * Math.PI * 16 * (1 - secondsLeft / (timing ? choosing ? timing.decision_window_seconds : timing.answer_window_seconds : 60))}
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
              {timing ? secondsLeft : "--"}
            </span>
          </span>
          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
                disabled={busy || index === 0}
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
                disabled={busy || index === total - 1}
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
              disabled={disabled}
              aria-pressed={isChosen}
              className={clsx(
                "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                isChosen ? "bg-neutral-700" : !readOnly && "hover:bg-neutral-700/70",
                disabled && "cursor-not-allowed opacity-50",
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
          disabled={disabled}
          maxLength={4000}
          placeholder="Something else"
          aria-label="Describe what you need instead"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:cursor-not-allowed"
        />
        {customAnswer.trim() ? (
          <button
            type="submit"
            disabled={disabled}
            className="shrink-0 rounded-lg bg-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-500"
          >
            Send
          </button>
        ) : (
          <button
            type="button"
            onClick={skip}
            disabled={disabled}
            className="shrink-0 rounded-lg bg-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-600 disabled:cursor-not-allowed"
          >
            Skip
          </button>
        )}
      </form>
    </div>
  );
}
