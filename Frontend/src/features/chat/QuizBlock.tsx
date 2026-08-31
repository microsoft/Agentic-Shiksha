import { useState, useMemo, useEffect, useId, useRef, useCallback } from "react";
import clsx from "clsx";
import { Check, X, ChevronLeft, ChevronRight, Trophy, RotateCcw, Lightbulb, Eye, MessageSquareText } from "lucide-react";
import { chatApi } from "@/lib/chatApi";
import { useUserStore } from "@/lib/userStore";

export type QuizQuestion = {
  question: string;
  options: string[];
  correct: number | number[];
  explanation: string;
  targetsMisconception?: string;
};

export type QuizSubmitState = {
  disabled: boolean;
  label: string;
  visible: boolean;
};

type QuizBlockProps = {
  quizId: string;
  title: string;
  questions: QuizQuestion[];
  assessmentType?: "concept_inventory" | "practice_quiz";
  thresholdConcept?: string;
  agentId?: string;
  threadId?: string;
  readOnly?: boolean;
  embedded?: boolean;
  submitFormId?: string;
  onSubmitStateChange?: (state: QuizSubmitState) => void;
};

type QuestionState = {
  selected: Set<number>;
  reason: string;
  submitted: boolean;
};

// Only unsubmitted attempts are cached; correct answers are never stored.
type StoredQuizProgress = {
  version: number;
  questionCount: number;
  currentIndex: number;
  answers: Array<{ selected: number[]; reason: string }>;
  shuffleMap: number[][];
};

const QUIZ_PROGRESS_VERSION = 1;

/** Whether a question has multiple correct answers */
function isMultiCorrect(q: QuizQuestion): boolean {
  return Array.isArray(q.correct);
}

/** Get correct indices as a Set */
function correctSet(q: QuizQuestion): Set<number> {
  return new Set(Array.isArray(q.correct) ? q.correct : [q.correct]);
}

/** Check if user's selected answers match the correct answers exactly */
function isAnswerCorrect(q: QuizQuestion, selected: Set<number>): boolean {
  const correct = correctSet(q);
  if (selected.size !== correct.size) return false;
  for (const idx of selected) {
    if (!correct.has(idx)) return false;
  }
  return true;
}

// Fisher-Yates shuffle — returns a shuffled array of original indices
function shuffleIndices(length: number): number[] {
  const arr = Array.from({ length }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Options are shuffled, so any letter the model baked into the text would contradict the badge.
function stripOptionLabel(option: string): string {
  return (option || "").replace(/^\s*\(?([A-Ha-h])\s*[.):\-\u2013\u2014]\s+/, "").trim() || option;
}

function findVerticalScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }
  return null;
}

