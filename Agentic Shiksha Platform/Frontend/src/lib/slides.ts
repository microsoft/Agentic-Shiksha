export const SLIDE_LAYOUTS = ["title", "section", "content", "two_column", "question", "summary", "process", "timeline", "quote", "key_stat"] as const;
export const SLIDE_THEMES = ["academic", "midnight", "warm"] as const;
export const SLIDE_LIMITS = {
  slides: 20, title: 120, subtitle: 180, bullets: 5, bullet: 160,
  columnHeading: 60, columnBullets: 4, columnBullet: 140,
  notes: 4000, componentNotes: 12, componentNote: 1200, totalNotes: 8000,
  sources: 3, sourceUrl: 2048, keyStat: 40, importBytes: 2 * 1024 * 1024,
} as const;
export type SlideLayout = typeof SLIDE_LAYOUTS[number];
export type SlideTheme = typeof SLIDE_THEMES[number];
export type SlideSource = { title: string; url: string | null };
export type SlideColumn = { heading: string; bullets: string[] };
export type SlideComponentTarget = "title" | "subtitle" | `bullet-${1 | 2 | 3 | 4 | 5}`
  | `column-${1 | 2}` | `column-${1 | 2}-bullet-${1 | 2 | 3 | 4}`;
export type SlideHighlightTarget = SlideComponentTarget | "slide";
export type SlideComponentNote = { target: SlideComponentTarget; text: string };
export type Slide = {
  layout: SlideLayout;
  title: string;
  subtitle: string;
  bullets: string[];
  columns: SlideColumn[];
  speaker_notes: string;
  component_notes?: SlideComponentNote[];
  sources: SlideSource[];
};
export type SlideDeck = { title: string; subtitle: string; theme: SlideTheme; slides: Slide[] };
export type SlidesContentBlock = {
  type: "slides";
  slidesId: string;
  title: string;
  deck?: SlideDeck;
  /** The originating TA, retained with saved decks rather than read from global chat state. */
  agentId?: string;
  isStreaming?: boolean;
};
export type CompleteSlidesBlock = SlidesContentBlock & { deck: SlideDeck };

const BULLET_TARGETS = ["bullet-1", "bullet-2", "bullet-3", "bullet-4", "bullet-5"] as const;
const COLUMN_TARGETS = [
  { heading: "column-1", bullets: ["column-1-bullet-1", "column-1-bullet-2", "column-1-bullet-3", "column-1-bullet-4"] },
  { heading: "column-2", bullets: ["column-2-bullet-1", "column-2-bullet-2", "column-2-bullet-3", "column-2-bullet-4"] },
] as const;

export function isSlideComponentTarget(value: unknown): value is SlideComponentTarget {
  return typeof value === "string" && value.trim() === value && /^(?:title|subtitle|bullet-[1-5]|column-[12](?:-bullet-[1-4])?)$/.test(value);
}

export function slideComponents(slide: Slide): { target: SlideComponentTarget; label: string; text: string }[] {
  const result: { target: SlideComponentTarget; label: string; text: string }[] = [
    { target: "title", label: "Slide title", text: slide.title },
  ];
  const subtitle = {
    target: "subtitle" as const,
    label: slide.layout === "quote" ? "Attribution" : slide.layout === "key_stat" ? "Statistic context" : "Subtitle",
    text: slide.subtitle,
  };
  const subtitleAfterBody = slide.layout === "quote" || slide.layout === "key_stat";
  if (slide.subtitle.trim() && !subtitleAfterBody) result.push(subtitle);
  for (const [index, target] of BULLET_TARGETS.entries()) {
    const text = slide.bullets[index];
    if (text === undefined) continue;
    const label = slide.layout === "process" ? `Step ${index + 1}` : slide.layout === "timeline" ? `Milestone ${index + 1}`
      : slide.layout === "quote" ? "Quotation" : slide.layout === "key_stat" ? "Featured value" : `Bullet ${index + 1}`;
    result.push({ target, label, text });
  }
  for (const [index, targets] of COLUMN_TARGETS.entries()) {
    const column = slide.columns[index];
    if (!column) continue;
    result.push({ target: targets.heading, label: `Column ${index + 1} heading`, text: column.heading });
    for (const [bulletIndex, target] of targets.bullets.entries()) {
      const text = column.bullets[bulletIndex];
      if (text !== undefined) result.push({ target, label: `Column ${index + 1} bullet ${bulletIndex + 1}`, text });
    }
  }
  if (slide.subtitle.trim() && subtitleAfterBody) result.push(subtitle);
  return result;
}

