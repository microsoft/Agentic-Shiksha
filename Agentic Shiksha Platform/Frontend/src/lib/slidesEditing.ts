import {
  isSlideComponentTarget, isSlideSourceUrl, isSlideText, parseSlideDeck, parseSlidesBlock,
  slideBodyIssue, slideBulletLimits, slideComponents, slideNotesIssue, SLIDE_LIMITS,
  type Slide, type SlideComponentTarget, type SlideDeck, type SlideLayout,
} from "./slides";

export const SLIDE_LAYOUT_LABELS: Record<SlideLayout, string> = {
  title: "Title", section: "Section", content: "Content", two_column: "Two columns",
  question: "Question", summary: "Summary", process: "Process", timeline: "Timeline",
  quote: "Quotation", key_stat: "Key statistic",
};

export function newSlide(layout: SlideLayout = "content"): Slide {
  return {
    layout, title: "New slide", subtitle: "", speaker_notes: "", sources: [],
    bullets: layout === "key_stat" ? ["Key value"] : layout === "quote" ? ["Add a short quotation."]
      : layout === "process" ? ["Introduce the first step.", "Describe the next step."]
        : layout === "timeline" ? ["First milestone.", "Next milestone."]
          : ["title", "section", "two_column"].includes(layout) ? [] : ["Add a key idea."],
    columns: layout === "two_column" ? [
      { heading: "First perspective", bullets: ["Add a key idea."] },
      { heading: "Second perspective", bullets: ["Add a key idea."] },
    ] : [],
  };
}

export function changeSlideLayout(slide: Slide, layout: SlideLayout): Slide {
  if (slide.layout === layout) return slide;
  const bodyKind = (value: SlideLayout) => value === "two_column" ? "columns"
    : value === "title" || value === "section" ? "none" : "bullets";
  if (bodyKind(slide.layout) === bodyKind(layout) && !slideBodyIssue({ ...slide, layout })) return { ...slide, layout };
  if (slide.component_notes?.some(note => note.target !== "title" && note.target !== "subtitle")) {
    throw new Error("This layout would detach component narration. Move or remove those component notes before changing the layout; your current script is unchanged.");
  }
  const previousBody = [
    ...slide.bullets.map(bullet => `- ${bullet}`),
    ...slide.columns.flatMap(column => [column.heading, ...column.bullets.map(bullet => `- ${bullet}`)]),
  ].join("\n");
  const notes = [slide.speaker_notes, previousBody ? `Content from previous layout:\n${previousBody}` : ""].filter(Boolean).join("\n\n");
  if (Array.from(notes).length > SLIDE_LIMITS.notes) {
    throw new Error("There is not enough room in speaker notes to preserve this slide's content. Shorten the notes before changing layout.");
  }
  const defaults = newSlide(layout);
  return {
    ...slide, layout, bullets: defaults.bullets, columns: defaults.columns, speaker_notes: notes,
    ...(slide.component_notes ? { component_notes: slide.component_notes.filter(note => note.target === "title" || note.target === "subtitle") } : {}),
  };
}

export function updateComponentNote(slide: Slide, target: SlideComponentTarget, text: string): Slide {
  const notes = (slide.component_notes ?? []).filter(note => note.target !== target);
  return { ...slide, component_notes: text ? [...notes, { target, text }] : notes };
}

export function removeSlideBullet(slide: Slide, index: number, columnIndex?: number): Slide {
  const items = columnIndex === undefined ? slide.bullets : slide.columns[columnIndex]?.bullets;
  if (!items || !Number.isInteger(index) || index < 0 || index >= items.length) throw new Error("The selected slide item no longer exists.");
  const prefix = columnIndex === undefined ? "bullet-" : `column-${columnIndex + 1}-bullet-`;
  const notes = slide.component_notes?.flatMap(note => {
    if (!note.target.startsWith(prefix)) return [note];
    const position = Number(note.target.slice(prefix.length));
    if (position === index + 1) return [];
    if (position < index + 1) return [note];
    const target = `${prefix}${position - 1}`;
    if (!isSlideComponentTarget(target)) throw new Error("The component note could not be matched to its slide item.");
    return [{ ...note, target }];
  });
  const remaining = items.filter((_, position) => position !== index);
  return {
    ...slide,
    ...(columnIndex === undefined ? { bullets: remaining }
      : { columns: slide.columns.map((column, position) => position === columnIndex ? { ...column, bullets: remaining } : column) }),
    ...(notes ? { component_notes: notes } : {}),
  };
}