export default function QuizBlock({
  quizId,
  title,
  questions,
  assessmentType = "practice_quiz",
  thresholdConcept,
  agentId,
  threadId,
  readOnly,
  embedded = false,
  submitFormId,
  onSubmitStateChange,
}: QuizBlockProps) {
  const reasonInputId = useId();
  const questionNavRef = useRef<HTMLElement>(null);
  const questionSectionRefs = useRef<Array<HTMLElement | null>>([]);
  const [questionScrollContainer, setQuestionScrollContainer] = useState<HTMLElement | null>(null);
  const userId = useUserStore((state) => state.userId);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questionStates, setQuestionStates] = useState<QuestionState[]>(
    () => questions.map(() => ({ selected: new Set<number>(), reason: "", submitted: false }))
  );
  const [showResults, setShowResults] = useState(false);
  const [showScoreScreen, setShowScoreScreen] = useState(false);
  const [firstAttemptExists, setFirstAttemptExists] = useState(true);
  const [attemptStatusLoading, setAttemptStatusLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [automaticFeedbackSent, setAutomaticFeedbackSent] = useState(false);
  // shuffleMap[questionIndex] = array of original option indices in display order
  const [shuffleMap, setShuffleMap] = useState<number[][]>(
    () => questions.map((q) => shuffleIndices(q.options.length))
  );

  const registerFirstQuestion = useCallback((element: HTMLElement | null) => {
    questionSectionRefs.current[0] = element;
    setQuestionScrollContainer(element ? findVerticalScrollContainer(element) : null);
  }, []);

  // Re-sync questionStates when questions array changes (e.g. after streaming fills it in)
  useEffect(() => {
    setQuestionStates((prev) => {
      if (prev.length === questions.length) return prev;
      return Array.from(
        { length: questions.length },
        (_, i) => prev[i] || { selected: new Set<number>(), reason: "", submitted: false },
      );
    });
  }, [questions.length]);

  const progressStorageKey = useMemo(
    () => (quizId ? `ekalaiva:quiz-progress:${userId || "anon"}:${quizId}` : null),
    [quizId, userId],
  );
  const hasRestoredProgressRef = useRef(false);

  // Restore an unsubmitted attempt so answers survive closing the panel.
  useEffect(() => {
    if (hasRestoredProgressRef.current) return;
    if (!progressStorageKey || readOnly || questions.length === 0) return;
    hasRestoredProgressRef.current = true;

    let stored: StoredQuizProgress | null = null;
    try {
      const raw = window.localStorage.getItem(progressStorageKey);
      stored = raw ? (JSON.parse(raw) as StoredQuizProgress) : null;
    } catch {
      stored = null;
    }
    if (
      !stored
      || stored.version !== QUIZ_PROGRESS_VERSION
      || stored.questionCount !== questions.length
      || !Array.isArray(stored.answers)
    ) return;

    setQuestionStates(questions.map((question, index) => {
      const answer = stored.answers[index];
      const selected = Array.isArray(answer?.selected)
        ? answer.selected.filter((option) => option >= 0 && option < question.options.length)
        : [];
      return {
        selected: new Set<number>(selected),
        reason: typeof answer?.reason === "string" ? answer.reason : "",
        submitted: false,
      };
    }));
    if (Array.isArray(stored.shuffleMap) && stored.shuffleMap.length === questions.length) {
      setShuffleMap(stored.shuffleMap);
    }
    setCurrentIndex(Math.min(Math.max(stored.currentIndex ?? 0, 0), questions.length - 1));
  }, [progressStorageKey, questions, readOnly]);

  // Persist while in progress; drop the cache once results are revealed or answers are cleared.
  useEffect(() => {
    if (!progressStorageKey || readOnly || !hasRestoredProgressRef.current) return;

    const hasProgress = questionStates.some(
      (questionState) => questionState.selected.size > 0 || questionState.reason.trim().length > 0,
    );
    try {
      if (showResults || !hasProgress) {
        window.localStorage.removeItem(progressStorageKey);
        return;
      }
      window.localStorage.setItem(progressStorageKey, JSON.stringify({
        version: QUIZ_PROGRESS_VERSION,
        questionCount: questionStates.length,
        currentIndex,
        answers: questionStates.map((questionState) => ({
          selected: Array.from(questionState.selected),
          reason: questionState.reason,
        })),
        shuffleMap,
      } satisfies StoredQuizProgress));
    } catch {
      // Storage unavailable (private mode or quota) — progress simply won't persist.
    }
  }, [progressStorageKey, readOnly, questionStates, currentIndex, shuffleMap, showResults]);

  useEffect(() => {
    const navigation = questionNavRef.current;
    const activeButton = navigation
      ?.querySelector<HTMLElement>(`[data-question-index="${currentIndex}"]`);
    if (!navigation || !activeButton) return;

    const navigationBounds = navigation.getBoundingClientRect();
    const buttonBounds = activeButton.getBoundingClientRect();
    if (buttonBounds.top < navigationBounds.top) {
      navigation.scrollTop -= navigationBounds.top - buttonBounds.top;
    } else if (buttonBounds.bottom > navigationBounds.bottom) {
      navigation.scrollTop += buttonBounds.bottom - navigationBounds.bottom;
    }
  }, [currentIndex]);

  useEffect(() => {
    if (!embedded || showScoreScreen || !questionScrollContainer) return;

    const syncActiveQuestion = () => {
      const remainingScroll = questionScrollContainer.scrollHeight
        - questionScrollContainer.clientHeight
        - questionScrollContainer.scrollTop;
      if (remainingScroll <= 2) {
        setCurrentIndex(Math.max(0, questions.length - 1));
        return;
      }

      const activationTop = questionScrollContainer.getBoundingClientRect().top + 24;
      let nextIndex = 0;
      questionSectionRefs.current.forEach((section, index) => {
        if (section && section.getBoundingClientRect().top <= activationTop) {
          nextIndex = index;
        }
      });
      setCurrentIndex((previous) => previous === nextIndex ? previous : nextIndex);
    };

    syncActiveQuestion();
    questionScrollContainer.addEventListener("scroll", syncActiveQuestion, { passive: true });
    return () => questionScrollContainer.removeEventListener("scroll", syncActiveQuestion);
  }, [embedded, questionScrollContainer, questions.length, showScoreScreen]);

  useEffect(() => {
    let cancelled = false;
    setSubmitError("");
    setAutomaticFeedbackSent(false);

    if (readOnly || !userId || !agentId || !quizId) {
      setFirstAttemptExists(true);
      setAttemptStatusLoading(false);
      return;
    }

    setAttemptStatusLoading(true);
    chatApi.getFirstQuizAttemptStatus(userId, agentId, quizId)
      .then((result) => {
        if (!cancelled) setFirstAttemptExists(result.exists);
      })
      .catch(() => {
        if (!cancelled) setFirstAttemptExists(false);
      })
      .finally(() => {
        if (!cancelled) setAttemptStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, quizId, readOnly, userId]);

  const current = questions[currentIndex];
  const state = questionStates[currentIndex];
  const totalQuestions = questions.length;

  const score = useMemo(() => {
    return questionStates.filter(
      (s, i) => questions[i] && isAnswerCorrect(questions[i], s.selected)
    ).length;
  }, [questionStates, questions]);

  const isQuestionComplete = (questionState: QuestionState) =>
    questionState.selected.size > 0 && questionState.reason.trim().length > 0;
  const currentComplete = state ? isQuestionComplete(state) : false;
  const allComplete = questionStates.length > 0 && questionStates.every(isQuestionComplete);

  useEffect(() => {
    if (!embedded || !onSubmitStateChange) return;
    onSubmitStateChange({
      disabled: !allComplete || attemptStatusLoading || isSubmitting,
      visible: !showScoreScreen,
      label: isSubmitting
        ? "Submitting..."
        : attemptStatusLoading
          ? "Checking..."
          : showResults
            ? "View Results"
            : "Submit",
    });
  }, [allComplete, attemptStatusLoading, embedded, isSubmitting, onSubmitStateChange, showResults, showScoreScreen]);

  // Guard: if questions haven't loaded yet, show loading state
  if (!current || !state) {
    return (
      <div
        className={clsx(
          "overflow-hidden",
          embedded ? "w-full bg-transparent" : "rounded-xl border border-white/40 bg-neutral-900/80",
        )}
      >
        <div className={clsx("py-3 border-b", embedded ? "border-neutral-800" : "px-5 bg-neutral-800/50 border-white/40")}>
          <h3 className="text-sm font-semibold text-neutral-200">{title}</h3>
        </div>
        <div className={clsx("py-5 flex items-center gap-2 text-neutral-400 text-sm", !embedded && "px-5")}>
          <svg className="animate-spin h-4 w-4 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Generating quiz…
        </div>
      </div>
    );
  }

  const handleSelect = (questionIndex: number, optionIndex: number) => {
    if (showResults) return;
    setSubmitError("");
    setQuestionStates((prev) => {
      const updated = [...prev];
      const question = questions[questionIndex];
      const cur = updated[questionIndex];
      if (!question || !cur) return prev;
      const newSelected = new Set(cur.selected);
      if (isMultiCorrect(question)) {
        // Toggle for multi-correct questions
        if (newSelected.has(optionIndex)) {
          newSelected.delete(optionIndex);
        } else {
          newSelected.add(optionIndex);
        }
      } else {
        // Toggle for single-correct questions too
        if (newSelected.has(optionIndex)) {
          newSelected.delete(optionIndex);
        } else {
          newSelected.clear();
          newSelected.add(optionIndex);
        }
      }
      updated[questionIndex] = { ...cur, selected: newSelected };
      return updated;
    });
  };

  const revealResults = () => {
    setQuestionStates((prev) => prev.map((s) => ({ ...s, submitted: true })));
    setShowResults(true);
    setShowScoreScreen(true);
  };

  const handleReasonChange = (questionIndex: number, reason: string) => {
    setQuestionStates((prev) => {
      const updated = [...prev];
      const questionState = updated[questionIndex];
      if (!questionState) return prev;
      updated[questionIndex] = { ...questionState, reason };
      return updated;
    });
  };

  const scrollToQuestion = (questionIndex: number) => {
    setCurrentIndex(questionIndex);
    const question = questionSectionRefs.current[questionIndex];
    if (!question) return;
    const scrollContainer = findVerticalScrollContainer(question);
    if (!scrollContainer) return;

    const questionOffset = question.getBoundingClientRect().top
      - scrollContainer.getBoundingClientRect().top
      + scrollContainer.scrollTop;
    scrollContainer.scrollTop = Math.max(0, questionOffset - 16);
  };

  const handleViewAnswers = () => {
    setShowScoreScreen(false);
    setCurrentIndex(0);
  };

  const handleViewScore = () => {
    setShowScoreScreen(true);
  };

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const handleReset = () => {
    setQuestionStates(questions.map(() => ({ selected: new Set<number>(), reason: "", submitted: false })));
    setShuffleMap(questions.map((q) => shuffleIndices(q.options.length)));
    setCurrentIndex(0);
    setShowResults(false);
    setShowScoreScreen(false);
    setAutomaticFeedbackSent(false);
    setSubmitError("");
  };

  const feedbackAnswers = () => questions.map((question, index) => {
    const selected = questionStates[index].selected;
    const userAnswers = selected.size > 0
      ? Array.from(selected).map((option) => question.options[option])
      : ["(skipped)"];
    const correctAnswers = Array.from(correctSet(question)).map(
      (option) => question.options[option],
    );
    return {
      question: question.question,
      userAnswer: userAnswers.join(", "),
      reason: questionStates[index].reason.trim(),
      correctAnswer: correctAnswers.join(", "),
    };
  });

  const dispatchFeedback = (automatic: boolean) => {
    window.dispatchEvent(new CustomEvent("quiz-feedback", {
      detail: {
        quizId,
        agentId,
        threadId,
        title,
        answers: feedbackAnswers(),
        automatic,
      },
    }));
  };

  const handleSubmitOrShowResults = async () => {
    if (!allComplete || attemptStatusLoading || isSubmitting) return;

    if (firstAttemptExists || readOnly || !userId || !agentId) {
      revealResults();
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    try {
      const result = await chatApi.submitFirstQuizAttempt({
        userId,
        quizId,
        title,
        agentId,
        threadId,
        assessmentType,
        thresholdConcept,
        answers: questions.map((question, index) => ({
          question: question.question,
          options: question.options,
          selected: Array.from(questionStates[index].selected).sort((a, b) => a - b),
          correct: Array.from(correctSet(question)).sort((a, b) => a - b),
          reason: questionStates[index].reason.trim(),
          explanation: question.explanation,
          targetsMisconception: question.targetsMisconception,
        })),
      });
      setFirstAttemptExists(true);
      setAutomaticFeedbackSent(result.created);
      revealResults();
      if (result.created) dispatchFeedback(true);
    } catch (err) {
      // Swallowing this left submit failures undiagnosable; the server explains
      // exactly which question it rejected.
      console.error("[Quiz] First attempt submit failed:", err);
      const detail = err instanceof Error ? err.message.trim() : "";
      setSubmitError(
        detail
          ? `Could not submit: ${detail}`
          : "Your first attempt could not be submitted. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!questions.length) return null;

  const renderQuestionContent = (question: QuizQuestion, questionIndex: number) => {
    const questionState = questionStates[questionIndex];
    if (!questionState) return null;

    return (
      <>
        <p className="mb-1 text-[15px] font-medium text-neutral-200">{question.question}</p>
        {isMultiCorrect(question) && !showResults ? (
          <p className="mb-4 text-xs italic text-neutral-400">Select all that apply</p>
        ) : (
          <div className="mb-4" />
        )}

        <div className="flex flex-col gap-2.5">
          {(shuffleMap[questionIndex] || question.options.map((_, index) => index)).map((originalIndex, displayIndex) => {
            const option = question.options[originalIndex];
            const isSelected = questionState.selected.has(originalIndex);
            const correctAnswers = correctSet(question);
            const showCorrect = showResults && correctAnswers.has(originalIndex);
            const showWrong = showResults && isSelected && !correctAnswers.has(originalIndex);

            return (
              <button
                key={originalIndex}
                type="button"
                onClick={() => handleSelect(questionIndex, originalIndex)}
                disabled={showResults}
                className={clsx(
                  "w-full rounded-lg border px-4 py-3 text-left text-sm transition-all duration-200",
                  !showResults && isSelected && "border-neutral-400 bg-neutral-300 font-medium text-neutral-950",
                  !showResults && !isSelected && "border-white/40 bg-neutral-900/80 text-neutral-300 hover:border-white/60 hover:bg-neutral-800",
                  showCorrect && "border-emerald-500/60 bg-neutral-900/80 text-white",
                  showWrong && "border-red-500/60 bg-neutral-900/80 text-white",
                  showResults && !showCorrect && !showWrong && "border-white/20 bg-neutral-900/50 text-neutral-500",
                )}
              >
                <div className="flex items-center gap-3">
                  {showResults ? (
                    showCorrect ? (
                      <Check className="h-5 w-5 shrink-0 text-emerald-400" strokeWidth={2.5} />
                    ) : showWrong ? (
                      <X className="h-5 w-5 shrink-0 text-red-400" strokeWidth={2.5} />
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/30 text-xs font-medium text-neutral-500">
                        {String.fromCharCode(65 + displayIndex)}
                      </span>
                    )
                  ) : (
                    <span
                      className={clsx(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                        isSelected ? "border-neutral-900 bg-transparent font-medium text-neutral-900" : "border-white/40 text-neutral-400",
                      )}
                      style={isSelected ? { borderWidth: "1.5px" } : undefined}
                    >
                      {String.fromCharCode(65 + displayIndex)}
                    </span>
                  )}
                  <span>{stripOptionLabel(option)}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <label
            htmlFor={`${reasonInputId}-${questionIndex}`}
            className="mb-2 block text-xs font-medium text-neutral-300"
          >
            Reason for your choice
            <span className="ml-1 font-normal text-neutral-500">(required)</span>
          </label>
          <textarea
            id={`${reasonInputId}-${questionIndex}`}
            value={questionState.reason}
            onChange={(event) => handleReasonChange(questionIndex, event.target.value)}
            disabled={showResults}
            required
            aria-required="true"
            rows={3}
            maxLength={800}
            placeholder="Explain what led you toward an answer…"
            className={clsx(
              "min-h-[5.5rem] w-full resize-y rounded-lg border px-3.5 py-3 text-sm leading-relaxed outline-none transition",
              "placeholder:text-neutral-600 focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500/40",
              showResults
                ? "cursor-default border-white/20 bg-neutral-900/50 text-neutral-400 disabled:opacity-100"
                : "border-white/30 bg-neutral-950/50 text-neutral-200 hover:border-white/40",
            )}
          />
        </div>

        {showResults && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-neutral-800/50 p-3.5 text-sm">
            <div className="flex items-start gap-2">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-white">{question.explanation}</p>
            </div>
          </div>
        )}
      </>
    );
  };

  if (embedded && !showScoreScreen) {
    return (
      <form
        id={submitFormId}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmitOrShowResults();
        }}
        className="grid w-full grid-cols-[minmax(0,1fr)_2.25rem] items-start gap-[22px] bg-transparent"
      >
        <div className="col-start-1 row-start-1 min-w-0">
          <h2 className="border-b border-neutral-800 py-5 text-lg font-semibold text-neutral-100">
            {title}
          </h2>
          {questions.map((question, questionIndex) => (
            <section
              key={`${quizId}-question-${questionIndex}`}
              ref={questionIndex === 0
                ? registerFirstQuestion
                : (element) => {
                    questionSectionRefs.current[questionIndex] = element;
                  }}
              id={`${reasonInputId}-question-${questionIndex}`}
              data-question-section-index={questionIndex}
              className={clsx(
                "scroll-mt-4 py-6",
                questionIndex > 0 && "border-t border-neutral-800",
              )}
            >
              <p className="mb-3 text-xs font-medium text-neutral-500">
                Question {questionIndex + 1} of {totalQuestions}
              </p>
              {renderQuestionContent(question, questionIndex)}
            </section>
          ))}

          {submitError && (
            <p role="alert" className="mt-3 text-xs text-rose-400">
              {submitError}
            </p>
          )}
          {!submitFormId && <div className="flex justify-end pb-8 pt-2">
            {!showResults ? (
              <button
                type="button"
                onClick={handleSubmitOrShowResults}
                disabled={!allComplete || attemptStatusLoading || isSubmitting}
                className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 transition-all hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting
                  ? "Submitting..."
                  : attemptStatusLoading
                    ? "Checking..."
                    : firstAttemptExists
                      ? "Show Results"
                      : "Submit"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleViewScore}
                className="flex items-center gap-1.5 rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 transition-all hover:bg-neutral-600"
              >
                <Trophy className="h-3.5 w-3.5" />
                View Results
              </button>
            )}
          </div>}
        </div>

        <nav
          ref={questionNavRef}
          aria-label="Questions"
          className="sticky top-1/2 z-10 col-start-2 row-start-1 flex max-h-[calc(100vh-9rem)] w-9 translate-x-2 -translate-y-1/2 flex-col items-center gap-0.5 overflow-y-auto overscroll-contain"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgb(82 82 82) transparent" }}
        >
          {questions.map((_, questionIndex) => {
            const questionState = questionStates[questionIndex];
            const isCurrent = questionIndex === currentIndex;
            const isComplete = questionState ? isQuestionComplete(questionState) : false;
            const isCorrect = questionState ? isAnswerCorrect(questions[questionIndex], questionState.selected) : false;
            return (
              <button
                key={questionIndex}
                type="button"
                onClick={() => scrollToQuestion(questionIndex)}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={`Scroll to question ${questionIndex + 1}`}
                aria-controls={`${reasonInputId}-question-${questionIndex}`}
                data-question-index={questionIndex}
                className={clsx(
                  "h-8 w-9 shrink-0 rounded-md text-xs font-semibold transition-colors",
                  // In results mode every pill keeps its result colour; "current" is a ring so no result is hidden.
                  showResults && isCorrect && "bg-emerald-500/50 text-white",
                  showResults && !isCorrect && "bg-rose-500/50 text-white",
                  showResults && isCurrent && "ring-2 ring-inset ring-white",
                  showResults && !isCurrent && isCorrect && "ring-1 ring-inset ring-emerald-400/40 hover:bg-emerald-500/65",
                  showResults && !isCurrent && !isCorrect && "ring-1 ring-inset ring-rose-400/40 hover:bg-rose-500/65",
                  !showResults && isCurrent && "bg-white text-neutral-950",
                  !showResults && !isCurrent && isComplete && "bg-neutral-600 text-white hover:bg-neutral-500",
                  !showResults && !isCurrent && !isComplete && "bg-neutral-800 text-neutral-400 ring-1 ring-inset ring-white/20 hover:bg-neutral-700 hover:text-neutral-200",
                )}
              >
                {questionIndex + 1}
              </button>
            );
          })}
        </nav>
      </form>
    );
  }

  // Score screen
  if (showScoreScreen) {
    const percentage = Math.round((score / totalQuestions) * 100);
    return (
      <div
        className={clsx(
          "overflow-hidden",
          embedded ? "w-full bg-transparent" : "rounded-xl border border-white/40 bg-neutral-900/80",
        )}
      >
        {/* Header */}
        <div className={clsx("py-3 border-b", embedded ? "border-neutral-800" : "px-5 bg-neutral-800/50 border-white/40")}>
          <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-neutral-300" />
            {title} — Results
          </h3>
        </div>
        {/* Score */}
        <div className={clsx("py-6 flex flex-col items-center gap-4", !embedded && "px-6")}>
          <div className="relative w-24 h-24">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="text-neutral-700"
              />
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeDasharray={`${percentage}, 100`}
                className="text-emerald-400"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-bold text-white">{percentage}%</span>
            </div>
          </div>
          <p className="text-sm text-neutral-300">
            You got <span className="font-semibold text-white">{score}</span> out of{" "}
            <span className="font-semibold text-white">{totalQuestions}</span> correct
          </p>
          {automaticFeedbackSent && (
            <p className="text-center text-xs text-emerald-400">
              First attempt saved. Your tutor is preparing feedback.
            </p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-medium border border-neutral-600 transition-all"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retake Quiz
            </button>
            <button
              type="button"
              onClick={handleViewAnswers}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-medium border border-neutral-600 transition-all"
            >
              <Eye className="h-3.5 w-3.5" />
              View Answers
            </button>
            {!readOnly && !automaticFeedbackSent && (
              <button
                type="button"
                onClick={() => dispatchFeedback(false)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-medium border border-neutral-600 transition-all"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                Feedback
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/40 bg-neutral-900/80">
      <div className="flex items-center justify-between border-b border-white/40 bg-neutral-800/50 px-5 py-3">
        <h3 className="text-sm font-semibold text-neutral-200">{title}</h3>
        <div className="flex items-center gap-2">
          <div className="relative h-5 w-5">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18" cy="18" r="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                className="text-neutral-700"
              />
              <circle
                cx="18" cy="18" r="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeDasharray={`${((currentIndex + 1) / totalQuestions) * 88} 88`}
                strokeLinecap="round"
                className="text-neutral-300 transition-all duration-300"
              />
            </svg>
          </div>
          <span className="text-xs text-neutral-400">
            {currentIndex + 1} / {totalQuestions}
          </span>
        </div>
      </div>

      {/* Question */}
      <div className="px-5 py-5">
        <p className="text-[15px] font-medium text-neutral-200 mb-1">{current.question}</p>
        {isMultiCorrect(current) && !showResults && (
          <p className="text-xs text-neutral-400 mb-4 italic">Select all that apply</p>
        )}
        {!isMultiCorrect(current) && <div className="mb-4" />}

        {/* Options */}
        <div className="flex flex-col gap-2.5">
          {(shuffleMap[currentIndex] || current.options.map((_, i) => i)).map((origIdx, displayIdx) => {
            const option = current.options[origIdx];
            const isSelected = state.selected.has(origIdx);
            const cSet = correctSet(current);
            const isCorrectOption = cSet.has(origIdx);
            const showCorrect = showResults && isCorrectOption;
            const showWrong = showResults && isSelected && !isCorrectOption;

            return (
              <button
                key={origIdx}
                type="button"
                onClick={() => handleSelect(currentIndex, origIdx)}
                disabled={showResults}
                className={clsx(
                  "w-full text-left px-4 py-3 rounded-lg border text-sm transition-all duration-200",
                  !showResults && isSelected && "border-neutral-400 bg-neutral-300 text-neutral-950 font-medium",
                  !showResults && !isSelected && "border-white/40 bg-neutral-900/80 text-neutral-300 hover:border-white/60 hover:bg-neutral-800",
                  showCorrect && "border-emerald-500/60 bg-neutral-900/80 text-white",
                  showWrong && "border-red-500/60 bg-neutral-900/80 text-white",
                  showResults && !showCorrect && !showWrong && "border-white/20 bg-neutral-900/50 text-neutral-500",
                )}
              >
                <div className="flex items-center gap-3">
                  {showResults ? (
                    showCorrect ? (
                      <Check className="h-5 w-5 text-emerald-400 shrink-0" strokeWidth={2.5} />
                    ) : showWrong ? (
                      <X className="h-5 w-5 text-red-400 shrink-0" strokeWidth={2.5} />
                    ) : (
                      <span className="w-6 h-6 rounded-full border border-white/30 flex items-center justify-center text-xs font-medium shrink-0 text-neutral-500">
                        {String.fromCharCode(65 + displayIdx)}
                      </span>
                    )
                  ) : (
                    <span
                      className={clsx(
                        "w-6 h-6 rounded-full border flex items-center justify-center text-xs font-medium shrink-0",
                        isSelected ? "bg-transparent text-neutral-900 border-neutral-900 font-medium" : "border-white/40 text-neutral-400",
                      )}
                      style={isSelected ? { borderWidth: '1.5px' } : undefined}
                    >
                      {String.fromCharCode(65 + displayIdx)}
                    </span>
                  )}
                  <span>{stripOptionLabel(option)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Student rationale */}
        <div className="mt-4">
          <label
            htmlFor={`${reasonInputId}-${currentIndex}`}
            className="mb-2 block text-xs font-medium text-neutral-300"
          >
            Reason for your choice
            <span className="ml-1 font-normal text-neutral-500">(required)</span>
          </label>
          <textarea
            id={`${reasonInputId}-${currentIndex}`}
            value={state.reason}
            onChange={(event) => handleReasonChange(currentIndex, event.target.value)}
            disabled={showResults}
            required
            aria-required="true"
            rows={3}
            maxLength={800}
            placeholder="Explain what led you toward an answer…"
            className={clsx(
              "min-h-[5.5rem] w-full resize-y rounded-lg border px-3.5 py-3 text-sm leading-relaxed outline-none transition",
              "placeholder:text-neutral-600 focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500/40",
              showResults
                ? "cursor-default border-white/20 bg-neutral-900/50 text-neutral-400 disabled:opacity-100"
                : "border-white/30 bg-neutral-950/50 text-neutral-200 hover:border-white/40",
            )}
          />
        </div>

        {/* Explanation — only after results */}
        {showResults && (
          <div className="mt-4 p-3.5 rounded-lg border border-amber-500/30 bg-neutral-800/50 text-sm">
            <div className="flex items-start gap-2">
              <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
              <p className="text-white">
                {current.explanation}
              </p>
            </div>
          </div>
        )}

        {/* Actions + Question dots — single row */}
        {submitError && (
          <p role="alert" className="mt-3 text-xs text-rose-400">
            {submitError}
          </p>
        )}
        <div className="mt-4 flex items-center">
          <div className="flex-1 flex justify-start">
            <button
              type="button"
              onClick={handlePrev}
              disabled={currentIndex === 0}
              className="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-200 font-medium flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
          </div>

          {/* Question dots */}
          <div className={clsx("flex items-center justify-center gap-1.5", embedded && "hidden")}>
            {questions.map((_, i) => {
              const qs = questionStates[i];
              const isCurrent = i === currentIndex;
              const isComplete = isQuestionComplete(qs);
              const status = isComplete
                ? "complete"
                : qs.selected.size > 0
                  ? "reason required"
                  : "not answered";
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentIndex(i)}
                  aria-label={`Question ${i + 1}, ${status}`}
                  className={clsx(
                    "w-2.5 h-2.5 rounded-full transition-all",
                    isCurrent && "bg-neutral-200",
                    !isCurrent && showResults && isAnswerCorrect(questions[i], qs.selected) && "bg-emerald-500",
                    !isCurrent && showResults && !isAnswerCorrect(questions[i], qs.selected) && "bg-red-500",
                    !isCurrent && !showResults && isComplete && "bg-neutral-400",
                    !isCurrent && !showResults && qs.selected.size > 0 && !isComplete && "bg-amber-500",
                    !isCurrent && !showResults && qs.selected.size === 0 && "bg-neutral-600",
                  )}
                />
              );
            })}
          </div>

          <div className="flex-1 flex justify-end items-center gap-2">
            {!showResults && currentIndex < totalQuestions - 1 && (
              <button
                type="button"
                onClick={handleNext}
                disabled={!currentComplete}
                className="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-200 font-medium flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            {!showResults && currentIndex === totalQuestions - 1 && (
              <button
                type="button"
                onClick={handleSubmitOrShowResults}
                disabled={!allComplete || attemptStatusLoading || isSubmitting}
                className="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-200 font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {isSubmitting
                  ? "Submitting..."
                  : attemptStatusLoading
                    ? "Checking..."
                    : firstAttemptExists
                      ? "Show Results"
                      : "Submit"}
              </button>
            )}
            {showResults && currentIndex < totalQuestions - 1 && (
              <button
                type="button"
                onClick={handleNext}
                className="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-200 font-medium flex items-center gap-1.5 transition-all"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            {showResults && currentIndex === totalQuestions - 1 && (
              <button
                type="button"
                onClick={handleViewScore}
                className="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-200 font-medium flex items-center gap-1.5 transition-all"
              >
                <Trophy className="h-3.5 w-3.5" />
                View Results
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
