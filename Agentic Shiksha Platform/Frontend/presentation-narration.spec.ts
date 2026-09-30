import { expect, test, type Locator, type Page } from "@playwright/test";
import { slideComponents, type Slide, type SlideComponentTarget, type SlideDeck } from "./src/lib/slides";
import { chunkNarration, getSlideNarration, NARRATION_CHUNK_LENGTH } from "./src/lib/slideNarration";
import { installAzureAudioMock, installSpeechMock, speechMockVoices as voices, type Voice } from "./presentation-narration-test-helpers";

const slide = (title: string, fields: Partial<Slide> = {}): Slide => ({
  layout: "content", title, subtitle: "", bullets: ["A supporting point."], columns: [], speaker_notes: "", sources: [], ...fields,
});
const deck: SlideDeck = {
  title: "On-device presentation", subtitle: "", theme: "academic",
  slides: [
    slide("Look for evidence", {
      subtitle: "Compare observations",
      bullets: ["Use measurements.", "Visit https://example.com/slides for details."],
      speaker_notes: "Notes for the presenter. Compare patterns. https://example.com/private",
      sources: [{ title: "A source that must not be narrated", url: "https://example.com/source" }],
    }),
    slide("Two explanations", {
      layout: "two_column", speaker_notes: "Compare these two explanations.", bullets: [], columns: [
        { heading: "Evidence", bullets: ["What we measured."] },
        { heading: "Interpretation", bullets: ["What we think it means."] },
      ],
    }),
    slide("Finish", { layout: "summary", bullets: ["State what you learned."], speaker_notes: "Conclude with a question." }),
  ],
};

