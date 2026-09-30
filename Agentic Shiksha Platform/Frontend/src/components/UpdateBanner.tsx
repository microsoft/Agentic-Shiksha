import { useEffect } from "react";
import { RefreshCw, X } from "lucide-react";
import { startUpdatePolling, useUpdateStore } from "@/lib/updateStore";

export function UpdateBanner() {
  const updateReady = useUpdateStore((s) => s.updateReady);
  const dismissed = useUpdateStore((s) => s.bannerDismissed);
  const dismissBanner = useUpdateStore((s) => s.dismissBanner);

  useEffect(() => { startUpdatePolling(); }, []);

  if (!updateReady || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-xl border border-neutral-600 bg-neutral-800 py-2 pl-4 pr-2 shadow-lg shadow-black/40">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span className="text-[13px] text-neutral-200">A new version is available</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-black transition-colors hover:bg-neutral-200"
        >
          <RefreshCw className="h-3 w-3" />
          Reload
        </button>
        <button
          type="button"
          onClick={dismissBanner}
          aria-label="Dismiss"
          className="rounded-lg p-1 text-neutral-500 transition-colors hover:bg-neutral-700 hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
