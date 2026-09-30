import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pause, Play } from "lucide-react";
import { CatCompanion } from "@/components/chat/CatCompanion";
import { PageHeader } from "@/components/layout/PageHeader";
import "./CompanionAnimationsPage.css";

const ANIMATIONS = [
  { action: "sit", name: "Sitting cat" },
  { action: "walk", name: "Walking cat" },
  { action: "run", name: "Running cat" },
  { action: "stretch", name: "Stretching cat" },
  { action: "sleep", name: "Sleeping cat" },
] as const;

export function CompanionAnimationsPage() {
  const catalogueId = useId();
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [scale, setScale] = useState(2);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    update();
    return () => preference.removeEventListener("change", update);
  }, []);

  const running = playing && !reducedMotion;
  return (
    <div className="companion-catalogue flex h-full min-h-0 flex-col bg-neutral-900 text-neutral-100" data-playing={running}>
      <PageHeader title="Companion animations" showBorder className="shrink-0 gap-2 px-4 [&_h1]:text-base">
        <Link to="/create" aria-label="Back to course builder" title="Back to course builder" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-neutral-800 pb-4">
            <div>
              <h2 className="text-base font-semibold">Course Companion</h2>
              <p className="mt-1 text-xs text-neutral-500">Five cat poses for the chat pane</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                aria-label={running ? "Pause animations" : "Play animations"}
                title={reducedMotion ? "Reduced motion enabled" : running ? "Pause animations" : "Play animations"}
                onClick={() => setPlaying(value => !value)}
                disabled={reducedMotion}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-40"
              >
                {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                Speed
                <select aria-label="Animation speed" value={speed} onChange={event => setSpeed(Number(event.target.value))} disabled={reducedMotion} className="h-9 w-20 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm text-neutral-200 disabled:opacity-40">
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={1.5}>1.5x</option>
                </select>
              </label>
              <fieldset aria-label="Preview size" className="flex h-9 overflow-hidden rounded-md border border-neutral-700">
                {[1, 2].map(value => (
                  <label key={value} className="relative flex min-w-16 cursor-pointer items-center justify-center px-2 text-xs has-[:checked]:bg-neutral-700 has-[:checked]:text-white">
                    <input type="radio" name={`${catalogueId}-size`} aria-label={`${value * 44} px`} checked={scale === value} onChange={() => setScale(value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                    <span>{value * 44} px</span>
                  </label>
                ))}
              </fieldset>
            </div>
          </div>
          {reducedMotion && <p role="status" className="mb-4 text-xs text-neutral-400">Reduced motion</p>}
          <section aria-label="Cat animation catalogue" className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 xl:grid-cols-3">
            {ANIMATIONS.map((animation, index) => (
              <article key={animation.action} data-animation={`cat-${animation.action}`} aria-labelledby={`${catalogueId}-${animation.action}`} className="min-w-0 overflow-hidden rounded-lg border border-neutral-700/60 bg-neutral-900">
                <div className="companion-catalogue-stage flex h-40 items-center justify-center">
                  <CatCompanion action={animation.action} size={44 * scale} speed={speed} playing={running} label={`${animation.name} preview`} />
                </div>
                <div className="flex min-h-16 items-center gap-2 border-t border-white/[0.05] px-3 py-3">
                  <span className="shrink-0 font-mono text-xs text-neutral-500">{String(index + 1).padStart(2, "0")}</span>
                  <h3 id={`${catalogueId}-${animation.action}`} className="min-w-0 flex-1 text-sm font-medium leading-5 text-neutral-200">{animation.name}</h3>
                </div>
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
