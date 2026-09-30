import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize } from "lucide-react";
import "./AssetFullscreenButton.css";

export function AssetFullscreenButton({ className = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-700" }: { className?: string }) {
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [viewportFullscreen, setViewportFullscreen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const fullscreen = nativeFullscreen || viewportFullscreen;

  useEffect(() => {
    const target = buttonRef.current?.closest<HTMLElement>("[data-fullscreen-surface]");
    if (!target) return;
    target.classList.toggle("asset-viewport-fullscreen", viewportFullscreen);
    const changed = () => setNativeFullscreen(document.fullscreenElement === target);
    const exitViewport = () => setViewportFullscreen(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setViewportFullscreen(false);
      if (document.fullscreenElement === target) void document.exitFullscreen().catch(() => undefined);
    };
    changed();
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("keydown", escape);
    target.addEventListener("asset-fullscreen-exit", exitViewport);
    return () => {
      target.classList.remove("asset-viewport-fullscreen");
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("keydown", escape);
      target.removeEventListener("asset-fullscreen-exit", exitViewport);
      if (document.fullscreenElement === target) void document.exitFullscreen().catch(() => undefined);
    };
  }, [viewportFullscreen]);

  const toggleFullscreen = async () => {
    const target = buttonRef.current?.closest<HTMLElement>("[data-fullscreen-surface]");
    if (!target) return;
    if (viewportFullscreen) { setViewportFullscreen(false); return; }
    try {
      if (document.fullscreenElement === target) await document.exitFullscreen();
      else if (target.requestFullscreen) await target.requestFullscreen();
      else setViewportFullscreen(true);
    } catch {
      if (target.isConnected) setViewportFullscreen(true);
    }
  };

  return <button ref={buttonRef} type="button" className={className} aria-label={fullscreen ? "Exit full screen" : "Enter full screen"} title={fullscreen ? "Exit full screen" : "Full screen"} aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>;
}