async function mount(page: Page, options: { deck?: SlideDeck; initialIndex?: number; secondPanel?: boolean; supported?: boolean; voices?: Voice[]; autoStart?: boolean; allowAzure?: boolean } = {}) {
  await installSpeechMock(page, options);
  if (options.allowAzure) await installAzureAudioMock(page);
  const unexpectedRequests: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/") || !["127.0.0.1", "localhost"].includes(url.hostname)) {
      unexpectedRequests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.route("**/presentation-narration-fixture", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Narration fixture</title></head><body><script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script></body></html>`,
  }));
  await page.goto("/presentation-narration-fixture");
  await page.evaluate(async ({ deck, initialIndex, secondPanel, allowAzure }) => {
    const path = "/presentation-narration-browser-harness.tsx";
    const { mountNarrationFixture } = await import(path);
    mountNarrationFixture(deck, { initialIndex, secondPanel, allowAzure, agentId: allowAzure ? "course-Example" : undefined });
  }, { deck: options.deck || deck, initialIndex: options.initialIndex, secondPanel: options.secondPanel, allowAzure: options.allowAzure });
  const panel = page.getByTestId("primary-narration").getByRole("region", { name: "Slide narration", exact: true });
  await expect(panel).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.narrationMock.records.length)).toBe(0);
  return { panel, unexpectedRequests };
}

const speech = (page: Page) => page.evaluate(() => ({
  records: window.narrationMock.records.map(record => ({ text: record.text, voice: record.voice, rate: record.rate })),
  cancels: window.narrationMock.cancels, pauses: window.narrationMock.pauses, resumes: window.narrationMock.resumes,
}));
const play = (panel: Locator) => panel.getByRole("button", { name: "Play narration", exact: true }).click();
const finish = (page: Page) => page.evaluate(() => window.narrationMock.finish());
const finishSlide = (page: Page) => page.evaluate(() => {
  const mock = window.narrationMock;
  for (let part = 0; part < 100; part += 1) {
    const previous = mock.records.length;
    mock.finish();
    if (mock.records.length === previous) return;
  }
  throw new Error("Narration exceeded the slide chunk budget");
});
const count = (page: Page, total: number) => expect.poll(async () => (await speech(page)).records.length).toBe(total);
const highlight = async (page: Page, target: string | null) => {
  await expect(page.getByTestId("narration-target")).toHaveText(target || "");
  const canvas = page.getByTestId("narration-preview").getByTestId("slide-canvas");
  if (target) {
    await expect(canvas).toHaveAttribute("data-narration-focus", target);
    await expect(canvas.locator("[data-narration-active=true]")).toHaveCount(1);
    await expect(canvas.locator(`[data-narration-target="${target === "slide" ? "title" : target}"]`)).toHaveAttribute("data-narration-active", "true");
  } else {
    await expect(canvas).not.toHaveAttribute("data-narration-focus");
    await expect(canvas.locator("[data-narration-active=true]")).toHaveCount(0);
  }
};
const stale = (page: Page, index: number) => page.evaluate(index => {
  const record = window.narrationMock.records[index];
  record.start?.();
  record.end?.();
  record.error?.("interrupted");
}, index);

const indianVoices = [
  { id: "en-IN-NeerjaNeural", name: "Neerja (Indian English)", language: "en-IN" },
  { id: "en-IN-PrabhatNeural", name: "Prabhat (Indian English)", language: "en-IN" },
  { id: "hi-IN-SwaraNeural", name: "Swara (Hindi)", language: "hi-IN" },
  { id: "hi-IN-MadhurNeural", name: "Madhur (Hindi)", language: "hi-IN" },
];

test("Azure Indian voices read exact scripts with synchronized highlights, pause, speed and cleanup", async ({ page }) => {
  const narrated: SlideDeck = {
    ...deck, slides: [slide("An Indian narration example", {
      speaker_notes: "Let us introduce this topic.",
      component_notes: [{ target: "bullet-1", text: "Here is the exact saved explanation of this point." }],
    })],
  };
  const { panel } = await mount(page, { allowAzure: true, deck: narrated });
  const requests: { text: string; voice: string }[] = [];
  await page.route("**/api/agents/course-Example/slides/voices", route => route.fulfill({ json: { available: true, voices: indianVoices } }));
  await page.route("**/api/agents/course-Example/slides/speech", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("ID3-test-audio") });
  });
  await panel.getByLabel("Voice provider", { exact: true }).selectOption("azure");
  await expect(panel.getByLabel("Azure Indian voice", { exact: true })).toHaveValue("en-IN-NeerjaNeural");
  await expect(panel.getByText(/Selecting Play sends/)).toBeVisible();
  expect(requests).toHaveLength(0);
  await panel.getByLabel("Speed", { exact: true }).selectOption("1.25");
  await play(panel);
  await highlight(page, "slide");
  expect(requests).toEqual([{ text: narrated.slides[0].speaker_notes, voice: "en-IN-NeerjaNeural" }]);
  expect(await page.evaluate(() => window.azureAudioMock.records[0].playbackRate)).toBe(1.25);
  await panel.getByRole("button", { name: "Pause narration", exact: true }).click();
  await highlight(page, "slide");
  await panel.getByRole("button", { name: "Resume narration", exact: true }).click();
  await page.evaluate(() => window.azureAudioMock.records[0].onended?.());
  await highlight(page, "bullet-1");
  expect(requests[1]).toEqual({ text: narrated.slides[0].component_notes![0].text, voice: "en-IN-NeerjaNeural" });
  await panel.getByRole("button", { name: "Stop narration", exact: true }).click();
  await highlight(page, null);
  await page.evaluate(() => window.azureAudioMock.records[1].savedEnd?.());
  expect(requests).toHaveLength(2);
  await panel.getByLabel("Azure Indian voice", { exact: true }).selectOption("hi-IN-SwaraNeural");
  await play(panel);
  await highlight(page, "slide");
  expect(requests.at(-1)).toEqual({ text: narrated.slides[0].speaker_notes, voice: "hi-IN-SwaraNeural" });
  await panel.getByLabel("Voice provider", { exact: true }).selectOption("local");
  await highlight(page, null);
  const urls = await page.evaluate(() => window.azureAudioMock);
  expect(urls.created.sort()).toEqual(urls.revoked.sort());
  expect((await speech(page)).records).toHaveLength(0);
});

test("Azure narration works without local voices and never plays a late cancelled response", async ({ page }) => {
  const { panel } = await mount(page, { allowAzure: true, supported: false });
  await page.route("**/api/agents/course-Example/slides/voices", route => route.fulfill({ json: { available: true, voices: indianVoices } }));
  let complete: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { complete = resolve; });
  await page.route("**/api/agents/course-Example/slides/speech", async route => {
    await ready;
    try { await route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("ID3-test-audio") }); }
    catch { /* The test deliberately aborts this request before releasing it. */ }
  });
  await panel.getByLabel("Voice provider", { exact: true }).selectOption("azure");
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeEnabled();
  const requested = page.waitForRequest("**/slides/speech");
  await play(panel);
  await requested;
  await panel.getByRole("button", { name: "Pause narration", exact: true }).click();
  await panel.getByRole("button", { name: "Stop narration", exact: true }).click();
  complete!();
  await highlight(page, null);
  expect(await page.evaluate(() => window.azureAudioMock.records)).toHaveLength(0);
});

test("Azure voice configuration and synthesis errors are explicit and never use a local fallback", async ({ page }) => {
  const { panel } = await mount(page, { allowAzure: true });
  let configured = false;
  let status = 503;
  await page.route("**/api/agents/course-Example/slides/voices", route => route.fulfill({ json: {
    available: configured, voices: configured ? indianVoices : [], detail: configured ? undefined : "Azure Speech is not configured.",
  } }));
  await page.route("**/api/agents/course-Example/slides/speech", route => route.fulfill({
    status, contentType: status === 200 ? "text/html" : "application/json",
    body: status === 200 ? "<h1>Not audio</h1>" : JSON.stringify({ detail: "Azure speech is unavailable. Please retry." }),
  }));
  await panel.getByLabel("Voice provider", { exact: true }).selectOption("azure");
  await expect(panel.getByRole("alert")).toContainText("not configured");
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeDisabled();
  configured = true;
  await panel.getByRole("button", { name: "Reload Azure voices", exact: true }).click();
  await play(panel);
  await expect(panel.getByRole("alert")).toContainText("Azure speech is unavailable");
  status = 200;
  await play(panel);
  await expect(panel.getByRole("alert")).toContainText("did not return an audio file");
  expect((await speech(page)).records).toHaveLength(0);
  await highlight(page, null);
});

test("Azure auto-advance waits for each component and presenter exit cancels its audio", async ({ page }) => {
  const { panel } = await mount(page, { allowAzure: true });
  const requests: string[] = [];
  await page.route("**/api/agents/course-Example/slides/voices", route => route.fulfill({ json: { available: true, voices: indianVoices } }));
  await page.route("**/api/agents/course-Example/slides/speech", route => {
    requests.push(route.request().postDataJSON().text);
    return route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("ID3-test-audio") });
  });
  await panel.getByLabel("Voice provider", { exact: true }).selectOption("azure");
  await panel.getByLabel("Auto-advance through deck", { exact: true }).check();
  await play(panel);
  await highlight(page, "slide");
  await page.evaluate(() => window.azureAudioMock.records.at(-1)?.onended?.());
  await expect(page.getByTestId("preview-position")).toHaveText("2");
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toBe(deck.slides[1].speaker_notes);
  await page.getByRole("button", { name: "Start presentation", exact: true }).click();
  const presenter = page.getByRole("dialog", { name: `Presentation: ${deck.title}` });
  await presenter.getByRole("button", { name: "Read aloud", exact: true }).click();
  await presenter.getByLabel("Voice provider", { exact: true }).selectOption("azure");
  await presenter.getByRole("button", { name: "Play narration", exact: true }).click();
  await expect(presenter.getByTestId("slide-canvas")).toHaveAttribute("data-narration-focus", "slide");
  await presenter.getByRole("button", { name: "Exit presentation", exact: true }).click();
  await expect(presenter).toHaveCount(0);
  await highlight(page, null);
  const count = requests.length;
  await page.evaluate(() => window.azureAudioMock.records.at(-1)?.savedEnd?.());
  expect(requests).toHaveLength(count);
  const urls = await page.evaluate(() => window.azureAudioMock);
  expect(urls.created.sort()).toEqual(urls.revoked.sort());
});

test("narration is opt-in, local-only, and reads exact notes or explicitly selected visible text", async ({ page }) => {
  const { panel, unexpectedRequests } = await mount(page);
  await expect(panel.getByText("On-device", { exact: true })).toBeVisible();
  const voice = panel.getByLabel("On-device voice", { exact: true });
  await expect(voice.getByRole("option")).toHaveCount(2);
  await expect(voice.getByRole("option", { name: /Cloud/ })).toHaveCount(0);
  await expect(voice).toHaveValue(JSON.stringify(["local-en", "Local English", "en-US"]));
  await expect(panel.getByLabel("Auto-advance through deck")).not.toBeChecked();
  await play(panel);
  expect((await speech(page)).records[0]).toMatchObject({
    text: deck.slides[0].speaker_notes, rate: 1, voice: { localService: true, voiceURI: "local-en" },
  });

  await highlight(page, "slide");
  await panel.getByLabel("Narration source", { exact: true }).selectOption("slide");
  await count(page, 1);
  expect((await speech(page)).cancels).toBe(1);
  await highlight(page, null);
  await play(panel);
  for (const [index, component] of slideComponents(deck.slides[0]).entries()) {
    expect((await speech(page)).records[index + 1].text).toBe(component.text);
    await highlight(page, component.target);
    await finish(page);
  }
  await expect(panel.getByRole("status")).toContainText("Narration complete");
  await highlight(page, null);
  expect((await speech(page)).records.slice(1).map(record => record.text)).toEqual([
    "Look for evidence", "Compare observations", "Use measurements.", "Visit https://example.com/slides for details.",
  ]);
  await expect(page.getByTestId("preview-position")).toHaveText("1");
  expect(unexpectedRequests).toEqual([]);
});

test("an installed Indian English voice is preferred without exposing Azure in public narration", async ({ page }) => {
  const { panel } = await mount(page, { voices: [
    ...voices,
    { name: "Local India", lang: "en-IN", voiceURI: "local-in", default: false, localService: true },
  ] });
  await expect(panel.getByLabel("On-device voice", { exact: true })).toHaveValue(JSON.stringify(["local-in", "Local India", "en-IN"]));
  await expect(panel.getByLabel("Voice provider", { exact: true })).toHaveCount(0);
  await play(panel);
  expect((await speech(page)).records[0].voice?.lang).toBe("en-IN");
});

test("missing notes never fall back until Slide text is explicitly chosen", async ({ page }) => {
  const noNotes = { ...deck.slides[1], speaker_notes: "" };
  const { panel } = await mount(page, { deck: { ...deck, slides: [noNotes] } });
  await expect(panel).toContainText("No saved narration notes for this slide");
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeDisabled();
  await highlight(page, null);
  await panel.getByRole("button", { name: "Use slide text", exact: true }).click();
  await expect(panel.getByLabel("Narration source", { exact: true })).toHaveValue("slide");
  await count(page, 0);
  await play(panel);
  for (const component of slideComponents(noNotes)) {
    expect((await speech(page)).records.at(-1)?.text).toBe(component.text);
    await highlight(page, component.target);
    await finish(page);
  }
  expect((await speech(page)).records.map(record => record.text)).toEqual([
    "Two explanations", "Evidence", "What we measured.", "Interpretation", "What we think it means.",
  ]);
  await highlight(page, null);
});

test("ordered narration plans retain saved characters, skip missing scripts, and exclude source metadata", () => {
  const saved = slide("Visible title", {
    subtitle: "Visible subtitle", bullets: ["First point", "Second point"],
    speaker_notes: " \tTopic intro.\r\n<script>Plain text</script> https://example.com/intro ",
    component_notes: [
      { target: "bullet-2", text: "  Final script.\n" },
      { target: "title", text: "Title script <b>unchanged</b>" },
    ],
    sources: [{ title: "Citation only", url: "https://example.com/source" }],
  });
  const plan = getSlideNarration(saved, "notes");
  expect(plan.segments).toEqual([
    { target: "slide", label: "Slide / topic notes", text: saved.speaker_notes },
    { target: "title", label: "Slide title", text: saved.component_notes![1].text },
    { target: "bullet-2", label: "Bullet 2", text: saved.component_notes![0].text },
  ]);
  expect(plan.scriptedComponents).toBe(1);
  expect(plan.totalComponents).toBe(2);
  expect(plan.missingComponents.map(component => component.target)).toEqual(["bullet-1"]);
  expect(getSlideNarration({ ...saved, speaker_notes: "", component_notes: [] }, "notes").segments).toEqual([]);
  expect(getSlideNarration(saved, "slide").segments.map(segment => segment.text)).toEqual([
    "Visible title", "Visible subtitle", "First point", "Second point",
  ]);
  expect(getSlideNarration(undefined, "notes").segments).toEqual([]);
  const headerOnly = getSlideNarration(slide("Topic title", {
    layout: "title", bullets: [], subtitle: "Topic subtitle", speaker_notes: "Introduction.",
    component_notes: [{ target: "subtitle", text: "Optional subtitle script." }],
  }), "notes");
  expect(headerOnly).toMatchObject({ scriptedComponents: 0, totalComponents: 0, missingComponents: [] });
  expect(headerOnly.segments.map(segment => segment.target)).toEqual(["slide", "subtitle"]);
});

test("chunk boundaries preserve Unicode, punctuation, whitespace, and oversized grapheme clusters", () => {
  for (const text of [
    "", " \t\r\n", "a".repeat(181), "👩🏽‍🔬".repeat(80), "e\u0301".repeat(500),
    `a${"\u0301".repeat(500)}z`, "x".repeat(179) + "🌍 y\r\n", "\n <b>x</b> [label](https://example.com)  ".repeat(30),
  ]) {
    const chunks = chunkNarration(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every(chunk => chunk.length > 0 && chunk.length <= NARRATION_CHUNK_LENGTH)).toBe(true);
    expect(chunks.every(chunk => Array.from(chunk).every(character => !/^[\uD800-\uDFFF]$/u.test(character)))).toBe(true);
  }
});

const targetFixtures: { name: string; value: Slide; targets: SlideComponentTarget[] }[] = [
  {
    name: "title, subtitle, and all five bullets",
    value: slide("Five ideas", { subtitle: "An overview", bullets: ["One", "Two", "Three", "Four", "Five"] }),
    targets: ["title", "subtitle", "bullet-1", "bullet-2", "bullet-3", "bullet-4", "bullet-5"],
  },
  {
    name: "both cards and all eight column bullets",
    value: slide("Compare ideas", {
      layout: "two_column", subtitle: "Two views", bullets: [],
      columns: [
        { heading: "First", bullets: ["One", "Two", "Three", "Four"] },
        { heading: "Second", bullets: ["Five", "Six", "Seven", "Eight"] },
      ],
    }),
    targets: [
      "title", "subtitle", "column-1", "column-1-bullet-1", "column-1-bullet-2", "column-1-bullet-3", "column-1-bullet-4",
      "column-2", "column-2-bullet-1", "column-2-bullet-2", "column-2-bullet-3", "column-2-bullet-4",
    ],
  },
];

for (const fixture of targetFixtures) {
  test(`saved scripts highlight ${fixture.name} in display order after the slide intro`, async ({ page }) => {
    const saved = {
      ...fixture.value, speaker_notes: "  Slide intro.\r\nKeep all these spaces. ",
      component_notes: fixture.targets.map(target => ({ target, text: ` ${target}: <script>plain text</script> https://example.com/${target}\n` })).reverse(),
    };
    const { panel, unexpectedRequests } = await mount(page, { deck: { ...deck, slides: [saved] } });
    const bodyCount = fixture.targets.filter(target => target !== "title" && target !== "subtitle").length;
    await expect(panel).toContainText(`Body component scripts: ${bodyCount} of ${bodyCount}`);
    await expect(panel.locator("details")).toHaveCount(0);
    await highlight(page, null);
    await play(panel);
    const expected = [
      { target: "slide", text: saved.speaker_notes },
      ...fixture.targets.map(target => ({ target, text: saved.component_notes.find(note => note.target === target)!.text })),
    ];
    for (const segment of expected) {
      expect((await speech(page)).records.at(-1)?.text).toBe(segment.text);
      expect(await panel.getByTestId("narration-caption").textContent()).toBe(segment.text);
      await highlight(page, segment.target);
      await finish(page);
    }
    await expect(panel.getByRole("status")).toContainText("Narration complete");
    await highlight(page, null);
    expect((await speech(page)).records.map(record => record.text)).toEqual(expected.map(segment => segment.text));
    expect(unexpectedRequests).toEqual([]);
  });
}

