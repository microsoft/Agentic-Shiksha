import { useEffect, useState } from "react";
import { getImageQuota, updateImageQuota, type ImageQuota } from "@/lib/dashboardApi";

/** Weekly image-generation allowance applied to every student on every course. */
export default function ImageQuotaCard() {
  const [quota, setQuota] = useState<ImageQuota | null>(null);
  const [medium, setMedium] = useState("");
  const [low, setLow] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (q: ImageQuota) => {
    setQuota(q);
    setMedium(String(q.limits.medium));
    setLow(String(q.limits.low));
  };

  useEffect(() => {
    getImageQuota().then(load).catch((e) => setError(e.message));
  }, []);

  const dirty =
    !!quota &&
    (Number(medium) !== quota.limits.medium || Number(low) !== quota.limits.low);

  const valid =
    Number.isInteger(Number(medium)) &&
    Number.isInteger(Number(low)) &&
    Number(medium) >= 0 &&
    Number(low) >= 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const next = await updateImageQuota({ medium: Number(medium), low: Number(low) });
      load(next);
      setStatus("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Preview reflects the edited values, so the cost updates before saving.
  const projectedWeekly = quota
    ? Number(medium || 0) * quota.costPerImageUsd.medium +
      Number(low || 0) * quota.costPerImageUsd.low
    : 0;

  return (
    <div className="rounded-2xl border border-neutral-700/60 bg-neutral-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">Image generation quota</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            Images each student may generate per course, per week. Resets Monday.
          </p>
        </div>
        {quota && (
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums text-neutral-100">
              ${projectedWeekly.toFixed(3)}
            </div>
            <div className="text-[11px] text-neutral-500">
              /student/week · ${(projectedWeekly * 4.3).toFixed(2)} per month
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      {!quota ? (
        <p className="mt-4 text-xs text-neutral-500">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {([
              ["medium", medium, setMedium] as const,
              ["low", low, setLow] as const,
            ]).map(([key, value, setValue]) => (
              <label key={key} className="block">
                <span className="text-xs font-medium capitalize text-neutral-400">
                  {key} quality
                </span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm tabular-nums text-neutral-100 outline-none focus:border-neutral-500"
                />
                <span className="mt-1 block text-[11px] text-neutral-500">
                  ${quota.costPerImageUsd[key].toFixed(4)} per image
                </span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || !valid || saving}
              className="rounded-lg bg-neutral-100 px-4 py-2 text-xs font-semibold text-neutral-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => load(quota)}
                className="text-xs text-neutral-400 hover:text-neutral-200"
              >
                Reset
              </button>
            )}
            {!valid && <span className="text-xs text-red-400">Whole numbers, 0 or more</span>}
            {status && !dirty && <span className="text-xs text-emerald-400">{status}</span>}
          </div>
        </>
      )}
    </div>
  );
}