export function slideNotesIssue(slide: Slide): string | null {
  const notes = slide.component_notes ?? [];
  if (notes.length > SLIDE_LIMITS.componentNotes) return `Use at most ${SLIDE_LIMITS.componentNotes} component notes per slide.`;
  const targets = new Set(slideComponents(slide).map(component => component.target));
  const seen = new Set<SlideComponentTarget>();
  for (const note of notes) {
    if (!targets.has(note.target)) return `The component note "${note.target}" no longer matches this slide. Remove it or restore the component.`;
    if (seen.has(note.target)) return `Only one component note is allowed for "${note.target}".`;
    seen.add(note.target);
    if (!isSlideText(note.text, SLIDE_LIMITS.componentNote, true)) return `Component notes need readable text of at most ${SLIDE_LIMITS.componentNote} characters.`;
  }
  const total = Array.from(slide.speaker_notes).length + notes.reduce((sum, note) => sum + Array.from(note.text).length, 0);
  return total > SLIDE_LIMITS.totalNotes ? `Keep slide and component notes within ${SLIDE_LIMITS.totalNotes} characters combined.` : null;
}

export function slideBulletLimits(layout: SlideLayout): { min: number; max: number; length: number } {
  switch (layout) {
    case "title":
    case "section":
    case "two_column": return { min: 0, max: 0, length: SLIDE_LIMITS.bullet };
    case "process":
    case "timeline": return { min: 2, max: SLIDE_LIMITS.bullets, length: SLIDE_LIMITS.bullet };
    case "quote": return { min: 1, max: 1, length: SLIDE_LIMITS.bullet };
    case "key_stat": return { min: 1, max: 1, length: SLIDE_LIMITS.keyStat };
    default: return { min: 1, max: SLIDE_LIMITS.bullets, length: SLIDE_LIMITS.bullet };
  }
}

export function slideBodyIssue(slide: Pick<Slide, "layout" | "bullets" | "columns">): string | null {
  if (slide.layout === "two_column") {
    return slide.columns.length === 2 && !slide.bullets.length ? null : "Use exactly two columns and no top-level bullets.";
  }
  if (slide.columns.length) return "Only two-column slides can contain columns.";
  const { min, max, length } = slideBulletLimits(slide.layout);
  if (slide.bullets.length < min || slide.bullets.length > max) {
    if (!max) return "Title and section slides use a subtitle instead of bullets.";
    if (min === max) return `Use exactly one ${slide.layout === "quote" ? "quotation" : "featured value"}.`;
    return `Use ${min}-${max} ${slide.layout === "process" ? "steps" : slide.layout === "timeline" ? "milestones" : "bullets"}.`;
  }
  if (slide.bullets.some(bullet => Array.from(bullet).length > length)) return `Keep each item within ${length} characters.`;
  return null;
}

export const SLIDES_INVALID_MESSAGE = "The slide deck is invalid or incomplete. Please ask the TA to generate it again.";
export const SLIDES_INTERRUPTED_MESSAGE = "Slide generation did not finish. Please ask the TA to try again.";
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keysOnly = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every(key => keys.includes(key));
export function isSlideText(value: unknown, max: number, required = false): value is string {
  if (typeof value !== "string" || (required && !value.trim())) return false;
  const characters = Array.from(value);
  return characters.length <= max && characters.every(character => {
    const code = character.codePointAt(0)!;
    return (code >= 32 || "\t\n\r".includes(character)) && (code < 0xd800 || code > 0xdfff) && code !== 0xfffe && code !== 0xffff;
  });
}
const text = isSlideText;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSlideSourceUrl(value: unknown): value is string {
  if (!text(value, SLIDE_LIMITS.sourceUrl, true) || value.trim() !== value || /[\s\\]/u.test(value) || value.includes("\u007f")) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function bullets(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => !text(item, maxLength, true))) return null;
  return [...value] as string[];
}