for (const layout of ["quote", "key_stat"] as const) {
  test(`${layout} reads the body before its trailing subtitle for saved notes and visible text`, async ({ page }) => {
    const saved = slide("A perspective", {
      layout, subtitle: "Source context", bullets: [layout === "quote" ? "Evidence changes minds." : "42%"],
      component_notes: [
        { target: "subtitle", text: "Saved context script." },
        { target: "bullet-1", text: "Saved featured value script." },
        { target: "title", text: "Saved title script." },
      ],
    });
    const { panel } = await mount(page, { deck: { ...deck, slides: [saved] } });
    for (const source of ["notes", "slide"] as const) {
      await panel.getByLabel("Narration source", { exact: true }).selectOption(source);
      await play(panel);
      const targets = ["title", "bullet-1", "subtitle"] as const;
      for (const target of targets) {
        const text = source === "notes" ? saved.component_notes!.find(note => note.target === target)!.text
          : target === "title" ? saved.title : target === "subtitle" ? saved.subtitle : saved.bullets[0];
        expect((await speech(page)).records.at(-1)?.text).toBe(text);
        await highlight(page, target);
        await finish(page);
      }
      await highlight(page, null);
    }
  });
}

for (const layout of ["title", "section", "question", "summary", "process", "timeline"] as const) {
  test(`${layout} highlights only the visual component whose saved script is playing`, async ({ page }) => {
    const bulletLayout = layout !== "title" && layout !== "section";
    const target = bulletLayout ? "bullet-2" : "subtitle";
    const saved = slide("An idea", {
      layout, subtitle: "A topic", bullets: bulletLayout ? ["First point", "Second point"] : [],
      component_notes: [{ target, text: `Only this saved ${target} script is read.` }],
    });
    const { panel } = await mount(page, { deck: { ...deck, slides: [saved] } });
    await play(panel);
    await highlight(page, target);
    await finish(page);
    await highlight(page, null);
    expect((await speech(page)).records.map(record => record.text)).toEqual([saved.component_notes![0].text]);
  });
}

