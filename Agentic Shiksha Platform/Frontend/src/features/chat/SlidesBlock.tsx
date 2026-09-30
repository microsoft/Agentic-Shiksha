import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Download, Loader2, Pencil, Play, Presentation, RefreshCw, StickyNote, Volume2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AssetFullscreenButton } from "@/components/assets/AssetFullscreenButton";
import { enableSlidesTool, exportSlideDeck, getSlidesToolStatus, invalidateCourseInfoCache, type SlidesToolStatus } from "@/lib/api";
import { useUserStore } from "@/lib/userStore";
import { isSlideSourceUrl, parseSlideDeck, parseSlidesBlock, SLIDES_INVALID_MESSAGE, type CompleteSlidesBlock, type SlideDeck, type SlideHighlightTarget, type SlidesContentBlock } from "@/lib/slides";
import { slideFilename } from "@/lib/slidesEditing";
import { SlideCanvas } from "./SlideCanvas";
import SlidesEditor from "./SlidesEditor";
import SlidesPresenter from "./SlidesPresenter";
import SlideNarration from "./SlideNarration";
import SlideNotes from "./SlideNotes";
import "./SlidesBlock.css";

const BUTTON = "slides-button";
type SlidesOptions = {
  agentId?: string; allowDownload?: boolean; active?: boolean; toolbarTarget?: HTMLElement | null;
  onSaved?: (block: CompleteSlidesBlock) => void;
};

