import { useState } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Lightbulb,
} from "lucide-react";
import Markdown from "@/components/common/Markdown";

type ChallengeBlockProps = {
  challengeId: string;
  title: string;
  description: string;
  difficulty: string;
  hints?: string[];
  solution: string;
  challengeType?: string;
  embedded?: boolean;
};

const difficultyConfig: Record<string, { label: string; color: string; bg: string }> = {
  easy: { label: "Easy", color: "text-emerald-400", bg: "bg-emerald-500/15" },
  medium: { label: "Medium", color: "text-amber-400", bg: "bg-amber-500/15" },
  hard: { label: "Hard", color: "text-red-400", bg: "bg-red-500/15" },
};

const challengeTypeLabels: Record<string, string> = {
  coding: "Coding",
  problem: "Problem Solving",
  case_study: "Case Study",
  equation: "Equation",
  puzzle: "Puzzle",
};


export default function ChallengeBlock({
  challengeId,
  title,
  description,
  difficulty,
  hints = [],
  solution,
  challengeType = "problem",
  embedded = false,
}: ChallengeBlockProps) {
  const [revealedHints, setRevealedHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [activeSection, setActiveSection] = useState<"challenge" | "hints">("challenge");

  const diffStyle = difficultyConfig[difficulty] || difficultyConfig.medium;
  const typeLabel = challengeTypeLabels[challengeType] || "Challenge";
  const showChallenge = !embedded || activeSection === "challenge";
  const showHints = !embedded || activeSection === "hints";

  const revealNextHint = () => {
    if (revealedHints < hints.length) {
      setRevealedHints((prev) => prev + 1);
    }
  };

  return (
    <div
      data-challenge-id={challengeId}
      className={clsx(
        "overflow-hidden",
        embedded
          ? "flex h-full min-h-0 w-full flex-col bg-transparent"
          : "rounded-xl border border-neutral-700/50 bg-neutral-900/80",
      )}
    >
      {/* Header — the side pane already shows the title */}
      {!embedded && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-5 py-3 bg-neutral-800/50 border-b border-neutral-700/50 flex items-center justify-between hover:bg-neutral-800/70 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-semibold text-white truncate max-w-[300px]">
              {title}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 leading-none flex items-center justify-center">
              {typeLabel}
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-neutral-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-neutral-500" />
            )}
          </div>
        </button>
      )}

      {/* Body */}
      {(embedded || expanded) && (
        <div className={clsx(
          "space-y-5",
          embedded ? "min-h-0 flex-1 overflow-y-auto scrollbar-none px-14 pb-5 pt-0" : "px-5 py-5",
        )}>
          {embedded && (
            // Negative inline margin cancels the body's px-14 so the sticky bar spans the pane.
            <div className="sticky top-0 z-10 -mx-14 flex items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-800 px-14 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={clsx("rounded-full px-2.5 py-1 text-[11px] font-medium", diffStyle.bg, diffStyle.color)}>
                  {diffStyle.label}
                </span>
                <span className="truncate text-[11px] text-neutral-500">{typeLabel}</span>
              </div>
              <div
                role="tablist"
                aria-label="Challenge sections"
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  setActiveSection((current) => (current === "challenge" ? "hints" : "challenge"));
                }}
                className="relative grid h-8 w-[176px] shrink-0 grid-cols-2 rounded-lg border border-neutral-700/80 bg-neutral-900/80 p-0.5"
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    "pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-neutral-100 shadow-sm transition-transform duration-200 ease-out",
                    activeSection === "hints" && "translate-x-full",
                  )}
                />
                <button
                  type="button"
                  role="tab"
                  id={`${challengeId}-tab-challenge`}
                  aria-controls={`${challengeId}-panel-challenge`}
                  aria-selected={activeSection === "challenge"}
                  tabIndex={activeSection === "challenge" ? 0 : -1}
                  onClick={() => setActiveSection("challenge")}
                  className={clsx(
                    "relative z-10 flex items-center justify-center rounded-md px-2 text-[11px] font-semibold transition-colors",
                    activeSection === "challenge"
                      ? "text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-200",
                  )}
                >
                  Challenge
                </button>
                <button
                  type="button"
                  role="tab"
                  id={`${challengeId}-tab-hints`}
                  aria-controls={`${challengeId}-panel-hints`}
                  aria-selected={activeSection === "hints"}
                  tabIndex={activeSection === "hints" ? 0 : -1}
                  onClick={() => setActiveSection("hints")}
                  className={clsx(
                    "relative z-10 flex items-center justify-center rounded-md px-2 text-[11px] font-semibold transition-colors",
                    activeSection === "hints"
                      ? "text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-200",
                  )}
                >
                  Solution
                </button>
              </div>
            </div>
          )}

          {/* Description */}
          {showChallenge && <section
            role={embedded ? "tabpanel" : undefined}
            id={embedded ? `${challengeId}-panel-challenge` : undefined}
            aria-labelledby={embedded ? `${challengeId}-tab-challenge` : undefined}
          >
            {embedded && (
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                Problem statement
              </p>
            )}
            <div className={clsx(
              "text-[14px] leading-relaxed text-neutral-200",
              embedded ? "challenge-brief" : "rounded-lg border border-neutral-700/40 bg-neutral-800/40 p-4",
            )}>
              <Markdown math highlight>{description}</Markdown>
            </div>
          </section>}

          {/* Hints section */}
          {showHints && (
            <section
              role={embedded ? "tabpanel" : undefined}
              id={embedded ? `${challengeId}-panel-hints` : undefined}
              aria-labelledby={embedded ? `${challengeId}-tab-hints` : undefined}
              className={clsx("space-y-2.5", !embedded && "border-t border-neutral-800 pt-4")}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-neutral-400">
                    Hints ({revealedHints}/{hints.length})
                  </span>
                </div>
                {revealedHints < hints.length && (
                  <button
                    type="button"
                    onClick={revealNextHint}
                    className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-300 transition hover:bg-amber-500/15"
                  >
                    {revealedHints === 0
                      ? "Show hint"
                      : hints.length - revealedHints === 1
                        ? "Last hint"
                        : "Next hint"}
                  </button>
                )}
                {(hints.length === 0 || revealedHints >= hints.length) && (
                  <button
                    type="button"
                    onClick={() => setShowSolution((current) => !current)}
                    className={clsx(
                      "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                      showSolution
                        ? "border-neutral-600 bg-neutral-700/80 text-white hover:bg-neutral-700"
                        : "border-neutral-700 bg-neutral-800/60 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
                    )}
                  >
                    {showSolution ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" />
                        Hide Solution
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" />
                        Show Solution
                      </>
                    )}
                  </button>
                )}
              </div>

              {Array.from({ length: revealedHints }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                >
                  <span className="text-[13px] font-semibold text-amber-400 shrink-0">
                    {i + 1}.
                  </span>
                  <div className="text-[13px] text-neutral-300 leading-relaxed">
                    <Markdown math>{hints[i]}</Markdown>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Solution content — the toggle lives in the hints header above. */}
          {showHints && showSolution && (hints.length === 0 || revealedHints >= hints.length) && (
          <section className="rounded-lg border border-neutral-700/40 bg-neutral-800/40 p-4">
            <span className="mb-2 block text-[10px] uppercase tracking-widest text-neutral-400">
              Solution
            </span>
            <div className="text-[14px] leading-relaxed text-neutral-200">
              <Markdown math highlight>{solution}</Markdown>
            </div>
          </section>
          )}
        </div>
      )}
    </div>
  );
}