test("every bounded chunk keeps the corresponding component highlighted and its exact caption", async ({ page }) => {
  const saved = slide("Components with long scripts", {
    bullets: ["First visible point.", "Second visible point."], speaker_notes: "Whole-slide introduction.",
    component_notes: [
      { target: "bullet-2", text: "The saved conclusion." },
      { target: "bullet-1", text: "  नमस्ते 🌍 e\u0301 👩🏽‍🔬 <b>First</b> https://example.com/component\r\n".repeat(14) },
      { target: "title", text: "The saved title script." },
    ],
  });
  const { panel } = await mount(page, { deck: { ...deck, slides: [saved] } });
  const expected = [
    { target: "slide", text: saved.speaker_notes },
    ...(["title", "bullet-1", "bullet-2"] as const).map(target => ({ target, text: saved.component_notes!.find(note => note.target === target)!.text })),
  ].flatMap(segment => chunkNarration(segment.text).map(text => ({ target: segment.target, text })));
  await play(panel);
  for (const chunk of expected) {
    await highlight(page, chunk.target);
    expect((await speech(page)).records.at(-1)?.text).toBe(chunk.text);
    expect(await panel.getByTestId("narration-caption").textContent()).toBe(chunk.text);
    await finish(page);
  }
  await highlight(page, null);
  expect((await speech(page)).records.map(record => record.text).join("")).toBe(
    saved.speaker_notes + saved.component_notes![2].text + saved.component_notes![1].text + saved.component_notes![0].text,
  );
});

test("partial component scripts disclose only missing body coverage without reading unscripted text", async ({ page }) => {
  const saved = { ...deck.slides[0], speaker_notes: "", component_notes: [{ target: "bullet-2" as const, text: "Only the saved second-point script." }] };
  const { panel } = await mount(page, { deck: { ...deck, slides: [saved] } });
  await expect(panel).toContainText("No slide / topic script.");
  await expect(panel).toContainText("Body component scripts: 1 of 2.");
  await expect(panel).toContainText("Missing body scripts are skipped.");
  await panel.getByText("Body components without scripts (1)", { exact: true }).click();
  await expect(panel.locator(".slide-narration-coverage li")).toHaveText(["Bullet 1"]);
  await play(panel);
  await highlight(page, "bullet-2");
  await finish(page);
  await highlight(page, null);
  expect((await speech(page)).records.map(record => record.text)).toEqual([saved.component_notes[0].text]);
  await expect(panel.getByRole("status")).toContainText("Narration complete");
});