export function slideDeckErrors(deck: SlideDeck): string[] {
  const errors: string[] = [];
  const checkText = (value: string, max: number, label: string, required = false) => {
    const missing = required && !value.trim();
    if (!isSlideText(value, max, required)) errors.push(`${label}: ${missing
      ? "enter some text." : `use at most ${max} characters and remove unsupported control characters.`}`);
  };
  checkText(deck.title, SLIDE_LIMITS.title, "Presentation title", true);
  checkText(deck.subtitle, SLIDE_LIMITS.subtitle, "Presentation subtitle");
  for (const [index, slide] of deck.slides.entries()) {
    const label = `Slide ${index + 1}`;
    checkText(slide.title, SLIDE_LIMITS.title, `${label} title`, true);
    checkText(slide.subtitle, SLIDE_LIMITS.subtitle, `${label} subtitle`);
    checkText(slide.speaker_notes, SLIDE_LIMITS.notes, `${label} speaker notes`);
    slide.bullets.forEach((bullet, i) => checkText(bullet, slideBulletLimits(slide.layout).length, `${label}, bullet ${i + 1}`, true));
    const bodyIssue = slideBodyIssue(slide);
    if (bodyIssue) errors.push(`${label}: ${bodyIssue}`);
    const notesIssue = slideNotesIssue(slide);
    if (notesIssue) errors.push(`${label}: ${notesIssue}`);
    slide.columns.forEach((column, i) => {
      checkText(column.heading, SLIDE_LIMITS.columnHeading, `${label}, column ${i + 1} heading`, true);
      column.bullets.forEach((bullet, j) => checkText(bullet, SLIDE_LIMITS.columnBullet, `${label}, column ${i + 1}, bullet ${j + 1}`, true));
    });
    slide.sources.forEach((source, i) => {
      checkText(source.title, SLIDE_LIMITS.title, `${label}, source ${i + 1} title`, true);
      if (source.url !== null && !isSlideSourceUrl(source.url)) errors.push(`${label}, source ${i + 1}: enter an HTTP(S) URL without spaces or credentials, or leave it empty.`);
    });
  }
  if (!errors.length && !parseSlideDeck(deck)) errors.push("The presentation exceeds a slide, bullet, or source limit, or has an incompatible layout.");
  return errors;
}

export function slideDeckQuality(deck: SlideDeck): {
  notesCount: number;
  componentNotesCount: number;
  componentCount: number;
  suggestions: { slideIndex: number; message: string }[];
} {
  const suggestions: { slideIndex: number; message: string }[] = [];
  let notesCount = 0;
  let componentNotesCount = 0;
  let componentCount = 0;
  for (const [slideIndex, slide] of deck.slides.entries()) {
    const suggest = (message: string) => suggestions.push({ slideIndex, message });
    if (slide.speaker_notes.trim()) notesCount++;
    else suggest("Add speaker notes with an explanation, example, and transition for narration.");
    const bodyComponents = slideComponents(slide).filter(component => component.target !== "title" && component.target !== "subtitle");
    const scripted = bodyComponents.filter(component => slide.component_notes?.some(note => note.target === component.target && note.text.trim())).length;
    componentCount += bodyComponents.length;
    componentNotesCount += scripted;
    if (scripted < bodyComponents.length) suggest(`Add saved notes for ${bodyComponents.length - scripted} component(s) so each highlighted point has its own explanation.`);
    if (Array.from(slide.title).length > 70) suggest("Shorten the headline so the audience can scan it quickly.");
    const text = [slide.subtitle, ...slide.bullets, ...slide.columns.flatMap(column => [column.heading, ...column.bullets])].join(" ").trim();
    if (text && text.split(/\s+/u).length > 55) suggest("Move detailed explanation into speaker notes; keep one clear idea on the slide.");
    if ((slide.layout === "quote" || slide.layout === "key_stat") && !slide.sources.length) {
      suggest(`Add a verifiable source for this ${slide.layout === "quote" ? "quotation" : "statistic"} before presenting it.`);
    }
  }
  if (deck.slides.length >= 4 && deck.slides.every(slide => ["title", "section", "content", "summary"].includes(slide.layout))) {
    suggestions.push({ slideIndex: 1, message: "Consider a process, timeline, or comparison where it helps explain the story." });
  }
  if (deck.slides.length >= 3 && !["summary", "question"].includes(deck.slides.at(-1)!.layout)) {
    suggestions.push({ slideIndex: deck.slides.length - 1, message: "Finish with clear takeaways or an audience question." });
  }
  return { notesCount, componentNotesCount, componentCount, suggestions };
}