function SlidesViewer({ block, agentId, allowDownload = true, active = true, toolbarTarget, onSaved }: SlidesOptions & { block: CompleteSlidesBlock }) {
  const [currentBlock, setCurrentBlock] = useState(block);
  const { deck } = currentBlock;
  const authenticated = useUserStore(state => Boolean(state.userId && state.isAuthenticated && state.authProvider !== "temp"));
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [notes, setNotes] = useState(false);
  const [narration, setNarration] = useState(false);
  const [highlightedTarget, setHighlightedTarget] = useState<SlideHighlightTarget | null>(null);
  const [railEdges, setRailEdges] = useState({ start: true, end: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const downloadUrls = useRef(new Map<string, number>());
  const thumbnails = useRef<HTMLElement | null>(null);
  const selectedThumbnail = useRef<HTMLButtonElement | null>(null);
  const viewer = useRef<HTMLElement | null>(null);
  const notesId = useId();
  const narrationId = useId();
  const sourceAgent = currentBlock.agentId || agentId;
  const canEdit = allowDownload && authenticated && !!sourceAgent;
  const slide = deck.slides[Math.min(index, deck.slides.length - 1)];
  const updateRailEdges = () => {
    const rail = thumbnails.current;
    if (rail) setRailEdges({ start: rail.scrollLeft <= 1, end: rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1 });
  };

  useLayoutEffect(() => {
    setError(null);
    setBusy(false);
    const urls = downloadUrls.current;
    return () => {
      request.current?.abort();
      request.current = null;
      for (const [url, timer] of urls) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, [sourceAgent, currentBlock.slidesId, allowDownload, active]);

  useLayoutEffect(() => {
    const rail = thumbnails.current;
    const selected = selectedThumbnail.current;
    if (!rail || !selected) return;
    const reveal = () => {
      const frame = rail.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (item.left < frame.left + 3) rail.scrollLeft += item.left - frame.left - 3;
      else if (item.right > frame.right - 3) rail.scrollLeft += item.right - frame.right + 3;
      updateRailEdges();
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [index, deck]);

  const navigate = (next: number) => {
    setHighlightedTarget(null);
    setIndex(Math.max(0, Math.min(deck.slides.length - 1, next)));
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (editing || presenting || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented
      || !(event.target instanceof HTMLElement) || event.target.closest("input, textarea, select, [contenteditable=true]")) return;
    const next = { ArrowLeft: index - 1, PageUp: index - 1, ArrowRight: index + 1, PageDown: index + 1, Home: 0, End: deck.slides.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(next);
  };
  const downloadDeck = async (draft: SlideDeck, format: "pptx" | "json") => {
    if (!sourceAgent || !allowDownload || !active) throw new Error("Downloads are unavailable for this presentation.");
    if (request.current) throw new Error("A download is already in progress.");
    const normalized = parseSlideDeck(draft);
    if (!normalized) throw new Error(SLIDES_INVALID_MESSAGE);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const blob = format === "pptx" ? await exportSlideDeck(sourceAgent, normalized, controller.signal)
        : new Blob([JSON.stringify(normalized, null, 2)], { type: "application/json" });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      downloadUrls.current.set(url, window.setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current.delete(url);
      }, 1000));
      const link = document.createElement("a");
      link.href = url;
      link.download = slideFilename(normalized.title, format);
      try {
        document.body.append(link);
        link.click();
      } finally {
        link.remove();
      }
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  const download = async () => {
    try { await downloadDeck(deck, "pptx"); }
    catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      setError(`PowerPoint download failed. ${failure instanceof Error ? failure.message : "Please try again."}`);
    }
  };

  const openWorkspace = async (mode: "edit" | "present") => {
    const surface = viewer.current?.closest("[data-fullscreen-surface]");
    try {
      if (surface && document.fullscreenElement === surface) await document.exitFullscreen();
      surface?.dispatchEvent(new Event("asset-fullscreen-exit"));
      setHighlightedTarget(null);
      if (mode === "edit") setEditing(true);
      else setPresenting(true);
    } catch {
      setError("Exit full screen before opening the presentation workspace.");
    }
  };

  const downloadButton = <button type="button" className={`${BUTTON} slides-icon-button`} aria-label={busy ? "Exporting presentation" : "Download PPTX"} title={!allowDownload ? "PowerPoint export is unavailable in shared chats" : !sourceAgent ? "The originating TA is unavailable" : busy ? "Exporting presentation" : "Download PPTX"} disabled={busy || !sourceAgent || !allowDownload || !active} onClick={() => void download()}>
    {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
  </button>;
  const paneActions = <>
    <button type="button" className={`${BUTTON} slides-icon-button`} aria-label="Start presentation" title="Start presentation" disabled={!active || busy} onClick={() => void openWorkspace("present")}><Play aria-hidden="true" /></button>
    {canEdit && <button type="button" className={`${BUTTON} slides-icon-button`} aria-label="Edit presentation" title="Edit a copy of this presentation" disabled={!active || busy} onClick={() => void openWorkspace("edit")}><Pencil aria-hidden="true" /></button>}
    <button type="button" className={`${BUTTON} slides-notes-toggle`} aria-label={notes ? "Hide speaker notes" : "Show speaker notes"} title={notes ? "Hide speaker notes" : "Show speaker notes"} aria-expanded={notes} aria-controls={notesId} onClick={() => setNotes(value => !value)}><StickyNote aria-hidden="true" /><span>Notes</span></button>
    <button type="button" className={`${BUTTON} slides-icon-button`} aria-label={narration ? "Hide narration" : "Read aloud"} title={narration ? "Hide narration" : "Read slide text or speaker notes aloud"} aria-expanded={narration} aria-controls={narrationId} disabled={!active} onClick={() => { setNarration(value => !value); setHighlightedTarget(null); }}><Volume2 aria-hidden="true" /></button>
    {downloadButton}
    <AssetFullscreenButton className={`${BUTTON} slides-icon-button`} />
  </>;

  return <section ref={viewer} className="slides-viewer" data-fullscreen-surface={toolbarTarget === undefined ? "" : undefined} aria-label="Slide presentation" tabIndex={0} onKeyDown={keyDown} data-testid="slides-viewer">
    {toolbarTarget && createPortal(paneActions, toolbarTarget)}
    {toolbarTarget === undefined && <div className="slides-toolbar" role="group" aria-label="Presentation actions">{paneActions}</div>}
    {error && <p role="alert" className="slides-notice">{error}</p>}
    <div className="slides-stage">
      <div className="slides-canvas-area"><SlideCanvas slide={slide} theme={deck.theme} index={index} count={deck.slides.length} highlightedTarget={highlightedTarget} /></div>
    </div>
    <div className="slides-details" hidden={!notes}>
      <div id={notesId} hidden={!notes} className="slides-notes">
        <h4>Speaker notes · Slide {index + 1}</h4>
        <SlideNotes slide={slide} highlightedTarget={highlightedTarget} />
      </div>
      {slide.sources.length > 0 && <section className="slides-sources" aria-label={`Sources for slide ${index + 1}`}>
        <h4>Sources</h4>
        <ul>{slide.sources.map((source, position) => <li key={position}>{isSlideSourceUrl(source.url)
          ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<span className="sr-only"> (opens in a new tab)</span></a>
          : source.title}</li>)}</ul>
      </section>}
    </div>
    {narration && <div className="slides-narration-slot" id={narrationId}>
      <SlideNarration deck={deck} index={index} onNavigate={navigate} active={active && !editing && !presenting} onHighlightChange={setHighlightedTarget}
        agentId={sourceAgent} allowAzure={canEdit} />
    </div>}
    <div className="slides-filmstrip">
      <button type="button" className={`${BUTTON} slides-icon-button`} aria-label="Scroll to earlier slides" title="Earlier slides" disabled={railEdges.start} onClick={() => thumbnails.current?.scrollBy({ left: -Math.max(72, thumbnails.current.clientWidth - 72) })}><ChevronLeft aria-hidden="true" /></button>
      <nav ref={thumbnails} className="slides-thumbnails" aria-label="Choose a slide" onScroll={updateRailEdges}>
        {deck.slides.map((item, position) => <button key={position} ref={index === position ? selectedThumbnail : undefined} type="button" className={`slides-thumbnail slides-theme-${deck.theme}`} aria-label={`Go to slide ${position + 1}: ${item.title}`} title={`${position + 1}. ${item.title}`} aria-current={index === position ? "step" : undefined} onClick={() => navigate(position)}>
          <span className="slides-thumbnail-number" aria-hidden="true">{position + 1}</span><span>{item.title}</span>
        </button>)}
      </nav>
      <button type="button" className={`${BUTTON} slides-icon-button`} aria-label="Scroll to later slides" title="Later slides" disabled={railEdges.end} onClick={() => thumbnails.current?.scrollBy({ left: Math.max(72, thumbnails.current.clientWidth - 72) })}><ChevronRight aria-hidden="true" /></button>
      <span role="status" aria-live="polite" aria-label={`Slide ${index + 1} of ${deck.slides.length}`} className="slides-count">{index + 1} / {deck.slides.length}</span>
    </div>
    {active && editing && canEdit && sourceAgent && <SlidesEditor deck={deck} initialIndex={index} agentId={sourceAgent}
      onClose={() => setEditing(false)} onExport={downloadDeck} onSaved={saved => {
        setCurrentBlock(saved); setIndex(0); setHighlightedTarget(null); setEditing(false); onSaved?.(saved);
      }} />}
    {active && presenting && <SlidesPresenter deck={deck} initialIndex={index} agentId={sourceAgent} allowAzure={canEdit} onClose={position => { setPresenting(false); navigate(position); }} />}
  </section>;
}

export default function SlidesBlock({ block, ...options }: SlidesOptions & { block: unknown }) {
  const parsed = useMemo(() => parseSlidesBlock(block), [block]);
  const account = useUserStore(state => JSON.stringify([state.userId, state.isAuthenticated, state.authProvider]));
  // Equal saved snapshots keep navigation; a changed deck/title resets it and cancels the old export.
  const revision = useMemo(() => parsed ? JSON.stringify([parsed.slidesId, parsed.deck]) : "", [parsed]);
  return parsed ? <SlidesViewer key={`${account}:${revision}`} block={parsed} {...options} />
    : <p role="alert" className="slides-notice">{SLIDES_INVALID_MESSAGE}</p>;
}

function SlidesDialogBody({ block, onSaved, ...options }: SlidesOptions & { block: SlidesContentBlock }) {
  const [current, setCurrent] = useState(block);
  return <>
    <DialogTitle className="pr-8 break-words">{current.title || "Slide presentation"}</DialogTitle>
    <DialogDescription className="sr-only">Preview, present, edit a private copy, or export to PowerPoint.</DialogDescription>
    <SlidesBlock block={current} {...options} onSaved={saved => { setCurrent(saved); onSaved?.(saved); }} />
  </>;
}

export function SlidesDialog({ block, agentId, allowDownload, open, onOpenChange, onSaved }: {
  block: SlidesContentBlock; agentId?: string; allowDownload?: boolean; open: boolean; onOpenChange: (open: boolean) => void;
  onSaved?: (block: CompleteSlidesBlock) => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="slides-dialog">
    <SlidesDialogBody key={JSON.stringify(block)} block={block} agentId={agentId} allowDownload={allowDownload} active={open} onSaved={onSaved} />
  </DialogContent></Dialog>;
}

export function SlidesLaunchCard({ block, agentId, allowDownload = true, onOpen }: { block: SlidesContentBlock; agentId?: string; allowDownload?: boolean; onOpen?: (block: CompleteSlidesBlock) => void }) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseSlidesBlock(block), [block]);
  if (block.isStreaming && !block.deck) return <div role="status" className="slides-launch"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /><span>Creating slide deck…</span></div>;
  if (!parsed) return <p role="alert" className="slides-notice">{SLIDES_INVALID_MESSAGE}</p>;
  const openButton = <button type="button" className={`${BUTTON} slides-launch-open`} aria-label={`Open slides: ${parsed.title}`} onClick={onOpen ? () => onOpen(parsed) : undefined}>Open</button>;
  const card = <div className="slides-launch" id={`asset-anchor-${parsed.slidesId}`} data-testid="slides-launch-card">
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15"><Presentation className="h-6 w-6 text-cyan-400" aria-hidden="true" /></div>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white" title={parsed.title}>{parsed.title}</p><p className="text-xs text-neutral-500">Presentation · PPTX · {parsed.deck.slides.length} slides</p></div>
    {onOpen ? openButton : <DialogTrigger asChild>{openButton}</DialogTrigger>}
  </div>;
  if (onOpen) return card;
  return <Dialog open={open} onOpenChange={setOpen}>
    {card}
    <DialogContent className="slides-dialog">
      <SlidesDialogBody key={JSON.stringify(parsed)} block={parsed} agentId={agentId} allowDownload={allowDownload} active={open} />
    </DialogContent>
  </Dialog>;
}

export function SlidesToolControl({ agentId, initialStatus, initialError }: {
  agentId: string; initialStatus: SlidesToolStatus | null; initialError: string | null;
}) {
  const [status, setStatus] = useState<SlidesToolStatus | null>(initialStatus);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [revision, setRevision] = useState(0);
  const account = useUserStore(state => JSON.stringify([state.userId, state.role, state.isAuthenticated]));
  const request = useRef<AbortController | null>(null);
  const updating = Boolean(status?.enabled && status.update_available);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setStatus(revision === 0 ? initialStatus : null);
    setError(revision === 0 ? initialError : null);
    setConfirm(false);
    setBusy(false);
    if (revision > 0) {
      getSlidesToolStatus(agentId, controller.signal).then(value => {
        if (!controller.signal.aborted) setStatus(value);
      }).catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Slide tool status unavailable.");
      });
    }
    return () => { controller.abort(); request.current?.abort(); };
  }, [agentId, account, revision, initialStatus, initialError]);

  const enable = async () => {
    if (!status || busy || !confirm) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await enableSlidesTool(agentId, status.agent_version, controller.signal);
      if (!controller.signal.aborted) { setStatus(result); setConfirm(false); }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setConfirm(false);
        setStatus(null);
        setError(failure instanceof Error ? failure.message : "Tool update could not be confirmed. Recheck status before retrying.");
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <section aria-label="Slide presentation tool" className="text-xs text-neutral-200">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2">
        {status?.enabled ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" /> : <span className="w-3.5 shrink-0" aria-hidden="true" />}
        Slide presentations{status?.enabled && <span className="sr-only">Enabled</span>}
      </span>
      {status && (!status.enabled || updating) && <button type="button" className={BUTTON} disabled={busy} onClick={() => setConfirm(true)}>{updating ? "Update slides" : "Enable slides"}</button>}
      {!status && !error && <Loader2 role="status" aria-label="Checking slide tool status" className="h-4 w-4 animate-spin" />}
    </div>
    {confirm && <div className="mt-3 space-y-2">
      <p className="text-xs text-neutral-400">{updating ? "Update this TA's slide layouts and speaker-note guidance?" : "Add slide presentations to this TA?"} This creates a new agent version and preserves its other tools and settings. PowerPoint files are generated by the backend, not an external MCP service.</p>
      <div className="flex justify-end gap-2"><button type="button" className={BUTTON} disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button type="button" className={BUTTON} disabled={busy} onClick={() => void enable()}>{busy ? updating ? "Updating…" : "Enabling…" : updating ? "Confirm update slides" : "Confirm enable slides"}</button></div>
    </div>}
    {error && <div role="alert" className="mt-2 flex items-center gap-2 text-xs text-amber-300"><span className="min-w-0 flex-1 break-words">{error}</span><button type="button" className={BUTTON} disabled={busy} aria-label="Recheck slide tool" onClick={() => { invalidateCourseInfoCache(agentId); setRevision(value => value + 1); }}><RefreshCw className="h-4 w-4" /></button></div>}
  </section>;
}