test("an intro and scripts for every body component report complete coverage without optional header scripts", async ({ page }) => {
  const saved = slide("Four findings", {
    subtitle: "Optional subtitle annotation", bullets: ["One", "Two", "Three", "Four"],
    speaker_notes: "Saved slide introduction.",
    component_notes: (["bullet-1", "bullet-2", "bullet-3", "bullet-4"] as const).map(target => ({
      target, text: `Saved script for ${target}.`,
    })),
  });
  const { panel } = await mount(page, { deck: { ...deck, slides: [saved] } });
  await expect(panel).toContainText("Slide / topic script included.");
  await expect(panel).toContainText("Body component scripts: 4 of 4.");
  await expect(panel).toContainText("Title and subtitle scripts are optional");
  await expect(panel).not.toContainText("Missing body scripts");
  await expect(panel.locator(".slide-narration-coverage")).toHaveCount(0);
  await play(panel);
  for (const target of ["slide", "bullet-1", "bullet-2", "bullet-3", "bullet-4"]) {
    await highlight(page, target);
    await finish(page);
  }
  expect((await speech(page)).records.map(record => record.text)).toEqual([
    saved.speaker_notes, ...saved.component_notes!.map(note => note.text),
  ]);
  await highlight(page, null);
});

test("pause, resume, and stop preserve native Space activation and never restart implicitly", async ({ page }) => {
  const { panel } = await mount(page);
  await panel.getByRole("button", { name: "Play narration", exact: true }).press("Space");
  await panel.getByRole("button", { name: "Pause narration", exact: true }).press("Space");
  await highlight(page, "slide");
  await expect(panel.getByRole("status")).toContainText("Narration paused");
  expect((await speech(page)).pauses).toBe(1);
  await panel.getByRole("button", { name: "Resume narration", exact: true }).press("Space");
  expect((await speech(page)).resumes).toBe(1);
  await count(page, 1);
  await panel.getByRole("button", { name: "Stop narration", exact: true }).press("Space");
  expect((await speech(page)).cancels).toBe(1);
  await stale(page, 0);
  await highlight(page, null);
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeEnabled();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await count(page, 1);
  await expect(page.getByTestId("preview-key-events")).toHaveText("0");
});

test("speed and voice changes stop the old session and are applied only on the next Play", async ({ page }) => {
  const { panel } = await mount(page);
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await panel.getByLabel("Speed", { exact: true }).selectOption("1.25");
  await highlight(page, null);
  await stale(page, 0);
  await count(page, 1);
  await expect(page.getByTestId("preview-position")).toHaveText("1");
  await play(panel);
  expect((await speech(page)).records[1].rate).toBe(1.25);
  await panel.getByLabel("On-device voice", { exact: true }).selectOption({ label: "Local Hindi (hi-IN)" });
  await highlight(page, null);
  await stale(page, 1);
  await count(page, 2);
  await play(panel);
  expect((await speech(page)).records[2].voice?.voiceURI).toBe("local-hi");
  await panel.getByLabel("Speed", { exact: true }).selectOption("0.75");
  await play(panel);
  expect((await speech(page)).records[3].rate).toBe(0.75);
  await panel.getByLabel("Speed", { exact: true }).selectOption("1.5");
  await play(panel);
  expect((await speech(page)).records[4].rate).toBe(1.5);
  await panel.getByLabel("Narration source", { exact: true }).selectOption("slide");
  await highlight(page, null);
  await stale(page, 4);
  await count(page, 5);
  await expect(page.getByTestId("automatic-advances")).toHaveText("0");
});

test("4000-character notes use bounded Unicode-safe chunks without changing any character", async ({ page }) => {
  const notes = Array.from(" \r\nनमस्ते 🌍 e\u0301 👩🏽‍🔬 <b>Evidence</b>\t https://example.com/notes?x=1  ".repeat(160)).slice(0, 4000).join("");
  const longDeck = { ...deck, slides: [{ ...deck.slides[0], speaker_notes: notes }] };
  const { panel } = await mount(page, { deck: longDeck });
  await play(panel);
  await expect(panel.getByRole("progressbar", { name: "Narration progress" })).toBeVisible();
  await finishSlide(page);
  const records = (await speech(page)).records;
  expect(records.length).toBeGreaterThan(15);
  expect(records.every(record => record.text.length <= NARRATION_CHUNK_LENGTH)).toBe(true);
  expect(records.map(record => record.text).join("")).toBe(notes);
  expect(records.every(record => Array.from(record.text).every(character => {
    const code = character.codePointAt(0)!;
    return code < 0xd800 || code > 0xdfff;
  }))).toBe(true);
  expect(records.every(record => record.voice?.localService === true)).toBe(true);
  await expect(panel.getByRole("status")).toContainText("Narration complete");
  await highlight(page, null);
});

test("auto-advance waits for the successful final chunk and stops at the last slide", async ({ page }) => {
  const first = { ...deck.slides[0], speaker_notes: "One short sentence. ".repeat(20) };
  const { panel } = await mount(page, { deck: { ...deck, slides: [first, ...deck.slides.slice(1)] } });
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await finish(page);
  await expect(page.getByTestId("preview-position")).toHaveText("1");
  await expect(page.getByTestId("automatic-advances")).toHaveText("0");
  await page.evaluate(() => {
    const mock = window.narrationMock;
    for (let index = 0; index < 10; index += 1) {
      const previous = mock.records.length;
      mock.finish();
      if (mock.records.length === previous) return;
    }
  });
  await expect(page.getByTestId("preview-position")).toHaveText("2");
  await expect(panel.getByRole("status")).toContainText("Reading aloud");
  const recordsAfterAdvance = (await speech(page)).records.length;
  await stale(page, 0);
  await count(page, recordsAfterAdvance);
  await finish(page);
  await expect(page.getByTestId("preview-position")).toHaveText("3");
  await finish(page);
  await expect(panel.getByRole("status")).toContainText("Narration complete");
  await expect(page.getByTestId("automatic-advances")).toHaveText("2");
  const finalCount = (await speech(page)).records.length;
  await stale(page, finalCount - 1);
  await count(page, finalCount);
  await expect(page.getByTestId("preview-position")).toHaveText("3");
});

