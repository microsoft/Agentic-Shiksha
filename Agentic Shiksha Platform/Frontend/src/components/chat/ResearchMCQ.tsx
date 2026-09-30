import React, { useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";

/** A single parsed MCQ question */
export interface ResearchMCQQuestion {
  number: number;
  question: string;
  options: { label: string; text: string }[];
}

/** Parse MCQ text from the deep research agent into structured questions */
export function parseMCQQuestions(text: string): ResearchMCQQuestion[] {
  const questions: ResearchMCQQuestion[] = [];
  const questionBlocks = text.split(/(?=(?:^|\n)\s*\*?\*?\d+[\.\)]\s*\*?\*?\s*)/);
  
  for (const block of questionBlocks) {
    if (!block.trim()) continue;
    const qMatch = block.match(/^\s*\*?\*?(\d+)[\.\)]\s*\*?\*?\s*(.+?)(?=\s*[A-D]\))/s);
    if (!qMatch) continue;
    
    const number = parseInt(qMatch[1]);
    const question = qMatch[2].trim().replace(/\*\*/g, "");
    const options: { label: string; text: string }[] = [];
    const optionMatches = block.matchAll(/([A-D])\)\s*(.+?)(?=\s*[A-D]\)|$)/gs);
    for (const m of optionMatches) {
      // Skip "Other (please specify)" — rendered as separate input
      if (m[1] === "D" && m[2].toLowerCase().includes("other")) continue;
      options.push({ label: m[1], text: m[2].trim() });
    }
    if (options.length >= 2) {
      questions.push({ number, question, options });
    }
  }
  return questions;
}

interface ResearchMCQProps {
  questions: ResearchMCQQuestion[];
  onSubmit: (answers: Record<number, { label: string; text: string; customText?: string }>) => void;
  disabled?: boolean;
}

/**
 * Interactive MCQ stepper for deep research clarification.
 * Multi-select enabled. Matches QuizBlock styling.
 */