export function parseSlideDeck(value: unknown): SlideDeck | null {
  if (!object(value) || !keysOnly(value, ["title", "subtitle", "theme", "slides"])
    || !text(value.title, SLIDE_LIMITS.title, true) || !text(value.subtitle === undefined ? "" : value.subtitle, SLIDE_LIMITS.subtitle)
    || (value.theme !== undefined && !SLIDE_THEMES.some(theme => theme === value.theme))
    || !Array.isArray(value.slides) || !value.slides.length || value.slides.length > SLIDE_LIMITS.slides) return null;

  const slides: Slide[] = [];
  for (const entry of value.slides) {
    if (!object(entry) || !keysOnly(entry, ["layout", "title", "subtitle", "bullets", "columns", "speaker_notes", "component_notes", "sources"])
      || !SLIDE_LAYOUTS.some(layout => layout === entry.layout)
      || !text(entry.title, SLIDE_LIMITS.title, true) || !text(entry.subtitle === undefined ? "" : entry.subtitle, SLIDE_LIMITS.subtitle)
      || !text(entry.speaker_notes === undefined ? "" : entry.speaker_notes, SLIDE_LIMITS.notes)) return null;
    const list = bullets(entry.bullets === undefined ? [] : entry.bullets, SLIDE_LIMITS.bullets, SLIDE_LIMITS.bullet);
    const rawColumns = entry.columns === undefined ? [] : entry.columns;
    const rawSources = entry.sources === undefined ? [] : entry.sources;
    if (!list || !Array.isArray(rawColumns) || rawColumns.length > 2 || !Array.isArray(rawSources) || rawSources.length > SLIDE_LIMITS.sources) return null;
    const columns: SlideColumn[] = [];
    for (const column of rawColumns) {
      if (!object(column) || !keysOnly(column, ["heading", "bullets"]) || !text(column.heading, SLIDE_LIMITS.columnHeading, true)) return null;
      const items = bullets(column.bullets, SLIDE_LIMITS.columnBullets, SLIDE_LIMITS.columnBullet);
      if (!items?.length) return null;
      columns.push({ heading: column.heading, bullets: items });
    }
    if (slideBodyIssue({ layout: entry.layout as SlideLayout, bullets: list, columns })) return null;

    const sources: SlideSource[] = [];
    for (const source of rawSources) {
      if (!object(source) || !keysOnly(source, ["title", "url"]) || !text(source.title, 120, true)
        || (source.url !== undefined && source.url !== null && !isSlideSourceUrl(source.url))) return null;
      sources.push({ title: source.title, url: source.url as string | null | undefined ?? null });
    }
    const slide: Slide = {
      layout: entry.layout as SlideLayout, title: entry.title, subtitle: entry.subtitle as string | undefined ?? "",
      bullets: list, columns, speaker_notes: entry.speaker_notes as string | undefined ?? "", sources,
    };
    if (entry.component_notes !== undefined) {
      if (!Array.isArray(entry.component_notes) || entry.component_notes.length > SLIDE_LIMITS.componentNotes) return null;
      const notes: SlideComponentNote[] = [];
      for (const note of entry.component_notes) {
        if (!object(note) || !keysOnly(note, ["target", "text"]) || !isSlideComponentTarget(note.target)
          || !text(note.text, SLIDE_LIMITS.componentNote, true)) return null;
        notes.push({ target: note.target, text: note.text });
      }
      slide.component_notes = notes;
    }
    if (slideNotesIssue(slide)) return null;
    slides.push(slide);
  }
  return { title: value.title, subtitle: value.subtitle as string | undefined ?? "", theme: value.theme as SlideTheme | undefined ?? "academic", slides };
}

export function parseSlidesBlock(value: unknown): CompleteSlidesBlock | null {
  if (!object(value) || value.type !== "slides"
    || !keysOnly(value, ["type", "slidesId", "title", "deck", "agentId", "isStreaming"])
    || typeof value.slidesId !== "string" || !uuid.test(value.slidesId)
    || !text(value.title, 120, true)
    || (value.agentId !== undefined && (!text(value.agentId, 256, true) || Array.from(value.agentId).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)))
    || (value.isStreaming !== undefined && typeof value.isStreaming !== "boolean")) return null;
  const deck = parseSlideDeck(value.deck);
  if (!deck || value.title !== deck.title) return null;
  return { type: "slides", slidesId: value.slidesId, title: deck.title, deck, ...(value.agentId ? { agentId: value.agentId as string } : {}) };
}

/** A2UI encodes an empty array as an empty map; no other malformed arrays are coerced. */
export function parseA2UISlidesBlock(value: unknown): CompleteSlidesBlock | null {
  const array = (entry: unknown) => object(entry) && !Object.keys(entry).length ? [] : entry;
  if (!object(value) || !object(value.deck)) return null;
  const deck = value.deck;
  const slides = Array.isArray(deck.slides) ? deck.slides.map(entry => object(entry) ? {
    ...entry,
    bullets: array(entry.bullets),
    sources: array(entry.sources),
    component_notes: array(entry.component_notes),
    columns: Array.isArray(entry.columns)
      ? entry.columns.map(column => object(column) ? { ...column, bullets: array(column.bullets) } : column)
      : array(entry.columns),
  } : entry) : array(deck.slides);
  return parseSlidesBlock({ type: "slides", ...value, deck: { ...deck, slides } });
}

export function restoreSlidesBlock(value: unknown): CompleteSlidesBlock | { type: "text"; content: string } {
  return parseSlidesBlock(value) ?? { type: "text", content: SLIDES_INVALID_MESSAGE };
}