test("a completed chunk while paused waits for Resume before advancing", async ({ page }) => {
  const { panel } = await mount(page);
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await panel.getByRole("button", { name: "Pause narration", exact: true }).click();
  await finish(page);
  await count(page, 1);
  await highlight(page, "slide");
  await stale(page, 0);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("preview-position")).toHaveText("1");
  await panel.getByRole("button", { name: "Resume narration", exact: true }).click();
  await expect(page.getByTestId("preview-position")).toHaveText("2");
  await count(page, 2);
});

test("manual navigation, inactive views, and replaced decks invalidate pending callbacks", async ({ page }) => {
  const { panel } = await mount(page);
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await page.getByRole("button", { name: "Next preview slide", exact: true }).click();
  await highlight(page, null);
  await stale(page, 0);
  await count(page, 1);
  await expect(page.getByTestId("preview-position")).toHaveText("2");
  await play(panel);
  await page.getByRole("button", { name: "Deactivate narration", exact: true }).click();
  await highlight(page, null);
  await stale(page, 1);
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Activate narration", exact: true }).click();
  await count(page, 2);
  await play(panel);
  await page.getByRole("button", { name: "Replace deck", exact: true }).click();
  await highlight(page, null);
  await stale(page, 2);
  await count(page, 3);
  await expect(page.getByTestId("automatic-advances")).toHaveText("0");
});

test("callback identity changes keep playback alive, but changed current content stops it", async ({ page }) => {
  const { panel } = await mount(page);
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await page.getByRole("button", { name: "Rerender narration", exact: true }).click();
  await page.getByRole("button", { name: "Rerender narration", exact: true }).click();
  await count(page, 1);
  await highlight(page, "slide");
  expect((await speech(page)).cancels).toBe(0);
  await finish(page);
  await expect(page.getByTestId("preview-position")).toHaveText("2");
  await expect(page.getByTestId("navigation-revision")).toHaveText("2");
  await count(page, 2);
  await page.getByRole("button", { name: "Mutate current script", exact: true }).click();
  await highlight(page, null);
  await stale(page, 1);
  await count(page, 2);
  expect((await speech(page)).cancels).toBe(1);
  await play(panel);
  expect((await speech(page)).records[2].text).toBe("Changed saved script.");
});

test("changing auto-advance stops speech and clears highlighting without navigating", async ({ page }) => {
  const { panel } = await mount(page);
  await play(panel);
  await highlight(page, "slide");
  await panel.getByLabel("Auto-advance through deck").check();
  await highlight(page, null);
  await stale(page, 0);
  await count(page, 1);
  await expect(page.getByTestId("automatic-advances")).toHaveText("0");
});

test("auto-advance stops at missing saved notes rather than switching sources or skipping slides", async ({ page }) => {
  const { panel } = await mount(page, { deck: {
    ...deck, slides: [deck.slides[0], { ...deck.slides[1], speaker_notes: "" }, deck.slides[2]],
  } });
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await finish(page);
  await expect(page.getByTestId("preview-position")).toHaveText("2");
  await expect(panel.getByRole("alert")).toContainText("No saved narration notes");
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeDisabled();
  await count(page, 1);
  await highlight(page, null);
  await stale(page, 0);
  await expect(page.getByTestId("automatic-advances")).toHaveText("1");
  await panel.getByRole("button", { name: "Use slide text", exact: true }).click();
  await count(page, 1);
  await play(panel);
  expect((await speech(page)).records[1].text).toBe("Two explanations");
  await highlight(page, "title");
});

