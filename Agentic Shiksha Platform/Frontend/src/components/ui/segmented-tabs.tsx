// components/ui/segmented-tabs.tsx
import * as React from "react";
import { motion } from "framer-motion";
import clsx from "clsx";

type SegTab = { value: string; label: string };
export function SegmentedTabs({
  value,
  onChange,
  tabs,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  tabs: SegTab[];
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "relative inline-flex items-center rounded-2xl bg-neutral-900/70 border border-neutral-800 p-1",
        className
      )}
    >
      {tabs.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={clsx(
              "relative z-10 px-4 py-2 text-sm transition-colors rounded-xl",
              active ? "text-white" : "text-neutral-300 hover:text-neutral-100"
            )}
          >
            {active && (
              <motion.span
                layoutId="seg-pill"
                className="absolute inset-0 -z-10 rounded-xl bg-neutral-800 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}