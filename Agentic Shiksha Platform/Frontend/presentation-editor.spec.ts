import { expect, test } from "@playwright/test";
import { isSlideSourceUrl, parseA2UISlidesBlock, parseSlideDeck, slideComponents, SLIDE_LAYOUTS, SLIDE_LIMITS, type Slide, type SlideDeck } from "./src/lib/slides";
import {
  changeSlideLayout, createSlidesEditorState, importSlideDeck, newSlide,
  removeSlideBullet, slideDeckErrors, slideDeckQuality, slideFilename, slidesEditorReducer, updateComponentNote,
} from "./src/lib/slidesEditing";

const deck = (): SlideDeck => ({
  title: "Learning with evidence", subtitle: "", theme: "academic",
  slides: [newSlide("title"), newSlide("content"), newSlide("two_column")],
});

test("presentation editor creates and converts every supported layout without mutating the source", () => {
  for (const from of SLIDE_LAYOUTS) {
    const original = newSlide(from);
    original.speaker_notes = "Original notes";
    original.sources = [{ title: "Reference", url: "https://example.com/reference" }];
    const before = structuredClone(original);
    for (const to of SLIDE_LAYOUTS) {
      const converted = changeSlideLayout(original, to);
      expect(parseSlideDeck({ ...deck(), slides: [converted] })).not.toBeNull();
      expect(converted.layout).toBe(to);
      expect(converted.sources).toEqual(original.sources);
      expect(converted.speaker_notes).toContain("Original notes");
      if (from === "two_column" && to !== from) expect(converted.speaker_notes).toContain("First perspective");
      if (original.bullets.length && ["title", "section", "two_column"].includes(to)) expect(converted.speaker_notes).toContain(original.bullets[0]);
      expect(original).toEqual(before);
    }
  }
});

test("presentation editor refuses a layout conversion that would lose notes", () => {
  const slide = { ...newSlide(), speaker_notes: "x".repeat(SLIDE_LIMITS.notes) };
  expect(() => changeSlideLayout(slide, "title")).toThrow(/not enough room/);
  expect(slide.bullets).toEqual(["Add a key idea."]);
  expect(slide.speaker_notes).toHaveLength(SLIDE_LIMITS.notes);
});

test("visual layouts enforce their item counts and Unicode statistic bounds", () => {
  for (const layout of ["process", "timeline", "quote", "key_stat"] as const) {
    const valid = newSlide(layout);
    expect(parseSlideDeck({ ...deck(), slides: [valid] })).not.toBeNull();
    expect(parseSlideDeck({ ...deck(), slides: [{ ...valid, bullets: [] }] })).toBeNull();
    expect(parseSlideDeck({ ...deck(), slides: [{ ...valid, columns: newSlide("two_column").columns }] })).toBeNull();
    if (layout === "process" || layout === "timeline") {
      expect(parseSlideDeck({ ...deck(), slides: [{ ...valid, bullets: ["Only one"] }] })).toBeNull();
      expect(parseSlideDeck({ ...deck(), slides: [{ ...valid, bullets: Array.from({ length: 5 }, (_, i) => `Step ${i + 1}`) }] })).not.toBeNull();
    } else {
      expect(parseSlideDeck({ ...deck(), slides: [{ ...valid, bullets: ["One", "Two"] }] })).toBeNull();
    }
  }
  const statistic = newSlide("key_stat");
  expect(parseSlideDeck({ ...deck(), slides: [{ ...statistic, bullets: ["\u{1f680}".repeat(40)] }] })).not.toBeNull();
  expect(parseSlideDeck({ ...deck(), slides: [{ ...statistic, bullets: ["\u{1f680}".repeat(41)] }] })).toBeNull();
});

test("switching to a restrictive visual layout preserves every old item in notes instead of truncating it", () => {
  const original = { ...newSlide(), bullets: ["The first observation.", "The second observation.", "The third observation."] };
  for (const layout of ["quote", "key_stat"] as const) {
    const converted = changeSlideLayout(original, layout);
    expect(converted.bullets).toHaveLength(1);
    for (const bullet of original.bullets) expect(converted.speaker_notes).toContain(bullet);
    expect(parseSlideDeck({ ...deck(), slides: [converted] })).not.toBeNull();
  }
  const timeline = changeSlideLayout(original, "timeline");
  expect(timeline.bullets).toEqual(original.bullets);
  expect(timeline.speaker_notes).toBe(original.speaker_notes);
  expect(changeSlideLayout(timeline, "process").bullets).toEqual(original.bullets);
  const tooLong = { ...newSlide("quote"), bullets: ["A statement that is longer than forty characters but within the quotation limit."] };
  expect(changeSlideLayout(tooLong, "key_stat").speaker_notes).toContain(tooLong.bullets[0]);
});

