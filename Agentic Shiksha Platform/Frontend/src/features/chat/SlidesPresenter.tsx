import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, CirclePause, Play, StickyNote, Volume2, X } from "lucide-react";
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { isSlideSourceUrl, type SlideDeck, type SlideHighlightTarget } from "@/lib/slides";
import { SlideCanvas } from "./SlideCanvas";
import SlideNarration from "./SlideNarration";
import SlideNotes from "./SlideNotes";
import "./SlidesPresenter.css";

export type SlidesPresenterProps = {
  deck: SlideDeck;
  initialIndex: number;
  onClose: (index: number) => void;
  agentId?: string;
  allowAzure?: boolean;
};

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox], [role=combobox], [role=slider], [role=spinbutton], [role=listbox]";
const INTERACTIVE = `${EDITABLE}, button, a, [role=button]`;
const clampIndex = (index: number, count: number) => Math.max(0, Math.min(count - 1, Number.isFinite(index) ? Math.trunc(index) : 0));
const elapsedTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes < 60 ? String(minutes).padStart(2, "0") : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`}:${String(seconds % 60).padStart(2, "0")}`;
};

export default function SlidesPresenter({ deck, initialIndex, onClose, agentId, allowAzure = false }: SlidesPresenterProps) {
  const count = deck.slides.length;
  const [index, setIndex] = useState(() => clampIndex(initialIndex, count));
  const [notesVisible, setNotesVisible] = useState(false);
  const [narrationVisible, setNarrationVisible] = useState(false);
  const [highlightedTarget, setHighlightedTarget] = useState<SlideHighlightTarget | null>(null);
  const [blank, setBlank] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [returnFocus] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [fullscreenSurface] = useState(() => typeof document !== "undefined" && document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined);
  const stage = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const swipe = useRef<{ id: number; x: number; y: number; started: number } | null>(null);
  const notesId = useId();
  const narrationId = useId();
  const instructionsId = useId();
  const currentIndex = clampIndex(index, count);
  const slide = deck.slides[currentIndex];
  const narrationTarget = !blank && narrationVisible ? highlightedTarget : null;
  const position = slide ? currentIndex + 1 : 0;
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    onClose(currentIndex);
  }, [currentIndex, onClose]);

  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!fullscreenSurface) return;
    // Stay in an existing fullscreen top layer, and leave the player when that layer exits.
    const changed = () => { if (document.fullscreenElement !== fullscreenSurface) close(); };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [fullscreenSurface, close]);

  const navigate = (next: number) => {
    setIndex(clampIndex(next, count));
    setBlank(false);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Portals still bubble through the preview's React tree. Keep its shortcuts isolated.
    event.stopPropagation();
    const target = event.target instanceof Element ? event.target : null;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing
      || target?.closest(EDITABLE)) return;
    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      if (!event.repeat) setBlank(value => !value);
      return;
    }
    if (target?.closest(".slides-presenter-notes")) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp": next = currentIndex - 1; break;
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown": next = currentIndex + 1; break;
      case "Home": next = 0; break;
      case "End": next = count - 1; break;
      case " ":
        if (target?.closest(INTERACTIVE)) return;
        next = currentIndex + (event.shiftKey ? -1 : 1);
        break;
      default: return;
    }
    event.preventDefault();
    navigate(next);
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swipe.current = null;
    if (!event.isPrimary || event.pointerType === "mouse" || event.button !== 0
      || (event.target instanceof Element && event.target.closest(INTERACTIVE))) return;
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now() };
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId) return;
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    const threshold = Math.max(48, Math.min(event.currentTarget.clientWidth * 0.12, 120));
    if (performance.now() - start.started > 1000 || Math.abs(x) < threshold || Math.abs(x) < Math.abs(y) * 1.5) return;
    navigate(currentIndex + (x < 0 ? 1 : -1));
  };

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogPortal container={fullscreenSurface}>
      <DialogOverlay className="slides-presenter-overlay" />
      <DialogPrimitive.Content
        className={`slides-presenter${blank ? " slides-presenter-blank" : ""}`}
        data-testid="slide-presentation"
        onKeyDown={keyDown}
        onInteractOutside={event => event.preventDefault()}
        onOpenAutoFocus={event => {
          event.preventDefault();
          stage.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={event => {
          event.preventDefault();
          event.stopPropagation();
          if (!event.isComposing) close();
        }}
      >
        <header className="slides-presenter-header">
          <div className="slides-presenter-heading">
            <span className="slides-presenter-kicker">Presentation</span>
            <DialogTitle className="slides-presenter-title"><span className="sr-only">Presentation: </span>{deck.title}</DialogTitle>
          </div>
          <span className="slides-presenter-timer" role="timer" aria-label="Elapsed presentation time" aria-live="off">{elapsedTime(elapsed)}</span>
          <button type="button" className="slides-presenter-button" aria-label="Exit presentation" aria-keyshortcuts="Escape" onClick={close}>
            <X aria-hidden="true" /><span>Exit</span>
          </button>
        </header>
        <DialogDescription className="sr-only">
          <span id={instructionsId}>
            Use arrow keys, Page Up, Page Down, or Space to move between slides. Home and End jump to the first and last slides.
            B blanks or restores the screen. Escape exits and returns to the current slide in the preview. Notes are hidden until you show them.
          </span>
        </DialogDescription>
        <div className="slides-presenter-body">
          <div
            ref={stage}
            className="slides-presenter-stage"
            data-testid="presentation-stage"
            role="group"
            aria-label="Presentation slide"
            aria-describedby={instructionsId}
            tabIndex={0}
            onPointerDown={pointerDown}
            onPointerUp={pointerUp}
            onPointerCancel={() => { swipe.current = null; }}
          >
            <div className="slides-presenter-canvas-area" aria-hidden={blank} style={blank ? { visibility: "hidden" } : undefined}>
              {slide ? <SlideCanvas slide={slide} theme={deck.theme} index={currentIndex} count={count} highlightedTarget={narrationTarget} /> : <p>No slides to present.</p>}
            </div>
          </div>
          <div className="slides-presenter-panels" hidden={blank || (!notesVisible && !narrationVisible)}>
          {narrationVisible && <div id={narrationId} className="slides-presenter-narration">
            <SlideNarration deck={deck} index={currentIndex} onNavigate={setIndex} active={!blank} onHighlightChange={setHighlightedTarget} agentId={agentId} allowAzure={allowAzure} />
          </div>}
          <aside id={notesId} className="slides-presenter-notes" aria-label="Speaker notes and sources" tabIndex={0} hidden={!notesVisible || blank}>
            <p className="slides-presenter-notes-warning">Notes are visible on this screen.</p>
            <section>
              <h2>Speaker notes</h2>
              {slide ? <SlideNotes slide={slide} highlightedTarget={narrationTarget} /> : <p>No speaker notes for this slide.</p>}
            </section>
            <section>
              <h2>Sources</h2>
              {slide?.sources.length ? <ul>{slide.sources.map((source, sourceIndex) => <li key={sourceIndex}>
                {isSlideSourceUrl(source.url)
                  ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<span className="sr-only"> (opens in a new tab)</span></a>
                  : source.title}
              </li>)}</ul> : <p>No sources for this slide.</p>}
            </section>
          </aside>
          </div>
        </div>
        <footer className="slides-presenter-controls">
          <span className="slides-presenter-shortcuts" aria-hidden="true">← → / Space · B blank · Esc exit</span>
          <div className="slides-presenter-navigation" role="group" aria-label="Slide navigation">
            <button type="button" className="slides-presenter-button slides-presenter-arrow" aria-label="Previous slide" disabled={currentIndex === 0 || !slide} onClick={() => navigate(currentIndex - 1)}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <span className="slides-presenter-count" data-testid="presentation-counter" aria-label={`Slide ${position} of ${count}`}>{position} / {count}</span>
            <button type="button" className="slides-presenter-button slides-presenter-arrow" aria-label="Next slide" disabled={currentIndex >= count - 1 || !slide} onClick={() => navigate(currentIndex + 1)}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className="slides-presenter-tools" role="group" aria-label="Presentation controls">
            <button type="button" className="slides-presenter-button" aria-label="Read aloud" aria-controls={narrationVisible ? narrationId : undefined} aria-expanded={narrationVisible && !blank} disabled={blank} onClick={() => setNarrationVisible(value => !value)}>
              <Volume2 aria-hidden="true" /><span>Read aloud</span>
            </button>
            <button type="button" className="slides-presenter-button" aria-label={notesVisible ? "Hide notes and sources" : "Show notes and sources"} aria-controls={notesId} aria-expanded={notesVisible && !blank} disabled={blank} onClick={() => setNotesVisible(value => !value)}>
              <StickyNote aria-hidden="true" /><span>{notesVisible && !blank ? "Notes visible" : "Notes"}</span>
            </button>
            <button type="button" className="slides-presenter-button" aria-label={blank ? "Show slide" : "Blank screen"} aria-keyshortcuts="B" aria-pressed={blank} onClick={() => setBlank(value => !value)}>
              {blank ? <Play aria-hidden="true" /> : <CirclePause aria-hidden="true" />}<span>{blank ? "Resume" : "Blank"}</span>
            </button>
          </div>
        </footer>
        <div className="slides-presenter-progress" role="progressbar" aria-label="Presentation progress" aria-valuemin={0} aria-valuemax={Math.max(count, 1)} aria-valuenow={position} aria-valuetext={`Slide ${position} of ${count}`}>
          <span style={{ width: `${count ? position / count * 100 : 0}%` }} />
        </div>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {blank ? "Screen blanked. Press B or Resume to show the slide." : slide ? `Slide ${position} of ${count}: ${slide.title}` : "No slides to present."}
        </span>
      </DialogPrimitive.Content>
    </DialogPortal>
  </Dialog>;
}