export function importSlideDeck(content: string): SlideDeck {
  if (new TextEncoder().encode(content).byteLength > SLIDE_LIMITS.importBytes) throw new Error("Choose a presentation JSON file smaller than 2 MB.");
  let value: unknown;
  try { value = JSON.parse(content); }
  catch { throw new Error("This file is not valid JSON. Choose a presentation JSON backup."); }
  const deck = parseSlideDeck(value) ?? parseSlidesBlock(value)?.deck;
  if (!deck) throw new Error("This is not a supported presentation. Use a JSON backup with 1-20 slides, supported layouts, and valid source links.");
  return deck;
}

export function slideFilename(title: string, extension: "pptx" | "json"): string {
  const stem = Array.from(title.replace(/[<>:"/\\|?*]/g, "_")).map(char => char.charCodeAt(0) < 32 ? "_" : char).join("").slice(0, 120).replace(/[. ]+$/, "") || "presentation";
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? `_${stem}` : stem}.${extension}`;
}

type Snapshot = { deck: SlideDeck; index: number };
export type SlidesEditorState = Snapshot & { past: Snapshot[]; future: Snapshot[]; mergeKey?: string };
export type SlidesEditorAction =
  | { type: "replace"; deck: SlideDeck; index?: number; mergeKey?: string }
  | { type: "select"; index: number }
  | { type: "undo" | "redo" | "checkpoint" };

export function createSlidesEditorState(deck: SlideDeck, index = 0): SlidesEditorState {
  return { deck, index: Math.max(0, Math.min(index, deck.slides.length - 1)), past: [], future: [] };
}

export function slidesEditorReducer(state: SlidesEditorState, action: SlidesEditorAction): SlidesEditorState {
  const snapshot = { deck: state.deck, index: state.index };
  switch (action.type) {
    case "replace": {
      if (JSON.stringify(action.deck) === JSON.stringify(state.deck)) return state;
      const coalesced = action.mergeKey !== undefined && action.mergeKey === state.mergeKey;
      return {
        deck: action.deck, index: Math.max(0, Math.min(action.index ?? state.index, action.deck.slides.length - 1)),
        past: coalesced ? state.past : [...state.past.slice(-49), snapshot], future: [], mergeKey: action.mergeKey,
      };
    }
    case "select":
      return { ...state, index: Math.max(0, Math.min(action.index, state.deck.slides.length - 1)), mergeKey: undefined };
    case "checkpoint":
      return { ...state, mergeKey: undefined };
    case "undo": {
      const previous = state.past.at(-1);
      return previous ? { ...previous, past: state.past.slice(0, -1), future: [snapshot, ...state.future] } : state;
    }
    case "redo": {
      const next = state.future[0];
      return next ? { ...next, past: [...state.past, snapshot], future: state.future.slice(1) } : state;
    }
  }
}
