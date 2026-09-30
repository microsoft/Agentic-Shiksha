import { useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Download, Loader2, Plus, Redo2, Save, Trash2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { saveSlideDeck } from "@/lib/api";
import {
  isSlideSourceUrl, isSlideText, slideBulletLimits, slideComponents, SLIDE_LAYOUTS, SLIDE_LIMITS, SLIDE_THEMES,
  type CompleteSlidesBlock, type Slide, type SlideDeck, type SlideHighlightTarget,
} from "@/lib/slides";
import {
  changeSlideLayout, createSlidesEditorState, importSlideDeck, newSlide, removeSlideBullet, slideDeckErrors, slideDeckQuality, updateComponentNote,
  slidesEditorReducer, SLIDE_LAYOUT_LABELS,
} from "@/lib/slidesEditing";
import { SlideCanvas } from "./SlideCanvas";
import "./SlidesEditor.css";

type Confirmation = { kind: "discard" } | { kind: "delete"; index: number } | { kind: "import"; deck: SlideDeck };
type Props = {
  deck: SlideDeck;
  initialIndex: number;
  agentId: string;
  onClose: () => void;
  onSaved: (block: CompleteSlidesBlock) => void;
  onExport: (deck: SlideDeck, format: "pptx" | "json") => Promise<void>;
};

function TextField({ label, value, max, onChange, required = false, multiline = false, invalid = false }: {
  label: string; value: string; max: number; onChange: (value: string) => void;
  required?: boolean; multiline?: boolean; invalid?: boolean;
}) {
  const props = {
    // Native maxLength counts UTF-16 units; deck validation counts Unicode characters.
    value, maxLength: max * 2, required,
    "aria-invalid": invalid || !isSlideText(value, max, required),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  };
  return <label className="slides-editor-field">
    <span className="slides-editor-field-label"><span>{label}</span><span aria-hidden="true">{Array.from(value).length}/{max}</span></span>
    {multiline ? <textarea {...props} rows={label === "Speaker notes" ? 5 : 2} /> : <input {...props} type="text" />}
  </label>;
}

export default function SlidesEditor({ deck: original, initialIndex, agentId, onClose, onSaved, onExport }: Props) {
  const [state, dispatch] = useReducer(slidesEditorReducer, undefined, () => createSlidesEditorState(original, initialIndex));
  const { deck, index } = state;
  const slide = deck.slides[index];
  const [focusedNote, setFocusedNote] = useState<SlideHighlightTarget | null>(null);
  const components = useMemo(() => slideComponents(slide), [slide]);
  const unmatchedNotes = (slide.component_notes ?? []).filter(note => !components.some(component => component.target === note.target));
  const [pending, setPending] = useState<"save" | "export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const request = useRef<AbortController | null>(null);
  const operation = useRef(false);
  const lifetime = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const errors = useMemo(() => slideDeckErrors(deck), [deck]);
  const quality = useMemo(() => slideDeckQuality(deck), [deck]);
  const dirty = JSON.stringify(deck) !== JSON.stringify(original);
  const busy = pending !== null;

  useEffect(() => () => { lifetime.current += 1; request.current?.abort(); }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty, busy]);

  const replace = (next: SlideDeck, selected = index, mergeKey?: string) => {
    setError(null);
    dispatch({ type: "replace", deck: next, index: selected, mergeKey });
  };
  const editDeck = (patch: Partial<Pick<SlideDeck, "title" | "subtitle" | "theme">>, field: string) =>
    replace({ ...deck, ...patch }, index, `deck-${field}`);
  const editSlide = (patch: Partial<Slide>, field?: string) =>
    replace({ ...deck, slides: deck.slides.map((item, position) => position === index ? { ...item, ...patch } : item) }, index, field ? `slide-${index}-${field}` : undefined);
  const move = (offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= deck.slides.length) return;
    const slides = [...deck.slides];
    [slides[index], slides[target]] = [slides[target], slides[index]];
    replace({ ...deck, slides }, target);
  };
  const add = (duplicate: boolean) => {
    if (deck.slides.length >= SLIDE_LIMITS.slides) return;
    const slides = [...deck.slides];
    slides.splice(index + 1, 0, duplicate ? structuredClone(slide) : newSlide());
    replace({ ...deck, slides }, index + 1);
  };
  const close = () => {
    if (operation.current) return;
    if (dirty) setConfirmation({ kind: "discard" });
    else onClose();
  };
  const confirm = () => {
    if (!confirmation) return;
    if (confirmation.kind === "discard") onClose();
    else if (confirmation.kind === "import") replace(confirmation.deck, 0);
    else if (deck.slides.length > 1) {
      const slides = deck.slides.filter((_, position) => position !== confirmation.index);
      replace({ ...deck, slides }, Math.min(index, slides.length - 1));
    }
    setConfirmation(null);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // React portal events also bubble to the underlying viewer.
    event.stopPropagation();
    if (event.altKey || !(event.ctrlKey || event.metaKey) || event.defaultPrevented || confirmation) return;
    if (["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (!busy) {
        setError(null);
        dispatch({ type: event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo" });
      }
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!busy && !errors.length) void save();
    }
  };

  const save = async () => {
    if (operation.current || errors.length) return;
    operation.current = true;
    const current = lifetime.current;
    const controller = new AbortController();
    request.current = controller;
    setPending("save");
    setError(null);
    try {
      const saved = await saveSlideDeck(agentId, deck, controller.signal);
      if (lifetime.current !== current || controller.signal.aborted) return;
      toast.success("Presentation saved as a private copy in Assets. The original is unchanged.");
      onSaved(saved.block);
      onClose();
    } catch (failure) {
      if (lifetime.current === current && !controller.signal.aborted) setError(`Could not save the presentation. ${failure instanceof Error ? failure.message : "Please try again."}`);
    } finally {
      if (lifetime.current === current) { operation.current = false; request.current = null; setPending(null); }
    }
  };

  const exportDraft = async (format: "pptx" | "json") => {
    if (operation.current || errors.length) return;
    operation.current = true;
    const current = lifetime.current;
    setPending("export");
    setError(null);
    try { await onExport(deck, format); }
    catch (failure) {
      if (lifetime.current === current) setError(`Export failed. ${failure instanceof Error ? failure.message : "Please try again."}`);
    } finally {
      if (lifetime.current === current) { operation.current = false; setPending(null); }
    }
  };

  const importFile = async (file: File) => {
    if (operation.current) return;
    operation.current = true;
    const current = lifetime.current;
    setPending("import");
    setError(null);
    try {
      if (file.size > SLIDE_LIMITS.importBytes) throw new Error("Choose a presentation JSON file smaller than 2 MB.");
      const imported = importSlideDeck(await file.text());
      if (lifetime.current === current) setConfirmation({ kind: "import", deck: imported });
    } catch (failure) {
      if (lifetime.current === current) setError(failure instanceof Error ? failure.message : "The presentation file could not be read.");
    } finally {
      if (lifetime.current === current) { operation.current = false; setPending(null); }
    }
  };

  const bulletEditor = (items: string[], columnIndex?: number) => {
    const limits = slideBulletLimits(slide.layout);
    const minimum = columnIndex === undefined ? limits.min : 1;
    const maximum = columnIndex === undefined ? limits.max : SLIDE_LIMITS.columnBullets;
    const maxLength = columnIndex === undefined ? limits.length : SLIDE_LIMITS.columnBullet;
    const itemName = columnIndex === undefined && slide.layout === "process" ? "step"
      : columnIndex === undefined && slide.layout === "timeline" ? "milestone" : "bullet";
    const update = (next: string[], field?: string) => columnIndex === undefined ? editSlide({ bullets: next }, field)
      : editSlide({ columns: slide.columns.map((column, position) => position === columnIndex ? { ...column, bullets: next } : column) }, field);
    const prefix = columnIndex === undefined ? "" : `Column ${columnIndex + 1} `;
    return <div className="slides-editor-list">
      {items.map((bullet, position) => <div className="slides-editor-list-item" key={position}>
        <TextField label={`${prefix}${itemName.charAt(0).toUpperCase() + itemName.slice(1)} ${position + 1}`} value={bullet} max={maxLength} required multiline
          onChange={value => update(items.map((item, i) => i === position ? value : item), `${prefix}bullet-${position}`)} />
        <button type="button" className="slides-button slides-icon-button" aria-label={`Remove ${prefix.toLowerCase()}${itemName} ${position + 1}`} disabled={items.length <= minimum}
          onClick={() => editSlide(removeSlideBullet(slide, position, columnIndex))}><Trash2 aria-hidden="true" /></button>
      </div>)}
      <button type="button" className="slides-button" disabled={items.length >= maximum} onClick={() => update([...items, ""])}><Plus aria-hidden="true" />Add {prefix.toLowerCase()}{itemName}</button>
      <p className="slides-editor-hint">{minimum}-{maximum} {itemName}s, {maxLength} characters each.</p>
    </div>;
  };

  return <>
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="slides-editor" onKeyDown={keyDown}
        onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); close(); }}
        onPointerDownOutside={event => event.preventDefault()}
        onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }}>
        <header className="slides-editor-heading">
          <DialogTitle>Edit presentation</DialogTitle>
          <DialogDescription>Save a private copy to Assets. The original chat presentation stays unchanged.</DialogDescription>
        </header>
        <div className="slides-editor-toolbar" role="group" aria-label="Editing actions">
          <button type="button" className="slides-button" disabled={busy || !state.past.length} onClick={() => { setError(null); dispatch({ type: "undo" }); }} title="Undo (Ctrl/Cmd+Z)"><Undo2 aria-hidden="true" />Undo</button>
          <button type="button" className="slides-button" disabled={busy || !state.future.length} onClick={() => { setError(null); dispatch({ type: "redo" }); }} title="Redo (Ctrl/Cmd+Shift+Z)"><Redo2 aria-hidden="true" />Redo</button>
          <button type="button" className="slides-button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" />Import JSON</button>
          <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Import presentation JSON" hidden onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }} />
          <button type="button" className="slides-button" disabled={busy || !!errors.length} onClick={() => void exportDraft("json")}><Download aria-hidden="true" />Download JSON</button>
          <button type="button" className="slides-button" disabled={busy || !!errors.length} onClick={() => void exportDraft("pptx")}><Download aria-hidden="true" />Download PPTX</button>
        </div>
        {error && <p role="alert" className="slides-notice">{error}</p>}
        {errors.length > 0 && <p role="status" className="slides-notice">{errors[0]}{errors.length > 1 ? ` (${errors.length - 1} more fields need attention.)` : ""}</p>}
        <fieldset className="slides-editor-workspace" disabled={busy} onBlur={() => dispatch({ type: "checkpoint" })}>
          <legend className="sr-only">Presentation draft</legend>
          <div className="slides-editor-form">
            <section aria-label="Presentation details" className="slides-editor-section">
              <h3>Presentation details</h3>
              <TextField label="Presentation title" value={deck.title} max={SLIDE_LIMITS.title} required onChange={value => editDeck({ title: value }, "title")} />
              <TextField label="Presentation subtitle" value={deck.subtitle} max={SLIDE_LIMITS.subtitle} onChange={value => editDeck({ subtitle: value }, "subtitle")} />
              <label className="slides-editor-field"><span>Theme</span><select value={deck.theme} onChange={event => {
                const theme = SLIDE_THEMES.find(value => value === event.target.value);
                if (theme) editDeck({ theme }, "theme");
              }}>{SLIDE_THEMES.map(theme => <option key={theme} value={theme}>{theme.charAt(0).toUpperCase() + theme.slice(1)}</option>)}</select></label>
            </section>
            <section aria-label={`Edit slide ${index + 1}`} className="slides-editor-section">
              <h3>Slide {index + 1} of {deck.slides.length}</h3>
              <label className="slides-editor-field"><span>Slide layout</span><select value={slide.layout} onChange={event => {
                const layout = SLIDE_LAYOUTS.find(value => value === event.target.value);
                if (!layout) return;
                try { editSlide(changeSlideLayout(slide, layout)); }
                catch (failure) { setError(failure instanceof Error ? failure.message : "The layout could not be changed."); }
              }}>{SLIDE_LAYOUTS.map(layout => <option key={layout} value={layout}>{SLIDE_LAYOUT_LABELS[layout]}</option>)}</select></label>
              <p className="slides-editor-hint">Content that does not fit a new layout is preserved in speaker notes. Undo restores the layout.</p>
              <TextField label="Slide title" value={slide.title} max={SLIDE_LIMITS.title} required onChange={value => editSlide({ title: value }, "title")} />
              <TextField label="Slide subtitle" value={slide.subtitle} max={SLIDE_LIMITS.subtitle} multiline onChange={value => editSlide({ subtitle: value }, "subtitle")} />
              {slide.layout === "quote" || slide.layout === "key_stat" ? <>
                <TextField label={slide.layout === "quote" ? "Quotation" : "Featured value"} value={slide.bullets[0]} max={slideBulletLimits(slide.layout).length}
                  required multiline={slide.layout === "quote"} onChange={value => editSlide({ bullets: [value] }, "featured-value")} />
                <p className="slides-editor-hint">{slide.layout === "quote" ? "Use the subtitle for attribution and add a real source below."
                  : "Use a verified figure, then explain its meaning in the subtitle and cite the source below."}</p>
              </> : slide.layout === "two_column" ? slide.columns.map((column, position) => <section key={position} aria-label={`Column ${position + 1}`} className="slides-editor-column">
                <TextField label={`Column ${position + 1} heading`} value={column.heading} max={SLIDE_LIMITS.columnHeading} required
                  onChange={value => editSlide({ columns: slide.columns.map((item, i) => i === position ? { ...item, heading: value } : item) }, `column-${position}-heading`)} />
                {bulletEditor(column.bullets, position)}
              </section>) : !["title", "section"].includes(slide.layout) && bulletEditor(slide.bullets)}
              <div onFocus={() => setFocusedNote("slide")} onBlur={() => setFocusedNote(null)}>
                <TextField label="Speaker notes" value={slide.speaker_notes} max={SLIDE_LIMITS.notes} multiline onChange={value => editSlide({ speaker_notes: value }, "notes")} />
              </div>
              <p className="slides-editor-hint">Slide / topic introduction. These exact saved words play first. Add explanations for each highlighted point below instead of repeating all of them here.</p>
            </section>
            <section aria-label="Component narration notes" className="slides-editor-section">
              <h3>Component narration notes</h3>
              <p className="slides-editor-hint">Each script is linked to the component shown above it. TTS reads these saved words in slide order and highlights that component; it never generates a second script. Review the linked script whenever you change the displayed text. Title and subtitle notes are optional additions to the slide introduction.</p>
              {components.map(component => {
                const text = slide.component_notes?.find(note => note.target === component.target)?.text ?? "";
                return <div key={component.target} className="slides-editor-component-note" data-component-note={component.target}
                  onFocus={() => setFocusedNote(component.target)} onBlur={() => setFocusedNote(null)}>
                  <p className="slides-editor-note-context">{component.text || "(Empty component)"}</p>
                  <TextField label={`${component.label} narration notes`} value={text} max={SLIDE_LIMITS.componentNote} required={Boolean(text)} multiline
                    onChange={value => editSlide(updateComponentNote(slide, component.target, value), `component-notes-${component.target}`)} />
                </div>;
              })}
              {unmatchedNotes.map(note => <div key={note.target} className="slides-editor-component-note">
                <p className="slides-editor-hint">The component "{note.target}" was removed. Restore it or remove its notes before saving.</p>
                <TextField label={`Unmatched ${note.target} notes`} value={note.text} max={SLIDE_LIMITS.componentNote} multiline
                  onChange={value => editSlide(updateComponentNote(slide, note.target, value), `component-notes-${note.target}`)} />
                <button type="button" className="slides-button" onClick={() => editSlide(updateComponentNote(slide, note.target, ""))}>Remove unmatched {note.target} notes</button>
              </div>)}
              <p className="slides-editor-hint">Slide and component notes together can use up to {SLIDE_LIMITS.totalNotes} characters. Removing an item also removes its linked notes; Undo restores both.</p>
            </section>
            <section aria-label="Slide sources" className="slides-editor-section">
              <h3>Sources</h3>
              <p className="slides-editor-hint">Use a source title with an optional HTTP(S) link. Links are not fetched.</p>
              {slide.sources.map((source, position) => <div className="slides-editor-source" key={position}>
                <TextField label={`Source ${position + 1} title`} value={source.title} max={SLIDE_LIMITS.title} required
                  onChange={value => editSlide({ sources: slide.sources.map((item, i) => i === position ? { ...item, title: value } : item) }, `source-${position}-title`)} />
                <TextField label={`Source ${position + 1} URL`} value={source.url ?? ""} max={SLIDE_LIMITS.sourceUrl} invalid={source.url !== null && !isSlideSourceUrl(source.url)}
                  onChange={value => editSlide({ sources: slide.sources.map((item, i) => i === position ? { ...item, url: value || null } : item) }, `source-${position}-url`)} />
                <button type="button" className="slides-button" aria-label={`Remove source ${position + 1}`} onClick={() => editSlide({ sources: slide.sources.filter((_, i) => i !== position) })}><Trash2 aria-hidden="true" />Remove source</button>
              </div>)}
              <button type="button" className="slides-button" disabled={slide.sources.length >= SLIDE_LIMITS.sources} onClick={() => editSlide({ sources: [...slide.sources, { title: "", url: null }] })}><Plus aria-hidden="true" />Add source</button>
            </section>
          </div>
          <section className="slides-editor-preview" aria-label="Live slide preview">
            <div className="slides-editor-slide-actions" role="group" aria-label="Slide actions">
              <button type="button" className="slides-button" disabled={deck.slides.length >= SLIDE_LIMITS.slides} onClick={() => add(false)}><Plus aria-hidden="true" />Add slide</button>
              <button type="button" className="slides-button" disabled={deck.slides.length >= SLIDE_LIMITS.slides} onClick={() => add(true)}><Copy aria-hidden="true" />Duplicate slide</button>
              <button type="button" className="slides-button slides-icon-button" aria-label="Move slide earlier" title="Move slide earlier" disabled={index === 0} onClick={() => move(-1)}><ArrowUp aria-hidden="true" /></button>
              <button type="button" className="slides-button slides-icon-button" aria-label="Move slide later" title="Move slide later" disabled={index === deck.slides.length - 1} onClick={() => move(1)}><ArrowDown aria-hidden="true" /></button>
              <button type="button" className="slides-button slides-icon-button" aria-label="Delete slide" title="Delete slide" disabled={deck.slides.length <= 1} onClick={() => setConfirmation({ kind: "delete", index })}><Trash2 aria-hidden="true" /></button>
            </div>
            <div className="slides-editor-canvas"><div className="slides-canvas-area"><SlideCanvas slide={slide} theme={deck.theme} index={index} count={deck.slides.length} highlightedTarget={focusedNote} /></div></div>
            <p className="slides-editor-hint" role="status">Slide {index + 1} of {deck.slides.length}{deck.slides.length === SLIDE_LIMITS.slides ? " - 20-slide limit reached" : ""}</p>
            <details className="slides-editor-quality">
              <summary>Presentation check <span>{quality.suggestions.length ? `${quality.suggestions.length} suggestions` : "Ready to rehearse"}</span></summary>
              <p>{quality.notesCount} of {deck.slides.length} slides have speaker notes.</p>
              <p>{quality.componentNotesCount} of {quality.componentCount} body components have their own narration notes.</p>
              {quality.suggestions.length > 0 ? <ul>{quality.suggestions.map((suggestion, position) => <li key={position}>
                <button type="button" onClick={() => dispatch({ type: "select", index: suggestion.slideIndex })}>
                  <strong>Slide {suggestion.slideIndex + 1}</strong><span>{suggestion.message}</span>
                </button>
              </li>)}</ul> : <p>No structural suggestions. Rehearse and verify your facts and sources before presenting.</p>}
            </details>
            <nav className="slides-editor-outline" aria-label="Slides in draft">
              {deck.slides.map((item, position) => <button type="button" key={position} aria-current={index === position ? "step" : undefined}
                aria-label={`Edit slide ${position + 1}: ${item.title || "Untitled"}`} onClick={() => dispatch({ type: "select", index: position })}>
                <span>{position + 1}</span><span>{item.title || "Untitled slide"}</span><span>{SLIDE_LAYOUT_LABELS[item.layout]}</span>
              </button>)}
            </nav>
          </section>
        </fieldset>
        <footer className="slides-editor-footer">
          <p role="status">{pending === "save" ? "Saving your private copy..." : pending === "export" ? "Preparing download..." : pending === "import" ? "Reading presentation..." : dirty ? "Unsaved changes" : "Original presentation unchanged"}</p>
          <button type="button" className="slides-button" disabled={busy} onClick={close}>Cancel editing</button>
          <button type="button" className="slides-button slides-editor-save" disabled={busy || !!errors.length} onClick={() => void save()}>
            {pending === "save" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}Save copy to Assets
          </button>
        </footer>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null); }}>
      <AlertDialogContent className="slides-editor-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation?.kind === "discard" ? "Discard unsaved changes?" : confirmation?.kind === "delete" ? "Delete this slide?" : "Import presentation?"}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation?.kind === "discard" ? "Your edits have not been saved to Assets. The original presentation will not change."
            : confirmation?.kind === "delete" ? "This removes the selected slide from your draft. You can restore it with Undo."
              : "The imported deck replaces this draft, not the original presentation. You can restore the previous draft with Undo."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>{confirmation?.kind === "discard" ? "Discard changes" : confirmation?.kind === "delete" ? "Delete slide" : "Replace draft"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