export function ResearchMCQ({ questions, onSubmit, disabled = false }: ResearchMCQProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  // Multi-select: store array of selected labels per question
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({});
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const currentQ = questions[currentIndex];
  const totalQuestions = questions.length;
  const totalPages = totalQuestions + 1; // +1 for additional details page
  const allAnswered = questions.every(q => {
    const sel = selections[q.number];
    const custom = customInputs[q.number]?.trim();
    return (sel && sel.size > 0) || !!custom;
  });
  const isOnDetailsPage = currentIndex === totalQuestions;
  const isLast = currentIndex === totalQuestions - 1;

  const toggleSelect = (qNum: number, label: string) => {
    if (submitted || disabled) return;
    setSelections(prev => {
      const current = new Set(prev[qNum] || []);
      if (current.has(label)) {
        current.delete(label);
      } else {
        current.add(label);
      }
      return { ...prev, [qNum]: current };
    });
  };

  const handleCustomInput = (qNum: number, value: string) => {
    if (submitted || disabled) return;
    setCustomInputs(prev => ({ ...prev, [qNum]: value }));
  };

  const handleSubmit = () => {
    if (submitted || disabled) return;
    // Build answers from multi-select + custom input
    const finalAnswers: Record<number, { label: string; text: string; customText?: string }> = {};
    for (const q of questions) {
      const sel = selections[q.number];
      const custom = customInputs[q.number]?.trim();
      const selectedLabels = sel ? Array.from(sel) : [];
      const selectedTexts = selectedLabels.map(l => {
        const opt = q.options.find(o => o.label === l);
        return opt ? opt.text : l;
      });
      
      if (selectedLabels.length > 0 || custom) {
        const allTexts = [...selectedTexts];
        if (custom) allTexts.push(custom);
        finalAnswers[q.number] = {
          label: selectedLabels.join(", ") + (custom ? ", D" : ""),
          text: allTexts.join("; "),
          customText: custom || undefined,
        };
      }
    }
    setSubmitted(true);
    // Append additional details to a special key
    if (additionalDetails.trim()) {
      finalAnswers[0] = { label: "additional", text: additionalDetails.trim() };
    }
    onSubmit(finalAnswers);
  };

  if (submitted) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-400 py-3">
        <CheckCircle2 className="w-4 h-4 text-neutral-400" />
        Answers submitted — researching...
      </div>
    );
  }

  if (!currentQ && !isOnDetailsPage) return null;

  const currentSelections = currentQ ? (selections[currentQ.number] || new Set<string>()) : new Set<string>();

  return (
    <div className="rounded-xl border border-neutral-700/50 bg-neutral-900/80 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 bg-neutral-800/50 border-b border-neutral-700/50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{isOnDetailsPage ? "Additional Details" : "Research Scope"}</h3>
        <div className="flex items-center gap-2">
          <div className="relative w-5 h-5">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="4" className="text-neutral-700" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="4"
                strokeDasharray={`${((currentIndex + 1) / totalPages) * 88} 88`}
                strokeLinecap="round" className="text-white transition-all duration-300" />
            </svg>
          </div>
          <span className="text-xs text-neutral-400">{currentIndex + 1} / {totalPages}</span>
        </div>
      </div>

      <div className="p-5">
        {/* Question page */}
        {currentQ && !isOnDetailsPage && (
          <>
            <p className="text-[15px] font-medium text-white mb-1">{currentQ.question}</p>
            <p className="text-xs text-neutral-500 mb-4">Select one or more options</p>

            <div className="flex flex-col gap-2.5">
              {currentQ.options.map((opt) => {
                const isSelected = currentSelections.has(opt.label);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={submitted || disabled}
                    onClick={() => toggleSelect(currentQ.number, opt.label)}
                    className={clsx(
                      "w-full text-left px-4 py-3 rounded-lg border text-sm transition-all duration-200",
                      isSelected && "border-white/50 bg-white/10 text-white",
                      !isSelected && "border-neutral-700/50 bg-neutral-800/50 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className={clsx(
                        "w-6 h-6 rounded-full border flex items-center justify-center text-xs font-medium shrink-0",
                        isSelected ? "border-white/60 text-white" : "border-neutral-600 text-neutral-500",
                      )}>
                        {opt.label}
                      </span>
                      <span>{opt.text}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom input below options */}
            <div className="mt-3">
              <textarea
                placeholder="If you'd like to add anything else, please specify here..."
                value={customInputs[currentQ.number] || ""}
                onChange={(e) => handleCustomInput(currentQ.number, e.target.value)}
                disabled={submitted || disabled}
                rows={3}
                style={{ background: 'none', backgroundColor: 'rgb(38 38 38 / 0.5)' }}
                className="w-full px-4 py-3 rounded-lg border border-neutral-700/50 text-sm text-neutral-300 placeholder-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors resize-none"
              />
            </div>
          </>
        )}

        {/* Additional details page — separate page after all questions */}
        {isOnDetailsPage && (
          <>
            <p className="text-[15px] font-medium text-white mb-2">Anything else you'd like the research to cover?</p>
            <p className="text-xs text-neutral-500 mb-4">Add any specific requirements, comparisons, time frames, or focus areas. (optional)</p>
            <textarea
              placeholder="E.g., focus on recent 5 years, compare with other IITs, include statistics, cover placement records..."
              value={additionalDetails}
              onChange={(e) => setAdditionalDetails(e.target.value)}
              disabled={submitted || disabled}
              rows={4}
              style={{ background: 'none', backgroundColor: 'rgb(38 38 38 / 0.5)' }}
              className="w-full px-4 py-3 rounded-lg border border-neutral-700/50 text-sm text-neutral-300 placeholder-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors resize-none"
            />
          </>
        )}

        {/* Actions + dots */}
        <div className="mt-4 flex items-center">
          <div className="flex-1 flex justify-start">
            <button
              type="button"
              onClick={() => setCurrentIndex(i => i - 1)}
              disabled={currentIndex === 0}
              className="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white font-medium flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
          </div>

          <div className="flex items-center justify-center gap-1.5">
            {questions.map((q, i) => {
              const isCurrent = i === currentIndex;
              const hasAnswer = (selections[q.number] && selections[q.number].size > 0) || !!customInputs[q.number]?.trim();
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentIndex(i)}
                  className={clsx(
                    "w-2.5 h-2.5 rounded-full transition-all",
                    isCurrent && "bg-white",
                    !isCurrent && hasAnswer && "bg-neutral-400",
                    !isCurrent && !hasAnswer && "bg-neutral-600",
                  )}
                />
              );
            })}
            {/* Extra dot for details page */}
            <button
              type="button"
              onClick={() => setCurrentIndex(totalQuestions)}
              className={clsx(
                "w-2.5 h-2.5 rounded-full transition-all",
                isOnDetailsPage && "bg-white",
                !isOnDetailsPage && additionalDetails.trim() && "bg-neutral-400",
                !isOnDetailsPage && !additionalDetails.trim() && "bg-neutral-600",
              )}
            />
          </div>

          <div className="flex-1 flex justify-end items-center gap-2">
            {!isOnDetailsPage && !isLast && (
              <button
                type="button"
                onClick={() => setCurrentIndex(i => i + 1)}
                className="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white font-medium flex items-center gap-1.5 transition-all"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            {isLast && (
              <button
                type="button"
                onClick={() => setCurrentIndex(totalQuestions)}
                className="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white font-medium flex items-center gap-1.5 transition-all"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            {isOnDetailsPage && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!allAnswered}
                className="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Start Research
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
