import { useId } from "react";
import { Check, FileText, Image, Layers, ListChecks, Minus, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AgentCapabilities } from "@/lib/agentCapabilities";

const CAPABILITIES: Array<{
  id: keyof AgentCapabilities;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { id: "documents", label: "Documents", description: "Create downloadable notes and study guides.", icon: FileText },
  { id: "quizzes", label: "Quizzes", description: "Check understanding with interactive quizzes.", icon: ListChecks },
  { id: "flashcards", label: "Flashcards", description: "Build revision cards for key concepts.", icon: Layers },
  { id: "challenges", label: "Challenges", description: "Offer interactive practice and problem-solving tasks.", icon: Trophy },
  { id: "images", label: "Image generation", description: "Generate visuals to explain course concepts.", icon: Image },
];

type CapabilityControlsProps = {
  capabilities: AgentCapabilities;
  onChange: (capabilities: AgentCapabilities) => void;
  disabled?: boolean;
};

export function CapabilityControls({ capabilities, onChange, disabled = false }: CapabilityControlsProps) {
  const idPrefix = useId();
  const enabledCount = CAPABILITIES.filter(({ id }) => capabilities[id]).length;

  const setAllCapabilities = (enabled: boolean) => {
    onChange({
      documents: enabled,
      quizzes: enabled,
      flashcards: enabled,
      challenges: enabled,
      images: enabled,
    });
  };

  return (
    <section aria-labelledby={`${idPrefix}-heading`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${idPrefix}-heading`} className="font-semibold text-neutral-100">Capabilities</h3>
        <span className="text-xs text-neutral-400" aria-live="polite">
          {enabledCount} of {CAPABILITIES.length} enabled
        </span>
      </div>
      <p className="text-sm leading-relaxed text-neutral-400">
        Enable or disable optional tools. Chat, course search, and learning progress stay available.
      </p>
      <div className="my-3 flex gap-2">
        <button
          type="button"
          onClick={() => setAllCapabilities(true)}
          disabled={disabled || enabledCount === CAPABILITIES.length}
          className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Enable all
        </button>
        <button
          type="button"
          onClick={() => setAllCapabilities(false)}
          disabled={disabled || enabledCount === 0}
          className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Disable all
        </button>
      </div>
      <div className="divide-y divide-neutral-700/70 rounded-xl border border-neutral-700 bg-neutral-800/30">
        {CAPABILITIES.map(({ id, label, description, icon: Icon }) => (
          <div key={id} className="flex items-center gap-3 p-3 sm:p-4">
            <Icon className="hidden h-5 w-5 shrink-0 text-neutral-400 sm:block" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p id={`${idPrefix}-${id}-label`} className="text-sm font-medium text-neutral-100">{label}</p>
              <p id={`${idPrefix}-${id}-description`} className="mt-1 text-xs leading-relaxed text-neutral-400">{description}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={capabilities[id]}
              aria-labelledby={`${idPrefix}-${id}-label`}
              aria-describedby={`${idPrefix}-${id}-description`}
              disabled={disabled}
              onClick={() => onChange({ ...capabilities, [id]: !capabilities[id] })}
              className={`inline-flex min-h-10 w-28 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50 ${
                capabilities[id]
                  ? "border-violet-400/40 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20"
                  : "border-neutral-600 bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {capabilities[id] ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Minus className="h-3.5 w-3.5" aria-hidden="true" />}
              {capabilities[id] ? "Enabled" : "Disabled"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
