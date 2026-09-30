import { create } from "zustand";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const BUNDLE_PATTERN = /\/assets\/index-[A-Za-z0-9._-]+\.js/;

interface UpdateState {
  updateReady: boolean;
  bannerDismissed: boolean;
  setUpdateReady: (ready: boolean) => void;
  dismissBanner: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  updateReady: false,
  bannerDismissed: false,
  setUpdateReady: (updateReady) => set({ updateReady }),
  dismissBanner: () => set({ bannerDismissed: true }),
}));

/** The hashed bundle this tab is running. */
function currentBundle(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"));
  for (const script of scripts) {
    const match = script.getAttribute("src")?.match(BUNDLE_PATTERN);
    if (match) return match[0];
  }
  return null;
}

async function checkForUpdate(): Promise<void> {
  const running = currentBundle();
  if (!running || useUpdateStore.getState().updateReady) return;
  try {
    const response = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const deployed = (await response.text()).match(BUNDLE_PATTERN)?.[0];
    if (deployed && deployed !== running) useUpdateStore.getState().setUpdateReady(true);
  } catch {
    // Offline or a blip — the next tick retries.
  }
}

let started = false;

/**
 * A running SPA never re-checks for new code, so a deploy stays invisible until
 * the user happens to reload. Poll the served bundle hash and let the UI offer a
 * reload rather than forcing one, which would discard an in-flight chat.
 */
export function startUpdatePolling(): void {
  if (started) return;
  started = true;
  void checkForUpdate();
  window.setInterval(checkForUpdate, POLL_INTERVAL_MS);
  const onVisible = () => { if (document.visibilityState === "visible") void checkForUpdate(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}
