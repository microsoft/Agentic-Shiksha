import React, { useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type FlashCard = {
  front: string;
  back: string;
};

type FlashcardBlockProps = {
  flashcardId: string;
  title: string;
  cards: FlashCard[];
};

export default function FlashcardBlock({ flashcardId, title, cards }: FlashcardBlockProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const totalCards = cards.length;
  const current = cards[currentIndex];

  if (!cards.length) return null;

  const handleFlip = () => setFlipped((f) => !f);

  const handleNext = () => {
    if (currentIndex < totalCards - 1) {
      setCurrentIndex(currentIndex + 1);
      setFlipped(false);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setFlipped(false);
    }
  };



  return (
    <div className="rounded-xl border border-neutral-700/50 bg-neutral-900/80 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 bg-neutral-800/50 border-b border-neutral-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 -rotate-90" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" className="text-neutral-700" />
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" className="text-white" strokeLinecap="round" strokeDasharray={2 * Math.PI * 8} strokeDashoffset={2 * Math.PI * 8 * (1 - (currentIndex + 1) / totalCards)} />
          </svg>
          <span className="text-xs text-neutral-500">
            {currentIndex + 1} / {totalCards}
          </span>
        </div>
      </div>

      {/* Card area */}
      <div className="p-5">
        {/* Flip card */}
        <div
          className="perspective-1000 cursor-pointer"
          onClick={handleFlip}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleFlip();
            }
          }}
        >
          <div
            className={clsx(
              "relative w-full min-h-[180px] transition-transform duration-500",
              "[transform-style:preserve-3d]",
              flipped && "[transform:rotateY(180deg)]"
            )}
          >
            {/* Front */}
            <div className="absolute inset-0 [backface-visibility:hidden] rounded-xl border border-neutral-700/50 bg-neutral-800/80 p-6 flex flex-col items-center justify-center">
              <span className="text-[10px] uppercase tracking-widest text-neutral-500 mb-3">Question</span>
              <p className="text-[15px] text-white text-center leading-relaxed font-medium">
                {current.front}
              </p>
              <span className="mt-4 text-[11px] text-neutral-500">Click to flip</span>
            </div>

            {/* Back */}
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-xl border border-neutral-600/50 bg-neutral-800/60 p-6 flex flex-col items-center justify-center">
              <span className="text-[10px] uppercase tracking-widest text-neutral-400 mb-3">Answer</span>
              <p className="text-[15px] text-neutral-200 text-center leading-relaxed">
                {current.back}
              </p>
              <span className="mt-4 text-[11px] text-neutral-500">Click to flip back</span>
            </div>
          </div>
        </div>

        {/* Navigation arrows + dots */}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            title="Previous card"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="flex items-center justify-center gap-1.5">
            {cards.map((_, i) => {
              const isCurrent = i === currentIndex;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setCurrentIndex(i);
                    setFlipped(false);
                  }}
                  className={clsx(
                    "w-2.5 h-2.5 rounded-full transition-all",
                    isCurrent ? "bg-white" : "bg-neutral-600",
                  )}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleNext}
            disabled={currentIndex === totalCards - 1}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            title="Next card"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