test("presentation checks identify narration gaps, density, missing evidence, and a weak ending without mutating the deck", () => {
  const draft: SlideDeck = {
    ...deck(),
    slides: [
      { ...newSlide("title"), speaker_notes: "Welcome. Here is the question we will investigate." },
      { ...newSlide("content"), title: "A".repeat(71), bullets: Array.from({ length: 3 }, () => "word ".repeat(25).trim()) },
      newSlide("quote"),
      newSlide("key_stat"),
    ],
  };
  const original = structuredClone(draft);
  const quality = slideDeckQuality(draft);
  expect(quality.notesCount).toBe(1);
  expect(quality.suggestions).toEqual(expect.arrayContaining([
    { slideIndex: 1, message: "Shorten the headline so the audience can scan it quickly." },
    { slideIndex: 1, message: "Move detailed explanation into speaker notes; keep one clear idea on the slide." },
    { slideIndex: 2, message: "Add a verifiable source for this quotation before presenting it." },
    { slideIndex: 3, message: "Add a verifiable source for this statistic before presenting it." },
    { slideIndex: 3, message: "Finish with clear takeaways or an audience question." },
  ]));
  expect(draft).toEqual(original);
  const ready: SlideDeck = {
    ...deck(), slides: [newSlide("title"), newSlide("process"), newSlide("summary")].map(slide => ({
      ...slide, speaker_notes: "Explain the idea and introduce the next one.",
      component_notes: slideComponents(slide).filter(component => component.target !== "title" && component.target !== "subtitle")
        .map(component => ({ target: component.target, text: `The saved explanation for ${component.label}.` })),
    })),
  };
  expect(slideDeckQuality(ready)).toEqual({ notesCount: 3, componentCount: 3, componentNotesCount: 3, suggestions: [] });
});

test("component notes round-trip verbatim and reject duplicates, unknown targets, missing components and unbounded scripts", () => {
  const slide: Slide = {
    ...newSlide(), title: "Impact and applications", bullets: ["Research acceleration", "Industry deployment"],
    speaker_notes: "Let us connect this topic to its practical impact.",
    component_notes: [
      { target: "bullet-2", text: "Industry deployment needs a validated workflow and clear operating limits." },
      { target: "bullet-1", text: "Research acceleration comes from testing ideas quickly.\nKeep a record of the evidence." },
    ],
  };
  const narrated = { ...deck(), slides: [slide] };
  expect(parseSlideDeck(narrated)).toEqual(narrated);
  expect(importSlideDeck(JSON.stringify(narrated))).toEqual(narrated);
  expect(Object.hasOwn(parseSlideDeck(deck())!.slides[0], "component_notes")).toBe(false);
  const invalid = [
    [{ target: "bullet-0", text: "Not a target." }],
    [{ target: "bullet-1\n", text: "A target cannot contain whitespace." }],
    [{ target: "bullet-3", text: "There is no third bullet." }],
    [{ target: "column-1", text: "There are no columns." }],
    [{ target: "subtitle", text: "The subtitle is empty." }],
    [{ target: "bullet-1", text: "" }],
    [{ target: "bullet-1", text: " " }],
    [{ target: "bullet-1", text: "\u0000" }],
    [{ target: "bullet-1", text: "x".repeat(1201) }],
    [{ target: "bullet-1", text: "One." }, { target: "bullet-1", text: "Duplicate." }],
    [{ target: "bullet-1", text: "One.", url: "https://example.com" }],
    Array.from({ length: 13 }, () => ({ target: "title", text: "Too many." })),
  ];
  for (const component_notes of invalid) expect(parseSlideDeck({ ...narrated, slides: [{ ...slide, component_notes }] })).toBeNull();
  const maximum: Slide = {
    ...slide, speaker_notes: "x".repeat(4000), bullets: ["A", "B", "C", "D"],
    component_notes: [
      { target: "bullet-1", text: "\u{1f680}".repeat(1200) },
      { target: "bullet-2", text: "x".repeat(1200) },
      { target: "bullet-3", text: "x".repeat(1200) },
      { target: "bullet-4", text: "x".repeat(400) },
    ],
  };
  expect(parseSlideDeck({ ...deck(), slides: [maximum] })).not.toBeNull();
  const tooLong = updateComponentNote(maximum, "bullet-4", "x".repeat(401));
  expect(parseSlideDeck({ ...deck(), slides: [tooLong] })).toBeNull();
  expect(slideDeckErrors({ ...deck(), slides: [tooLong] })).toContain("Slide 1: Keep slide and component notes within 8000 characters combined.");
});