test("manual navigation clears an old slide's completion and error messages", async ({ page }) => {
  const { panel } = await mount(page);
  await play(panel);
  await finish(page);
  await expect(panel.getByRole("status")).toContainText("Narration complete");
  await page.getByRole("button", { name: "Next preview slide", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Ready when you are");
  await play(panel);
  await page.evaluate(() => window.narrationMock.fail());
  await expect(panel.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Next preview slide", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("status")).toContainText("Ready when you are");
  await highlight(page, null);
});

test("multiple mounted panels transfer ownership and never cancel somebody else's audio on cleanup", async ({ page }) => {
  const { panel } = await mount(page, { secondPanel: true });
  const second = page.getByTestId("secondary-narration").getByRole("region", { name: "Slide narration" });
  await play(panel);
  await play(second);
  await highlight(page, null);
  await expect(page.getByTestId("secondary-narration-target")).toHaveText("slide");
  expect((await speech(page)).cancels).toBe(1);
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeEnabled();
  await stale(page, 0);
  await page.getByRole("button", { name: "Hide first narration", exact: true }).click();
  expect((await speech(page)).cancels).toBe(1);
  await expect(second.getByRole("button", { name: "Pause narration", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Show first narration", exact: true }).click();
  await count(page, 2);
  await panel.getByLabel("Speed", { exact: true }).selectOption("1.5");
  await expect(page.getByTestId("secondary-narration-target")).toHaveText("slide");
  expect((await speech(page)).cancels).toBe(1);
  await second.getByRole("button", { name: "Stop narration", exact: true }).click();
  expect((await speech(page)).cancels).toBe(2);
  await play(panel);
  await page.getByRole("button", { name: "Hide first narration", exact: true }).click();
  expect((await speech(page)).cancels).toBe(3);
  await stale(page, 2);
  await count(page, 3);
});

test("unowned speech is left alone rather than cancelled or silently queued behind", async ({ page }) => {
  const { panel } = await mount(page);
  await page.evaluate(() => window.narrationMock.unownedSpeech(true));
  await play(panel);
  await expect(panel.getByRole("alert")).toContainText("Another speech session");
  expect((await speech(page)).cancels).toBe(0);
  await page.getByRole("button", { name: "Hide first narration", exact: true }).click();
  expect((await speech(page)).cancels).toBe(0);
  await count(page, 0);
});

test("page visibility and pagehide stop narration without automatic restart", async ({ page }) => {
  const { panel } = await mount(page);
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await page.evaluate(() => window.narrationMock.hide(true));
  await highlight(page, null);
  await stale(page, 0);
  await page.evaluate(() => window.narrationMock.hide(false));
  await count(page, 1);
  await play(panel);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await highlight(page, null);
  await stale(page, 1);
  await count(page, 2);
  await expect(page.getByTestId("automatic-advances")).toHaveText("0");
});

test("asynchronous local voice discovery and reload never fall back to the cloud voice", async ({ page }) => {
  const { panel } = await mount(page, { voices: [voices[0]] });
  await expect(panel).toContainText("No on-device voices are available");
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeDisabled();
  await page.evaluate(voices => window.narrationMock.setVoices(voices), voices);
  await expect(panel.getByLabel("On-device voice", { exact: true })).toBeEnabled();
  await count(page, 0);
  await play(panel);
  await page.evaluate(voice => window.narrationMock.setVoices([voice]), voices[0]);
  await expect(panel.getByRole("alert")).toContainText("no longer available");
  await highlight(page, null);
  await stale(page, 0);
  await count(page, 1);
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeDisabled();
  await page.evaluate(voices => window.narrationMock.setVoices(voices, false), voices);
  await panel.getByRole("button", { name: "Reload on-device voices", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeEnabled();
  await play(panel);
  expect((await speech(page)).records.every(record => record.voice?.localService === true)).toBe(true);
});

test("a voice lost between chunks fails closed even without a voiceschanged event", async ({ page }) => {
  const { panel } = await mount(page, { deck: {
    ...deck, slides: [{ ...deck.slides[0], speaker_notes: "A saved long script. ".repeat(30) }],
  } });
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await page.evaluate(voice => window.narrationMock.setVoices([voice], false), voices[0]);
  await finish(page);
  await expect(panel.getByRole("alert")).toContainText("no longer available");
  await highlight(page, null);
  await count(page, 1);
  await stale(page, 0);
  await expect(page.getByTestId("automatic-advances")).toHaveText("0");
});

test("a missing speech API has an honest visible state and cannot play", async ({ page }) => {
  const { panel } = await mount(page, { supported: false });
  await expect(panel).toContainText("On-device speech is not supported");
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Reload on-device voices", exact: true }).click();
  await count(page, 0);
});

test("failed voice discovery can be retried and URL-only saved scripts are read verbatim", async ({ page }) => {
  const emptyDeck = { ...deck, slides: [slide("https://example.com", { bullets: [], speaker_notes: "https://example.com/notes" })] };
  const { panel } = await mount(page, { deck: emptyDeck });
  await play(panel);
  expect((await speech(page)).records[0].text).toBe("https://example.com/notes");
  await finish(page);
  await page.evaluate(() => { window.narrationMock.failVoices = true; });
  await panel.getByRole("button", { name: "Reload on-device voices", exact: true }).click();
  await expect(panel).toContainText("Unable to load on-device voices");
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeDisabled();
  await page.evaluate(() => { window.narrationMock.failVoices = false; });
  await panel.getByRole("button", { name: "Reload on-device voices", exact: true }).click();
  await expect(panel.getByLabel("On-device voice", { exact: true })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeEnabled();
  await panel.getByLabel("Narration source", { exact: true }).selectOption("slide");
  await play(panel);
  expect((await speech(page)).records[1].text).toBe("https://example.com");
});

test("speech failures are visible, retryable, and cannot auto-advance", async ({ page }) => {
  const { panel } = await mount(page);
  await panel.getByLabel("Auto-advance through deck").check();
  await page.evaluate(() => { window.narrationMock.throwSpeak = true; });
  await play(panel);
  await expect(panel.getByRole("alert")).toContainText("On-device narration failed");
  await page.evaluate(() => { window.narrationMock.throwSpeak = false; });
  await play(panel);
  await page.evaluate(() => window.narrationMock.fail("not-allowed"));
  await stale(page, 0);
  await expect(panel.getByRole("alert")).toContainText("browser blocked");
  await highlight(page, null);
  await expect(page.getByTestId("automatic-advances")).toHaveText("0");
  await play(panel);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => window.narrationMock.fail());
  await expect(panel.getByRole("alert")).toContainText("On-device narration failed");
  await count(page, 2);
});

test("engine cancellation and interruption errors clear highlights without auto-advancing", async ({ page }) => {
  const { panel } = await mount(page);
  await panel.getByLabel("Auto-advance through deck").check();
  for (const [index, error] of ["canceled", "interrupted"].entries()) {
    await play(panel);
    await highlight(page, "slide");
    await page.evaluate(error => window.narrationMock.fail(error), error);
    await highlight(page, null);
    await stale(page, index);
    await expect(panel.getByRole("alert")).toContainText("On-device narration failed");
    await count(page, index + 1);
    await expect(page.getByTestId("automatic-advances")).toHaveText("0");
  }
});

test("an end event before start is a failure rather than successful completion", async ({ page }) => {
  const { panel } = await mount(page, { autoStart: false });
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await highlight(page, null);
  await finish(page);
  await expect(panel.getByRole("alert")).toContainText("On-device narration failed");
  await stale(page, 0);
  await highlight(page, null);
  await expect(page.getByTestId("automatic-advances")).toHaveText("0");
});

test("a stalled startup surfaces a retryable error and ignores late callbacks", async ({ page }) => {
  await page.clock.install();
  const { panel } = await mount(page, { autoStart: false });
  await panel.getByLabel("Auto-advance through deck").check();
  await play(panel);
  await expect(panel.getByRole("status")).toContainText("Starting");
  await page.clock.fastForward(8_100);
  await expect(panel.getByRole("alert")).toContainText("speech did not start");
  await highlight(page, null);
  await stale(page, 0);
  await expect(page.getByTestId("preview-position")).toHaveText("1");
  await page.evaluate(() => { window.narrationMock.autoStart = true; });
  await play(panel);
  await expect(panel.getByRole("status")).toContainText("Reading aloud");
});

test("untrusted strings stay plain text and narration controls isolate navigation keys", async ({ page }) => {
  const hostileVoice = { ...voices[2], name: "<img src=x onerror='window.narrationUnsafe=true'>" };
  const hostileDeck = { ...deck, slides: [slide("Safe <img src=x onerror='window.narrationUnsafe=true'> title", {
    speaker_notes: "<script>window.narrationUnsafe=true</script>Hello <b>learner</b>. [Read more](https://example.com) www.example.com",
  })] };
  const { panel, unexpectedRequests } = await mount(page, { deck: hostileDeck, voices: [hostileVoice] });
  await expect(panel.locator("img, script, a")).toHaveCount(0);
  await play(panel);
  expect((await speech(page)).records[0].text).toBe(hostileDeck.slides[0].speaker_notes);
  expect(await panel.getByTestId("narration-caption").textContent()).toBe(hostileDeck.slides[0].speaker_notes);
  await expect(panel.locator("img, script, a")).toHaveCount(0);
  await panel.getByRole("button", { name: "Pause narration", exact: true }).press("ArrowRight");
  await panel.getByLabel("Speed", { exact: true }).press("Home");
  await panel.getByLabel("Narration source", { exact: true }).press("ArrowDown");
  await panel.getByLabel("Auto-advance through deck").press("Space");
  await expect(page.getByTestId("preview-key-events")).toHaveText("0");
  expect(await page.evaluate(() => window.narrationUnsafe)).toBeUndefined();
  expect(unexpectedRequests).toEqual([]);
});

test("presenter narration stops on manual navigation, blanking, toggle-off, and exit", async ({ page }) => {
  const { panel } = await mount(page);
  await play(panel);
  await page.getByRole("button", { name: "Start presentation", exact: true }).click();
  const presenter = page.getByRole("dialog", { name: `Presentation: ${deck.title}`, exact: true });
  await expect(presenter.getByRole("region", { name: "Slide narration", exact: true })).toHaveCount(0);
  expect((await speech(page)).cancels).toBe(1);
  await highlight(page, null);
  await presenter.getByRole("button", { name: "Read aloud", exact: true }).click();
  const playerPanel = presenter.getByRole("region", { name: "Slide narration", exact: true });
  await count(page, 1);
  await playerPanel.getByLabel("Auto-advance through deck").check();
  await play(playerPanel);
  const canvas = presenter.getByTestId("slide-canvas");
  await expect(canvas).toHaveAttribute("data-narration-focus", "slide");
  await presenter.getByRole("button", { name: "Next slide", exact: true }).click();
  await stale(page, 1);
  await expect(presenter.getByTestId("presentation-counter")).toHaveText("2 / 3");
  await count(page, 2);
  await expect(canvas).not.toHaveAttribute("data-narration-focus");
  await play(playerPanel);
  await presenter.getByRole("button", { name: "Blank screen", exact: true }).click();
  await stale(page, 2);
  await expect(playerPanel).toBeHidden();
  await expect(canvas).not.toHaveAttribute("data-narration-focus");
  await presenter.getByRole("button", { name: "Show slide", exact: true }).click();
  await count(page, 3);
  await play(playerPanel);
  await presenter.getByRole("button", { name: "Read aloud", exact: true }).click();
  await stale(page, 3);
  await count(page, 4);
  await expect(canvas).not.toHaveAttribute("data-narration-focus");
  await presenter.getByRole("button", { name: "Read aloud", exact: true }).click();
  await play(playerPanel);
  await presenter.getByRole("button", { name: "Exit presentation", exact: true }).click();
  await stale(page, 4);
  await expect(presenter).toHaveCount(0);
  await count(page, 5);
  await expect(page.getByTestId("preview-position")).toHaveText("2");
  await expect(panel.getByRole("button", { name: "Play narration", exact: true })).toBeEnabled();
  await highlight(page, null);
});

test("presenter links exact component scripts to its canvas and displays them as plain text notes", async ({ page }) => {
  const saved = slide("Evidence", {
    speaker_notes: "Slide introduction.",
    component_notes: [
      { target: "bullet-1", text: "<b>Saved bullet script</b> https://example.com/point" },
      { target: "title", text: "Saved title script." },
    ],
  });
  await mount(page, { deck: { ...deck, slides: [saved] } });
  await page.getByRole("button", { name: "Start presentation", exact: true }).click();
  const presenter = page.getByRole("dialog", { name: `Presentation: ${deck.title}`, exact: true });
  await presenter.getByRole("button", { name: "Read aloud", exact: true }).click();
  await presenter.getByRole("button", { name: "Show notes and sources", exact: true }).click();
  const notes = presenter.getByRole("complementary", { name: "Speaker notes and sources", exact: true });
  const componentNotes = notes.getByRole("region", { name: "Component speaker notes", exact: true });
  await expect(componentNotes).toBeVisible();
  await expect(componentNotes.locator(".slide-note-text")).toHaveText([saved.component_notes![1].text, saved.component_notes![0].text]);
  await expect(notes.locator("b, script")).toHaveCount(0);
  const panel = presenter.getByRole("region", { name: "Slide narration", exact: true });
  await play(panel);
  for (const target of ["slide", "title", "bullet-1"]) {
    await expect(presenter.getByTestId("slide-canvas")).toHaveAttribute("data-narration-focus", target);
    await expect(panel.locator(".slide-narration-caption")).toHaveAttribute("data-narration-target", target);
    await expect(notes.locator("[data-note-active=true]")).toHaveCount(1);
    const activeNote = target === "slide" ? notes.locator(".slide-note-scripts > .slide-note-text")
      : componentNotes.locator(`[data-note-target="${target}"]`);
    await expect(activeNote).toHaveAttribute("data-note-active", "true");
    if (target === "bullet-1") {
      await panel.getByRole("button", { name: "Pause narration", exact: true }).click();
      await expect(activeNote).toHaveAttribute("data-note-active", "true");
      await panel.getByRole("button", { name: "Resume narration", exact: true }).click();
    }
    await finish(page);
  }
  await expect(presenter.getByTestId("slide-canvas")).not.toHaveAttribute("data-narration-focus");
  await expect(notes.locator("[data-note-active=true]")).toHaveCount(0);
  expect((await speech(page)).records.map(record => record.text)).toEqual([
    saved.speaker_notes, saved.component_notes![1].text, saved.component_notes![0].text,
  ]);
});

for (const viewport of [{ width: 320, height: 640 }, { width: 640, height: 360 }]) {
  test(`narration settings remain reachable without horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { panel } = await mount(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.getByLabel("Speed", { exact: true }).selectOption("1.25");
    await page.getByRole("button", { name: "Start presentation", exact: true }).click();
    const presenter = page.getByRole("dialog", { name: `Presentation: ${deck.title}`, exact: true });
    await presenter.getByRole("button", { name: "Read aloud", exact: true }).click();
    await presenter.getByRole("button", { name: "Show notes and sources", exact: true }).click();
    const playerPanel = presenter.getByRole("region", { name: "Slide narration", exact: true });
    for (const name of ["Narration source", "On-device voice", "Speed"]) {
      const control = playerPanel.getByLabel(name, { exact: true });
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    await play(playerPanel);
    await expect(playerPanel.getByRole("button", { name: "Pause narration", exact: true })).toBeVisible();
    expect(await presenter.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await presenter.getByRole("button", { name: "Exit presentation", exact: true }).click();
  });
}