test("component targets follow visual order, including quote attribution and comparison columns", () => {
  const comparison = { ...newSlide("two_column"), subtitle: "Compare both perspectives." };
  expect(slideComponents(comparison).map(component => component.target)).toEqual([
    "title", "subtitle", "column-1", "column-1-bullet-1", "column-2", "column-2-bullet-1",
  ]);
  for (const layout of ["quote", "key_stat"] as const) {
    expect(slideComponents({ ...newSlide(layout), subtitle: "Context after the featured item." }).map(component => component.target)).toEqual(["title", "bullet-1", "subtitle"]);
  }
  const emptyArrays = { ...newSlide("title"), component_notes: {} };
  const decoded = parseA2UISlidesBlock({
    slidesId: "00000000-0000-4000-8000-000000000011", title: deck().title,
    deck: { ...deck(), slides: [emptyArrays] },
  });
  expect(decoded?.deck.slides[0].component_notes).toEqual([]);
});

test("removing a bullet removes its own script and keeps every remaining script linked to the correct item", () => {
  let slide = updateComponentNote({ ...newSlide(), bullets: ["First", "Second", "Third"] }, "bullet-1", "First script.");
  slide = updateComponentNote(slide, "bullet-2", "Second script.");
  slide = updateComponentNote(slide, "bullet-3", "Third script.");
  const before = structuredClone(slide);
  const remaining = removeSlideBullet(slide, 0);
  expect(remaining.bullets).toEqual(["Second", "Third"]);
  expect(remaining.component_notes).toEqual([
    { target: "bullet-1", text: "Second script." }, { target: "bullet-2", text: "Third script." },
  ]);
  expect(slide).toEqual(before);
  expect(updateComponentNote(remaining, "bullet-1", "").component_notes).toEqual([{ target: "bullet-2", text: "Third script." }]);
  const comparison: Slide = {
    ...newSlide("two_column"),
    columns: [{ heading: "Left", bullets: ["A", "B"] }, { heading: "Right", bullets: ["C"] }],
    component_notes: [{ target: "column-1-bullet-2", text: "Explain B." }, { target: "column-2-bullet-1", text: "Explain C." }],
  };
  expect(removeSlideBullet(comparison, 0, 0).component_notes).toEqual([
    { target: "column-1-bullet-1", text: "Explain B." }, { target: "column-2-bullet-1", text: "Explain C." },
  ]);
  expect(() => removeSlideBullet(comparison, 9, 0)).toThrow(/no longer exists/);
});

test("layout conversion refuses to assign component scripts to unrelated replacement items", () => {
  const slide: Slide = {
    ...newSlide(), bullets: ["Original first idea.", "Original second idea."], speaker_notes: "The topic introduction.",
    component_notes: [
      { target: "title", text: "Additional title context." },
      { target: "bullet-1", text: "The exact first explanation." },
      { target: "bullet-2", text: "The exact second explanation." },
    ],
  };
  const before = structuredClone(slide);
  expect(changeSlideLayout(slide, "timeline").component_notes).toEqual(slide.component_notes);
  expect(() => changeSlideLayout(slide, "quote")).toThrow(/would detach component narration/);
  expect(() => changeSlideLayout(slide, "two_column")).toThrow(/would detach component narration/);
  expect(slide).toEqual(before);
});

test("presentation history groups typing, tracks slide selection, and supports undo and redo", () => {
  const original = deck();
  let state = createSlidesEditorState(original, 1);
  for (const title of ["M", "My", "My lesson"]) state = slidesEditorReducer(state, { type: "replace", deck: { ...state.deck, title }, mergeKey: "title" });
  expect(state.past).toHaveLength(1);
  expect(state.deck.title).toBe("My lesson");
  state = slidesEditorReducer(state, { type: "undo" });
  expect(state.deck).toBe(original);
  expect(state.index).toBe(1);
  state = slidesEditorReducer(state, { type: "redo" });
  expect(state.deck.title).toBe("My lesson");
  state = slidesEditorReducer(state, { type: "checkpoint" });
  state = slidesEditorReducer(state, { type: "replace", deck: { ...state.deck, theme: "warm" }, index: 2 });
  state = slidesEditorReducer(state, { type: "undo" });
  expect(state.index).toBe(1);
  expect(state.deck.theme).toBe("academic");
  state = slidesEditorReducer(state, { type: "replace", deck: { ...state.deck, title: "Different branch" } });
  expect(state.future).toHaveLength(0);
  expect(slidesEditorReducer(state, { type: "redo" })).toBe(state);
  expect(original.title).toBe("Learning with evidence");
});

test("presentation history is bounded and always clamps navigation", () => {
  let state = createSlidesEditorState(deck(), 999);
  expect(state.index).toBe(2);
  for (let i = 0; i < 60; i++) state = slidesEditorReducer(state, { type: "replace", deck: { ...state.deck, title: `Revision ${i}` } });
  expect(state.past).toHaveLength(50);
  expect(slidesEditorReducer(state, { type: "select", index: -1 }).index).toBe(0);
  state = slidesEditorReducer(state, { type: "replace", deck: { ...state.deck, slides: [newSlide()] } });
  expect(state.index).toBe(0);
});

test("presentation validation reports incomplete fields including unselected slides", () => {
  const draft = deck();
  draft.slides[2].columns[1].heading = "";
  draft.slides[1].bullets[0] = " ";
  draft.slides[0].sources = [{ title: "", url: "javascript:alert(1)" }];
  const errors = slideDeckErrors(draft);
  expect(errors).toEqual(expect.arrayContaining([
    "Slide 2, bullet 1: enter some text.",
    "Slide 3, column 2 heading: enter some text.",
    "Slide 1, source 1 title: enter some text.",
    "Slide 1, source 1: enter an HTTP(S) URL without spaces or credentials, or leave it empty.",
  ]));
  expect(slideDeckErrors(deck())).toEqual([]);
});

test("presentation text validation mirrors XML-safe PowerPoint boundaries without rejecting emoji", () => {
  const valid = { ...deck(), title: "\u{1f680}".repeat(120) };
  expect(parseSlideDeck(valid)).not.toBeNull();
  expect(parseSlideDeck({ ...valid, title: valid.title + "x" })).toBeNull();
  for (const invalid of ["\u0000", "\u0008", "\u000b", "\u001f", "\ud800", "\udfff", "\ufffe", "\uffff"]) {
    const draft = deck();
    draft.slides[1].speaker_notes = `Notes${invalid}`;
    expect(parseSlideDeck(draft)).toBeNull();
    expect(slideDeckErrors(draft)[0]).toContain("speaker notes");
  }
  const draft = deck();
  draft.slides[1].speaker_notes = "Notes\nwith\ttabs\r\nand newlines";
  expect(parseSlideDeck(draft)).not.toBeNull();
});

test("presentation source URLs reject browser-normalized slashes, controls and credentials", () => {
  for (const url of ["https:\\\\example.com\\reading", "https://user@example.com", "https://example.com/\u00a0x", "https://example.com/a\nb", "data:text/plain,hello"]) {
    expect(isSlideSourceUrl(url)).toBe(false);
  }
  expect(isSlideSourceUrl("https://example.com/reading?q=one%20two#chapter")).toBe(true);
});

test("presentation import accepts only bounded supported backups and restores all content", () => {
  const original = deck();
  original.slides[1].speaker_notes = "Keep every note";
  original.slides[1].sources = [{ title: "Notes", url: null }];
  const block = { type: "slides", slidesId: "00000000-0000-4000-8000-000000000011", title: original.title, deck: original };
  expect(importSlideDeck(JSON.stringify(original))).toEqual(original);
  expect(importSlideDeck(JSON.stringify(block))).toEqual(original);
  expect(() => importSlideDeck("{")).toThrow(/not valid JSON/);
  expect(() => importSlideDeck(JSON.stringify({ ...original, image: "https://example.com/image" }))).toThrow(/not a supported presentation/);
  expect(() => importSlideDeck(JSON.stringify({ ...original, slides: Array.from({ length: 21 }, () => newSlide()) }))).toThrow(/1-20 slides/);
  expect(() => importSlideDeck(" ".repeat(SLIDE_LIMITS.importBytes + 1))).toThrow(/smaller than 2 MB/);
  expect(() => importSlideDeck("\u{1f680}".repeat(SLIDE_LIMITS.importBytes / 4 + 1))).toThrow(/smaller than 2 MB/);
});

test("presentation download filenames preserve readable titles while remaining safe on Windows", () => {
  expect(slideFilename("Evidence and explanation", "pptx")).toBe("Evidence and explanation.pptx");
  expect(slideFilename('Lesson: "why?" / today. ', "json")).toBe("Lesson_ _why__ _ today.json");
  expect(slideFilename("CON", "pptx")).toBe("_CON.pptx");
  expect(slideFilename(".. ", "json")).toBe("presentation.json");
  expect(slideFilename("a".repeat(130), "pptx")).toHaveLength(125);
});
