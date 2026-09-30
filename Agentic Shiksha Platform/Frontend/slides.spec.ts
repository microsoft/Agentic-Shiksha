import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ApiMessage, ApiThread } from "./src/lib/chatApi";
import type { Asset } from "./src/lib/types";
import { parseSlideDeck, PPTX_MIME, SLIDES_INVALID_MESSAGE, type CompleteSlidesBlock, type Slide, type SlideDeck, type SlideLayout } from "./src/lib/slides";
import { installSpeechMock } from "./presentation-narration-test-helpers";

const agentId = "course-Example";
const userId = "slides-example-user";
const slidesId = "00000000-0000-4000-8000-000000000055";
// A small binary ZIP fixture: the download must preserve bytes, not wrap them in JSON/text.
const pptx = Buffer.from("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==", "base64");
const makeSlide = (layout: SlideLayout, title: string, extras: Partial<Slide> = {}): Slide => ({
  layout, title, subtitle: "", bullets: [], columns: [], speaker_notes: "", sources: [], ...extras,
});
const deck: SlideDeck = {
  title: "Evidence and explanation", subtitle: "A classroom presentation", theme: "academic",
  slides: [
    makeSlide("title", "Start with a question", { subtitle: "From observations to explanations", speaker_notes: "Opening notes\nInvite every learner to contribute.", sources: [{ title: "Course reading", url: "https://example.com/reading" }, { title: "Printed handbook", url: null }] }),
    makeSlide("section", "Gather evidence", { speaker_notes: "Section notes stay in their original order." }),
    makeSlide("content", "Use precise observations", { bullets: ["Describe what changed.", "<script>window.slideUnsafe = true</script>", "Separate evidence from opinion."] }),
    makeSlide("two_column", "Compare explanations", { columns: [{ heading: "Observation", bullets: ["A directly measured change.", "Repeat the measurement."] }, { heading: "Interpretation", bullets: ["A proposed reason.", "Test an alternative."] }] }),
    makeSlide("question", "What would change your mind?", { bullets: ["Which evidence would challenge your first explanation?"], speaker_notes: "Give learners time to think." }),
    makeSlide("summary", "Make a defensible claim", { bullets: ["State the claim.", "Link it to evidence.", "Describe uncertainty."], speaker_notes: "Closing notes\nReturn to the opening question." }),
  ],
};
const visualDeck: SlideDeck = {
  title: "From question to evidence", subtitle: "A narrated inquiry lesson", theme: "academic",
  slides: [
    makeSlide("title", "Ask a question worth testing", {
      subtitle: "Build an explanation that the evidence can support.",
      speaker_notes: "Start with something you have noticed. Today we will turn that observation into a question, gather evidence, and compare possible explanations.",
    }),
    makeSlide("process", "Turn curiosity into an investigation", {
      bullets: ["Ask a testable question.", "Measure carefully and repeat.", "Compare evidence with the prediction."],
      speaker_notes: "Begin by asking a question that a measurement can answer. Repeat the measurement to check whether the pattern is reliable. Then compare what you observed with what you predicted.",
    }),
    makeSlide("timeline", "Build the explanation over time", {
      bullets: ["First observation: notice a pattern.", "Next investigation: test an alternative.", "Final discussion: explain the remaining uncertainty."],
      speaker_notes: "An explanation becomes stronger over time. Notice the original pattern, test an alternative, and explain what you still do not know.",
    }),
    makeSlide("quote", "Keep evidence separate from interpretation", {
      bullets: ["Describe what you observed before explaining why it happened."],
      subtitle: "Classroom discussion prompt",
      speaker_notes: "This discussion prompt reminds us to distinguish an observation from an interpretation. Ask your partner which parts of your explanation were measured and which parts were inferred.",
      sources: [{ title: "This lesson's discussion prompt", url: null }],
    }),
    makeSlide("key_stat", "A repeatable inquiry has a simple structure", {
      bullets: ["3"], subtitle: "Steps: question, measurement, explanation.",
      speaker_notes: "There are three steps in the process on slide two. A question tells us what to measure. The measurement gives us evidence. The explanation connects that evidence to a claim.",
      sources: [{ title: "The three-step process on slide 2", url: null }],
    }),
    makeSlide("summary", "Make a claim you can defend", {
      bullets: ["State the claim.", "Connect it to measurements.", "Describe uncertainty."],
      speaker_notes: "Return to your opening question. State your claim, show how the measurements support it, and be honest about the uncertainty. That is the foundation of a defensible explanation.",
    }),
  ],
};
const componentDeck: SlideDeck = {
  title: "Impact and applications", subtitle: "A component-scripted presentation", theme: "midnight",
  slides: [
    makeSlide("content", "Impact & Applications", {
      bullets: ["Research acceleration", "Industry deployment potential", "Decision-support systems", "Future collaborative opportunities"],
      speaker_notes: "Let us connect the topic to four practical applications. Each point has a different role, so we will examine them one at a time.",
      component_notes: [
        { target: "bullet-1", text: "Research acceleration means testing ideas more efficiently while keeping a record of the evidence." },
        { target: "bullet-2", text: "Industry deployment requires a validated workflow, clear operating limits, and a plan for monitoring results." },
        { target: "bullet-3", text: "Decision-support systems help people compare options. The person remains responsible for checking the evidence." },
        { target: "bullet-4", text: "Future collaboration can connect complementary expertise. Agree on shared goals and responsibilities before starting." },
      ],
      sources: [{ title: "Course discussion prompts", url: null }],
    }),
    makeSlide("summary", "Keep the evidence in view", {
      bullets: ["Connect each application to its evidence."],
      speaker_notes: "The common thread is responsible use of evidence.",
      component_notes: [{ target: "bullet-1", text: "For every application, explain what is known, what remains uncertain, and who will check the result." }],
    }),
  ],
};
type SlidesBrowserWindow = Window & {
  slidesPreview: { update: (block: CompleteSlidesBlock) => void; dispose: () => void };
  slidesDownloadUrls: { live: string[]; created: string[]; revoked: string[] };
};

function typedValue(key: string, value: unknown): Record<string, unknown> {
  if (typeof value === "string") return { key, valueString: value };
  if (typeof value === "number") return { key, valueNumber: value };
  if (typeof value === "boolean") return { key, valueBoolean: value };
  if (value === null) return { key, valueString: null };
  return { key, valueMap: Object.entries(value as object).map(([name, item]) => typedValue(name, item)) };
}

function streamEvents(agui: boolean, payload: unknown, finish = true, cancel = false) {
  const conversation = { thread_id: "slides-conversation", conversation_id: "slides-conversation" };
  if (!agui) return [
    { type: "thread_id", ...conversation },
    { type: "tool_status", tool: "add_slides", ...conversation },
    { type: "slides_start", ...conversation },
    ...(cancel ? [{ type: "block_cancel", tool: "add_slides", ...conversation }]
      : [payload && typeof payload === "object" ? { ...payload, ...conversation } : payload]),
    ...(finish ? [{ type: "done", ...conversation }] : []),
  ];
  const props = payload as Record<string, unknown>;
  return [
    { type: "RUN_STARTED", threadId: "slides-conversation", runId: "slides-run" },
    { type: "CUSTOM", name: "tool_status", value: { tool: "add_slides" } },
    { type: "STEP_STARTED", stepName: "slides" },
    ...(cancel ? [{ type: "CUSTOM", name: "block_cancel", value: { tool: "add_slides" } }] : [
      { type: "CUSTOM", name: "a2ui", value: { updateComponents: { surfaceId: slidesId, components: [{
        id: "root", component: { Slides: { title: { path: "/title" }, slidesId: { path: "/slidesId" }, deck: { path: "/deck" } } },
      }] } } },
      { type: "CUSTOM", name: "a2ui", value: { updateDataModel: { surfaceId: slidesId, contents: ["title", "slidesId", "deck"].map(key => typedValue(key, props[key])) } } },
      { type: "CUSTOM", name: "a2ui", value: { createSurface: { surfaceId: slidesId, root: "root", catalogId: "ekalaiva" } } },
      { type: "STEP_FINISHED", stepName: "slides" },
    ]),
    ...(finish ? [{ type: "RUN_FINISHED", threadId: "slides-conversation", runId: "slides-run" }] : []),
  ];
}

async function mockSlides(page: Page, role = "teacher") {
  const messages = new Map<string, ApiMessage>();
  const threads = new Map<string, ApiThread>();
  const assets: Asset[] = [];
  const exports: Array<{ agent: string; body: unknown; cookie: string }> = [];
  const saves: Array<{ agent: string; body: unknown; cookie: string }> = [];
  const toolWrites: unknown[] = [];
  const unexpectedWrites: string[] = [];
  let exportStatus = 200;
  let exportMime = PPTX_MIME;
  let saveStatus = 200;
  let malformedSave = false;
  let payload: unknown = { type: "slides", slidesId, title: deck.title, deck };
  let complete = true;
  let cancelled = false;
  let restoredBlock: unknown;
  const restoredMessages = () => [...messages.values()].map(message => restoredBlock && message.role === "assistant"
    ? { ...message, metadata: { ...message.metadata, contentBlocks: [restoredBlock] } }
    : message);
  await page.addInitScript(({ agentId, userId, role }) => {
    if (sessionStorage.getItem("slides-test-seeded")) return;
    sessionStorage.setItem("slides-test-seeded", "true");
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({ version: 1, state: {
      userId, displayName: "Example Teacher", email: "user@example.com", role, authProvider: "microsoft", isAuthenticated: true,
    } }));
    localStorage.setItem("ekalaiva.chat.v1", JSON.stringify({ version: 2, state: {
      onboardingCompleted: true, userStatus: "active", userName: "Example",
      projects: { "slides-project": { id: "slides-project", name: "Example", agentId, agentName: agentId, createdAt: 1, updatedAt: 1 } },
      threads: {}, messagesByThreadId: {}, activeThreadId: null,
    } }));
  }, { agentId, userId, role });
  await page.context().addCookies([{ name: "slide-session", value: "mock-authenticated", url: "http://127.0.0.1:4175", httpOnly: true }]);
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (/\/api\/agents\/[^/]+\/chat\/(stream|agui)$/.test(path)) {
      const events = streamEvents(path.endsWith("/agui"), payload, complete, cancelled);
      return route.fulfill({ contentType: "text/event-stream", body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") });
    }
    if (path.endsWith("/slides/export")) {
      exports.push({ agent: decodeURIComponent(path.split("/")[3]), body: request.postDataJSON(), cookie: (await request.allHeaders()).cookie || "" });
      return exportStatus === 200 ? route.fulfill({ contentType: exportMime, headers: { "Content-Disposition": 'attachment; filename="slides.pptx"' }, body: pptx })
        : route.fulfill({ status: exportStatus, json: { detail: "Course access is required to export slides." } });
    }
    if (path.endsWith("/slides/save")) {
      saves.push({ agent: decodeURIComponent(path.split("/")[3]), body: request.postDataJSON(), cookie: (await request.allHeaders()).cookie || "" });
      if (saveStatus !== 200) return route.fulfill({ status: saveStatus, json: { detail: "The private copy could not be saved. Please retry." } });
      if (malformedSave) return route.fulfill({ json: { success: true } });
      const savedDeck = request.postDataJSON().deck as SlideDeck;
      const block: CompleteSlidesBlock = {
        type: "slides", slidesId: `00000000-0000-4000-8000-${String(100 + saves.length).padStart(12, "0")}`,
        title: savedDeck.title, deck: savedDeck, agentId,
      };
      const asset: Asset = {
        id: `asset-${assets.length}`, userId, title: block.title, category: "presentation", type: "json",
        content: JSON.stringify(block), agentId, isPublic: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      assets.push(asset);
      return route.fulfill({ json: { assetId: asset.id, block } });
    }
    if (path.endsWith("/slides/tool")) {
      if (request.method() === "POST") toolWrites.push(request.postDataJSON());
      return route.fulfill({ json: { enabled: toolWrites.length > 0, agent_version: toolWrites.length ? "4" : "3" } });
    }
    if (path === "/api/chat/sync") {
      const batch = request.postDataJSON();
      for (const thread of batch.threads) threads.set(thread.id, thread);
      for (const message of batch.messages) messages.set(message.id, message);
      return route.fulfill({ json: { success: true, threadsUpserted: batch.threads.length, messagesUpserted: batch.messages.length } });
    }
    if (path.startsWith("/api/chat/load/")) return route.fulfill({ json: { threads: [...threads.values()], messages: restoredMessages() } });
    if (path.endsWith("/messages")) {
      const thread = path.split("/").at(-2);
      const selection = restoredMessages().filter(message => message.threadId === thread);
      return route.fulfill({ json: { messages: selection, total: selection.length, hasMore: false } });
    }
    if (path === "/api/assets") {
      if (request.method() === "POST") {
        const asset: Asset = { ...request.postDataJSON(), id: `asset-${assets.length}`, userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        assets.push(asset);
        return route.fulfill({ json: asset });
      }
      return route.fulfill({ json: { assets, total: assets.length } });
    }
    if (path === "/api/shared/slides-example") return route.fulfill({ json: {
      thread: { id: "shared-slides", title: "Slides shared example", createdAt: new Date().toISOString() },
      messages: restoredMessages(),
    } });
    if (path === "/auth/me") return route.fulfill({ json: { id: userId, displayName: "Example Teacher", email: "user@example.com" } });
    if (path.startsWith("/api/user/")) return route.fulfill({ json: { success: true, profile: { id: userId, role, status: "active", onboardingCompleted: true, displayName: "Example Teacher", email: "user@example.com" } } });
    if (path === "/api/azure/agents/list") return route.fulfill({ json: [{ id: agentId, name: agentId, created_by_id: role === "student" ? "course-owner" : userId }] });
    if (path === "/api/config") return route.fulfill({ json: { default_model: "example-model", agent_model: "example-model", allowed_models: ["example-model"], version: "test" } });
    if (path.startsWith("/api/agents/setup/")) return route.fulfill({ json: { courseName: "Example", createdById: role === "student" ? "course-owner" : userId, conversationStarters: [] } });
    if (path.startsWith("/api/")) {
      if (request.method() !== "GET" && !path.includes("/followups") && !path.includes("/follow-ups") && !path.includes("/title")) unexpectedWrites.push(path);
      return route.fulfill({ json: { success: true, status: "not_available", threads: [...threads.values()], messages: [], assets: [], versions: [], starters: [], total: 0, hasMore: false, progress: null } });
    }
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.goto("/course/Example");
  await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
  return {
    messages, threads, assets, exports, saves, toolWrites, unexpectedWrites,
    payload: (next: unknown) => { payload = next; },
    endStream: (next: boolean) => { complete = next; },
    cancel: () => { cancelled = true; },
    restoreBlock: (block: unknown) => { restoredBlock = block; },
    exportFailure: (status: number, mime = PPTX_MIME) => { exportStatus = status; exportMime = mime; },
    saveFailure: (status: number, malformed = false) => { saveStatus = status; malformedSave = malformed; },
  };
}

async function askForSlides(page: Page) {
  const input = page.getByRole("textbox").last();
  await input.fill("Create slides for this lesson.");
  await input.press("Enter");
}
async function openSlides(page: Page, title = deck.title) {
  await expect(page.getByRole("button", { name: `Open slides: ${title}`, exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: `Open slides: ${title}`, exact: true }).last().click();
  const dialog = page.getByRole("region", { name: "Presentation pane", exact: true })
    .or(page.getByRole("dialog", { name: title, exact: true }));
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(dialog.getByRole("button", { name: "Copy presentation", exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Read slide text", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/while focused in this presentation\. Slide content is plain text\./)).toHaveCount(0);
  return dialog;
}
async function editSlides(page: Page, pane: Locator) {
  await pane.getByRole("button", { name: "Edit presentation", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit presentation", exact: true });
  await expect(editor).toBeVisible();
  return editor;
}
async function reloadFromServer(page: Page) {
  await page.evaluate(() => sessionStorage.setItem("slides-clear-messages", "true"));
  await page.addInitScript(() => {
    if (sessionStorage.getItem("slides-clear-messages") !== "true") return;
    sessionStorage.removeItem("slides-clear-messages");
    const value = JSON.parse(localStorage.getItem("ekalaiva.chat.v1")!);
    value.state.messagesByThreadId = {};
    localStorage.setItem("ekalaiva.chat.v1", JSON.stringify(value));
  });
  await page.reload();
}
async function holdStreamOpen(page: Page) {
  await page.evaluate(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (typeof input !== "string" || !/\/chat\/(stream|agui)$/.test(input)) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        },
      }), { status: response.status, headers: response.headers });
    };
  });
}
async function assertCanvasFits(dialog: Locator) {
  await expect.poll(() => dialog.getByTestId("slide-canvas").evaluate(element => {
    const box = element.getBoundingClientRect();
    const fit = element.querySelector(".slides-fit")!;
    const body = element.querySelector(".slides-fit-content")!;
    return {
      ratio: Math.abs(box.width / box.height - 16 / 9) < .03,
      fits: body.scrollHeight <= fit.clientHeight + 2 && body.scrollWidth <= fit.clientWidth + 2,
      horizontal: element.scrollWidth <= element.clientWidth + 1,
    };
  })).toEqual({ ratio: true, fits: true, horizontal: true });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

for (const theme of ["academic", "midnight", "warm"] as const) {
  test(`visual presentation layouts remain distinct and fit desktop and mobile (${theme})`, async ({ page }, testInfo) => {
    const remote = await mockSlides(page);
    const presentation = { ...visualDeck, theme };
    remote.payload({ type: "slides", slidesId, title: presentation.title, deck: presentation });
    await askForSlides(page);
    const pane = await openSlides(page, presentation.title);
    const cases = [
      { index: 1, layout: "process", selector: ".slides-process li", count: 3 },
      { index: 2, layout: "timeline", selector: ".slides-timeline li", count: 3 },
      { index: 3, layout: "quote", selector: ".slides-quotation blockquote", count: 1 },
      { index: 4, layout: "key_stat", selector: ".slides-statistic-value", count: 1 },
    ];
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const item of cases) {
        await pane.getByRole("button", { name: `Go to slide ${item.index + 1}: ${presentation.slides[item.index].title}`, exact: true }).click();
        const canvas = pane.getByTestId("slide-canvas");
        await expect(canvas).toHaveAttribute("data-layout", item.layout);
        await expect(canvas.locator(item.selector)).toHaveCount(item.count);
        await assertCanvasFits(pane);
        for (const bullet of presentation.slides[item.index].bullets) await expect(canvas.getByText(bullet, { exact: true })).toBeVisible();
        await canvas.screenshot({ path: testInfo.outputPath(`${theme}-${item.layout}-${width}.png`), animations: "disabled" });
      }
    }
    const download = page.waitForEvent("download");
    await pane.getByRole("button", { name: "Download PPTX", exact: true }).click();
    await download;
    expect(remote.exports.at(-1)?.body).toEqual({ deck: presentation });
    expect(parseSlideDeck(presentation)).toEqual(presentation);
  });
}

test("visual layout editing enforces its bounds and presentation checks link to missing notes", async ({ page }) => {
  const remote = await mockSlides(page);
  await askForSlides(page);
  const pane = await openSlides(page);
  await pane.getByRole("button", { name: "Go to slide 3: Use precise observations", exact: true }).click();
  const editor = await editSlides(page, pane);
  await editor.locator(".slides-editor-quality > summary").click();
  await expect(editor.locator(".slides-editor-quality")).toContainText("4 of 6 slides have speaker notes.");
  await editor.locator(".slides-editor-quality").getByRole("button", { name: /Slide 4 Add speaker notes/ }).click();
  await expect(editor.getByRole("textbox", { name: "Slide title", exact: true })).toHaveValue("Compare explanations");
  await editor.getByRole("button", { name: "Edit slide 3: Use precise observations", exact: true }).click();
  await editor.getByRole("combobox", { name: "Slide layout", exact: true }).selectOption("process");
  await expect(editor.getByRole("textbox", { name: "Step 1", exact: true })).toHaveValue("Describe what changed.");
  await editor.getByRole("button", { name: "Remove step 3", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Remove step 2", exact: true })).toBeDisabled();
  await editor.getByRole("combobox", { name: "Slide layout", exact: true }).selectOption("timeline");
  await expect(editor.getByRole("textbox", { name: "Milestone 1", exact: true })).toHaveValue("Describe what changed.");
  await editor.getByRole("combobox", { name: "Slide layout", exact: true }).selectOption("quote");
  await expect(editor.getByRole("textbox", { name: "Speaker notes", exact: true })).toHaveValue(/Describe what changed/);
  await editor.getByRole("textbox", { name: "Quotation", exact: true }).fill("Repeat the measurement before drawing a conclusion.");
  await editor.getByRole("combobox", { name: "Slide layout", exact: true }).selectOption("key_stat");
  await expect(editor.getByRole("textbox", { name: "Speaker notes", exact: true })).toHaveValue(/Repeat the measurement before drawing a conclusion/);
  await editor.getByRole("textbox", { name: "Featured value", exact: true }).fill("x".repeat(41));
  await expect(editor.getByRole("button", { name: "Save copy to Assets", exact: true })).toBeDisabled();
  await editor.getByRole("textbox", { name: "Featured value", exact: true }).fill("2");
  await editor.getByRole("textbox", { name: "Slide subtitle", exact: true }).fill("Compare at least two measurements.");
  await editor.getByRole("button", { name: "Save copy to Assets", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = JSON.parse(remote.assets.at(-1)!.content) as CompleteSlidesBlock;
  expect(saved.deck.slides[2]).toMatchObject({ layout: "key_stat", bullets: ["2"], subtitle: "Compare at least two measurements." });
  expect(saved.deck.slides[2].speaker_notes).toContain("Repeat the measurement before drawing a conclusion.");
});

test("slide and component scripts can be edited, remapped, saved and reopened without inventing or losing notes", async ({ page }) => {
  test.setTimeout(60000);
  const remote = await mockSlides(page);
  remote.payload({ type: "slides", slidesId, title: componentDeck.title, deck: componentDeck });
  await askForSlides(page);
  let pane = await openSlides(page, componentDeck.title);
  await pane.getByRole("button", { name: "Show speaker notes", exact: true }).click();
  await expect(pane.getByText(componentDeck.slides[0].speaker_notes, { exact: true })).toBeVisible();
  await expect(pane.getByRole("region", { name: "Component speaker notes", exact: true })).toHaveCount(1);
  await expect(pane.getByText(componentDeck.slides[0].component_notes![0].text, { exact: true })).toBeVisible();
  const editor = await editSlides(page, pane);
  const revised = "Research acceleration saves time during exploration.\nKeep the original evidence and test alternative explanations.";
  await editor.getByRole("textbox", { name: "Bullet 1 narration notes", exact: true }).fill(revised);
  await expect(editor.getByTestId("slide-canvas")).toHaveAttribute("data-narration-focus", "bullet-1");
  await expect(editor.locator('[data-narration-target="bullet-1"]')).toHaveAttribute("data-narration-active", "true");
  await editor.getByRole("button", { name: "Remove bullet 1", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Bullet 1", exact: true })).toHaveValue("Industry deployment potential");
  await expect(editor.getByRole("textbox", { name: "Bullet 1 narration notes", exact: true })).toHaveValue(componentDeck.slides[0].component_notes![1].text);
  await expect(editor.getByRole("textbox", { name: "Bullet 2 narration notes", exact: true })).toHaveValue(componentDeck.slides[0].component_notes![2].text);
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Bullet 1", exact: true })).toHaveValue("Research acceleration");
  await expect(editor.getByRole("textbox", { name: "Bullet 1 narration notes", exact: true })).toHaveValue(revised);
  await editor.getByRole("combobox", { name: "Slide layout", exact: true }).selectOption("two_column");
  await expect(editor.getByRole("alert")).toContainText("would detach component narration");
  await expect(editor.getByRole("combobox", { name: "Slide layout", exact: true })).toHaveValue("content");
  await editor.getByRole("textbox", { name: "Presentation title", exact: true }).fill("Reviewed component scripts");
  await editor.getByRole("button", { name: "Save copy to Assets", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = JSON.parse(remote.assets.at(-1)!.content) as CompleteSlidesBlock;
  expect(saved.deck.slides[0].speaker_notes).toBe(componentDeck.slides[0].speaker_notes);
  expect(saved.deck.slides[0].component_notes?.find(note => note.target === "bullet-1")?.text).toBe(revised);
  expect(saved.deck.slides[0].component_notes?.find(note => note.target === "bullet-2")?.text).toBe(componentDeck.slides[0].component_notes![1].text);
  await page.goto("/assets");
  await page.reload();
  pane = await openSlides(page, saved.title);
  await pane.getByRole("button", { name: "Show speaker notes", exact: true }).click();
  await expect(pane.getByText(revised, { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await pane.getByRole("button", { name: "Download PPTX", exact: true }).click();
  await download;
  expect(remote.exports.at(-1)?.body).toEqual({ deck: saved.deck });
  expect(JSON.parse(remote.assets[0].content).deck).toEqual(componentDeck);
});

for (const width of [1440, 320]) {
  test(`saved narration scripts highlight their exact components across preview and presenter at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await installSpeechMock(page);
    const remote = await mockSlides(page);
    if (width < 768) await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    remote.payload({ type: "slides", slidesId, title: componentDeck.title, deck: componentDeck });
    await askForSlides(page);
    const pane = await openSlides(page, componentDeck.title);
    await pane.getByRole("button", { name: "Show speaker notes", exact: true }).click();
    await pane.getByRole("button", { name: "Read aloud", exact: true }).click();
    const narration = pane.getByRole("region", { name: "Slide narration", exact: true });
    expect(await page.evaluate(() => window.narrationMock.records.length)).toBe(0);
    await narration.getByRole("button", { name: "Play narration", exact: true }).click();
    const canvas = pane.getByTestId("slide-canvas");
    await expect(canvas).toHaveAttribute("data-narration-focus", "slide");
    expect(await page.evaluate(() => window.narrationMock.records.at(-1)?.text)).toBe(componentDeck.slides[0].speaker_notes);
    for (const [index, note] of componentDeck.slides[0].component_notes!.entries()) {
      await page.evaluate(() => window.narrationMock.finish());
      await expect(canvas).toHaveAttribute("data-narration-focus", note.target);
      await expect(canvas.locator("[data-narration-active=true]")).toHaveCount(1);
      await expect(canvas.locator(`[data-narration-target="${note.target}"]`)).toHaveAttribute("data-narration-active", "true");
      await expect(pane.locator(`[data-note-target="${note.target}"]`)).toHaveAttribute("data-note-active", "true");
      await expect(pane.locator(`[data-note-target="${note.target}"]`)).toBeInViewport({ ratio: 0.95 });
      expect(await page.evaluate(() => window.narrationMock.records.at(-1)?.text)).toBe(note.text);
      if (index === 1) {
        await narration.getByRole("button", { name: "Pause narration", exact: true }).click();
        await expect(canvas).toHaveAttribute("data-narration-focus", note.target);
        await assertCanvasFits(pane);
        expect(await pane.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
        await pane.screenshot({ path: testInfo.outputPath(`component-narration-${width}.png`), animations: "disabled" });
        await narration.getByRole("button", { name: "Resume narration", exact: true }).click();
      }
    }
    expect(await page.evaluate(() => window.narrationMock.records.map(record => record.text))).toEqual([
      componentDeck.slides[0].speaker_notes, ...componentDeck.slides[0].component_notes!.map(note => note.text),
    ]);
    await page.evaluate(() => window.narrationMock.finish());
    await expect(canvas).not.toHaveAttribute("data-narration-focus");
    await expect(narration.getByRole("status")).toContainText("Narration complete");
    await narration.getByRole("button", { name: "Play narration", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-narration-focus", "slide");
    const beforePlayer = await page.evaluate(() => window.narrationMock.records.length);
    await pane.getByRole("button", { name: "Start presentation", exact: true }).click();
    const player = page.getByRole("dialog", { name: `Presentation: ${componentDeck.title}`, exact: true });
    await expect(player).toBeVisible();
    expect(await page.evaluate(() => window.narrationMock.records.length)).toBe(beforePlayer);
    await player.getByRole("button", { name: "Read aloud", exact: true }).click();
    await player.getByRole("button", { name: "Play narration", exact: true }).click();
    await expect(player.getByTestId("slide-canvas")).toHaveAttribute("data-narration-focus", "slide");
    await page.evaluate(() => window.narrationMock.finish());
    await expect(player.getByTestId("slide-canvas")).toHaveAttribute("data-narration-focus", "bullet-1");
    await player.getByRole("button", { name: "Blank screen", exact: true }).click();
    await expect(player.getByTestId("slide-canvas")).not.toHaveAttribute("data-narration-focus");
    const stopped = await page.evaluate(() => window.narrationMock.records.length);
    await page.evaluate(() => window.narrationMock.records.at(-1)?.end?.());
    expect(await page.evaluate(() => window.narrationMock.records.length)).toBe(stopped);
    await player.getByRole("button", { name: "Exit presentation", exact: true }).click();
    await expect(player).toHaveCount(0);
    await expect(canvas).not.toHaveAttribute("data-narration-focus");
    expect(await page.evaluate(() => window.narrationMock.records.length)).toBe(stopped);
    expect(remote.saves).toHaveLength(0);
    expect(remote.exports).toHaveLength(0);
  });
}

test("presentation editor saves a private copy, reopens from Assets after reload, and exports the edited deck", async ({ page }) => {
  test.setTimeout(60000);
  const remote = await mockSlides(page, "student");
  await askForSlides(page);
  const pane = await openSlides(page);
  await expect.poll(() => remote.assets.length).toBe(1);
  const originalAsset = structuredClone(remote.assets[0]);
  await pane.getByRole("button", { name: "Go to slide 3: Use precise observations", exact: true }).click();
  const editor = await editSlides(page, pane);
  await expect(editor.getByRole("textbox", { name: "Slide title", exact: true })).toHaveValue("Use precise observations");
  await editor.getByRole("textbox", { name: "Presentation title", exact: true }).fill("My evidence lesson");
  await editor.getByRole("combobox", { name: "Theme", exact: true }).selectOption("midnight");
  await editor.getByRole("textbox", { name: "Slide title", exact: true }).fill("Observe carefully");
  await editor.getByRole("textbox", { name: "Bullet 1", exact: true }).fill("Record an observation before explaining it.");
  await editor.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("Invite learners to compare their measurements.");
  await editor.getByRole("button", { name: "Add source", exact: true }).click();
  await editor.getByRole("textbox", { name: "Source 1 title", exact: true }).fill("Measurement guide");
  await editor.getByRole("textbox", { name: "Source 1 URL", exact: true }).fill("https://example.com/measurements");
  await expect(editor.getByTestId("slide-canvas")).toHaveClass(/slides-theme-midnight/);
  await expect(editor.getByTestId("slide-canvas").getByRole("heading", { name: "Observe carefully" })).toBeVisible();
  await editor.getByRole("button", { name: "Save copy to Assets", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(pane.getByText("My evidence lesson", { exact: true })).toBeVisible();
  expect(remote.saves).toHaveLength(1);
  expect(remote.saves[0].agent).toBe(agentId);
  expect(remote.saves[0].cookie).toBe("slide-session=mock-authenticated");
  expect(Object.keys(remote.saves[0].body as object)).toEqual(["deck"]);
  expect(remote.assets).toHaveLength(2);
  expect(remote.assets[0]).toEqual(originalAsset);
  const saved = JSON.parse(remote.assets[1].content) as CompleteSlidesBlock;
  expect(saved.slidesId).not.toBe(slidesId);
  expect(saved.agentId).toBe(agentId);
  expect(saved.deck.theme).toBe("midnight");
  expect(saved.deck.slides[2]).toMatchObject({
    title: "Observe carefully", speaker_notes: "Invite learners to compare their measurements.",
    sources: [{ title: "Measurement guide", url: "https://example.com/measurements" }],
  });
  expect(remote.assets[1]).toMatchObject({ category: "presentation", isPublic: false, userId });
  await page.goto("/assets");
  await page.reload();
  const savedDialog = await openSlides(page, saved.title);
  await expect(savedDialog.getByTestId("slide-canvas")).toHaveClass(/slides-theme-midnight/);
  await savedDialog.getByRole("button", { name: "Go to slide 3: Observe carefully", exact: true }).click();
  await savedDialog.getByRole("button", { name: "Show speaker notes", exact: true }).click();
  await expect(savedDialog.getByText(saved.deck.slides[2].speaker_notes, { exact: true })).toBeVisible();
  await expect(savedDialog.getByRole("link", { name: /Measurement guide/ })).toHaveAttribute("href", "https://example.com/measurements");
  const downloaded = page.waitForEvent("download");
  await savedDialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("My evidence lesson.pptx");
  expect(remote.exports.at(-1)?.body).toEqual({ deck: saved.deck });
  // Editing a saved copy uses the same workflow, without changing earlier versions.
  const reopenedEditor = await editSlides(page, savedDialog);
  await expect(reopenedEditor.getByRole("textbox", { name: "Presentation title", exact: true })).toHaveValue(saved.title);
  await reopenedEditor.getByRole("textbox", { name: "Presentation title", exact: true }).fill("My follow-up lesson");
  await reopenedEditor.getByRole("button", { name: "Save copy to Assets", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "My follow-up lesson", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open slides: My follow-up lesson", exact: true, includeHidden: true })).toHaveCount(1);
  expect(remote.assets).toHaveLength(3);
  expect(JSON.parse(remote.assets[1].content)).toEqual(saved);
  expect(JSON.parse(remote.assets[2].content).slidesId).not.toBe(saved.slidesId);
  expect(remote.assets[0]).toEqual(originalAsset);
});

test("presentation editor manages slide order, layout content, and undo without changing the original", async ({ page }) => {
  const remote = await mockSlides(page);
  await askForSlides(page);
  const pane = await openSlides(page);
  await pane.getByRole("button", { name: "Go to slide 3: Use precise observations", exact: true }).click();
  const editor = await editSlides(page, pane);
  await editor.getByRole("combobox", { name: "Slide layout", exact: true }).selectOption("two_column");
  await expect(editor.getByRole("textbox", { name: "Speaker notes", exact: true })).toHaveValue(/Content from previous layout:\n- Describe what changed/);
  await editor.getByRole("textbox", { name: "Column 1 heading", exact: true }).fill("Evidence");
  await editor.getByRole("textbox", { name: "Column 2 Bullet 1", exact: true }).fill("Question your explanation.");
  await editor.getByRole("button", { name: "Duplicate slide", exact: true }).click();
  await editor.getByRole("textbox", { name: "Slide title", exact: true }).fill("Second comparison");
  await editor.getByRole("button", { name: "Move slide earlier", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Edit slide 3: Second comparison", exact: true })).toHaveAttribute("aria-current", "step");
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Edit slide 4: Second comparison", exact: true })).toHaveAttribute("aria-current", "step");
  await editor.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Edit slide 3: Second comparison", exact: true })).toHaveAttribute("aria-current", "step");
  await editor.getByRole("button", { name: "Delete slide", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete slide", exact: true }).click();
  await expect(editor.getByRole("button", { name: /Edit slide \d: Second comparison/ })).toHaveCount(0);
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Edit slide 3: Second comparison", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Add slide", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Slide title", exact: true })).toHaveValue("New slide");
  await editor.getByRole("textbox", { name: "Slide title", exact: true }).press("Control+z");
  await expect(editor.getByRole("button", { name: /Edit slide \d: New slide/ })).toHaveCount(0);
  await editor.getByRole("button", { name: "Cancel editing", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveAccessibleName("Discard unsaved changes?");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(pane.getByRole("status", { name: "Slide 3 of 6", exact: true })).toBeVisible();
  expect(remote.saves).toHaveLength(0);
  expect(JSON.parse(remote.assets[0].content).deck).toEqual(deck);
});

test("presentation editor blocks invalid fields and retains drafts on save failures and invalid responses", async ({ page }) => {
  const remote = await mockSlides(page);
  await askForSlides(page);
  const pane = await openSlides(page);
  const editor = await editSlides(page, pane);
  await editor.getByRole("textbox", { name: "Presentation title", exact: true }).fill("");
  await expect(editor.getByRole("button", { name: "Save copy to Assets", exact: true })).toBeDisabled();
  await expect(editor.getByRole("status").filter({ hasText: "Presentation title: enter some text." })).toBeVisible();
  await editor.getByRole("textbox", { name: "Presentation title", exact: true }).fill("Retryable draft");
  await editor.getByRole("textbox", { name: "Source 1 URL", exact: true }).fill("javascript:alert(1)");
  await expect(editor.getByRole("button", { name: "Save copy to Assets", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Download PPTX", exact: true })).toBeDisabled();
  expect(remote.saves).toHaveLength(0);
  await editor.getByRole("textbox", { name: "Source 1 URL", exact: true }).fill("https://example.com/new-reading");
  remote.saveFailure(503);
  await editor.getByRole("button", { name: "Save copy to Assets", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Could not save the presentation");
  await expect(editor.getByRole("textbox", { name: "Presentation title", exact: true })).toHaveValue("Retryable draft");
  expect(remote.assets).toHaveLength(1);
  remote.saveFailure(200, true);
  await editor.getByRole("button", { name: "Save copy to Assets", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("did not confirm a saved presentation");
  expect(remote.assets).toHaveLength(1);
  remote.exportFailure(503);
  await editor.getByRole("button", { name: "Download PPTX", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Export failed.");
  await expect(editor.getByRole("textbox", { name: "Presentation title", exact: true })).toBeEnabled();
  remote.saveFailure(200);
  await editor.getByRole("button", { name: "Save copy to Assets", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(remote.saves).toHaveLength(3);
  expect(remote.assets).toHaveLength(2);
});

test("presentation editor imports and exports JSON with confirmation, validation, and unsaved-change protection", async ({ page }) => {
  const remote = await mockSlides(page);
  await askForSlides(page);
  const pane = await openSlides(page);
  const editor = await editSlides(page, pane);
  const fileInput = editor.getByLabel("Import presentation JSON", { exact: true });
  await fileInput.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(editor.getByRole("alert")).toContainText("not valid JSON");
  await expect(editor.getByRole("textbox", { name: "Presentation title", exact: true })).toHaveValue(deck.title);
  const imported: SlideDeck = { ...deck, title: "Imported lesson", theme: "warm", slides: [makeSlide("content", "Imported slide", { bullets: ["An editable idea"], speaker_notes: "Imported notes" })] };
  await fileInput.setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByRole("alertdialog")).toHaveAccessibleName("Import presentation?");
  await page.getByRole("button", { name: "Replace draft", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Presentation title", exact: true })).toHaveValue(imported.title);
  await expect(editor.getByRole("button", { name: "Delete slide", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Move slide earlier", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Move slide later", exact: true })).toBeDisabled();
  const downloaded = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Download JSON", exact: true }).click();
  const backup = await downloaded;
  expect(backup.suggestedFilename()).toBe("Imported lesson.json");
  expect(JSON.parse(readFileSync((await backup.path())!, "utf8"))).toEqual(imported);
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Presentation title", exact: true })).toHaveValue(deck.title);
  await editor.getByRole("button", { name: "Redo", exact: true }).click();
  await editor.getByRole("textbox", { name: "Slide title", exact: true }).press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveAccessibleName("Discard unsaved changes?");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Presentation title", exact: true })).toHaveValue(imported.title);
  expect(remote.saves).toHaveLength(0);
  expect(remote.exports).toHaveLength(0);
  const maximum = { ...imported, slides: Array.from({ length: 20 }, (_, index) => ({ ...imported.slides[0], title: `Slide ${index + 1}` })) };
  await fileInput.setInputFiles({ name: "twenty.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(maximum)) });
  await page.getByRole("button", { name: "Replace draft", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Add slide", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Duplicate slide", exact: true })).toBeDisabled();
  await expect(editor.getByText(/20-slide limit reached/)).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`presentation editor fits a ${viewport.width}px viewport and keeps all fields reachable`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockSlides(page);
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await askForSlides(page);
    const pane = await openSlides(page);
    const editor = await editSlides(page, pane);
    await editor.getByRole("textbox", { name: "Presentation title", exact: true }).fill("Mobile presentation");
    await editor.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("Edited on a narrow screen.");
    await editor.getByRole("textbox", { name: "Source 1 URL", exact: true }).fill("https://example.com/mobile");
    expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await expect(editor.getByRole("button", { name: "Save copy to Assets", exact: true })).toBeInViewport();
    await editor.screenshot({ path: testInfo.outputPath(`presentation-editor-${viewport.width}.png`), animations: "disabled" });
    await editor.getByRole("button", { name: "Save copy to Assets", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(pane.getByText("Mobile presentation", { exact: true })).toBeVisible();
  });
}

test("presentation mode integrates with chat, saved-asset dialogs, and read-only shares", async ({ page }) => {
  test.setTimeout(60000);
  const remote = await mockSlides(page);
  await askForSlides(page);
  await page.getByRole("textbox").last().fill("Keep this chat draft");
  let pane = await openSlides(page);
  await pane.getByRole("button", { name: "Go to slide 4: Compare explanations", exact: true }).click();
  await pane.getByRole("button", { name: "Enter full screen", exact: true }).click();
  await pane.getByRole("button", { name: "Start presentation", exact: true }).click();
  let player = page.getByRole("dialog", { name: `Presentation: ${deck.title}`, exact: true });
  await expect(player).toBeVisible();
  await expect(player.getByTestId("presentation-counter")).toHaveText("4 / 6");
  await player.getByRole("button", { name: "Next slide", exact: true }).click();
  await expect(player.getByTestId("presentation-counter")).toHaveText("5 / 6");
  await page.keyboard.press("Escape");
  await expect(player).toHaveCount(0);
  await expect(pane.getByRole("status", { name: "Slide 5 of 6", exact: true })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Start presentation", exact: true })).toBeFocused();
  await pane.getByRole("button", { name: /^Close(?: presentation)?$/ }).click();
  await expect(page.getByRole("textbox").last()).toHaveValue("Keep this chat draft");
  await expect.poll(() => remote.assets.length).toBe(1);
  remote.assets[0].threadId = undefined;
  await page.goto("/assets");
  pane = await openSlides(page);
  await expect(pane).toHaveAttribute("role", "dialog");
  await pane.getByRole("button", { name: "Go to slide 2: Gather evidence", exact: true }).click();
  await pane.getByRole("button", { name: "Start presentation", exact: true }).click();
  player = page.getByRole("dialog", { name: `Presentation: ${deck.title}`, exact: true });
  await expect(player.getByTestId("presentation-counter")).toHaveText("2 / 6");
  await page.keyboard.press("ArrowRight");
  await player.getByRole("button", { name: "Exit presentation", exact: true }).click();
  await expect(player).toHaveCount(0);
  await expect(pane).toBeVisible();
  await expect(pane.getByRole("status", { name: "Slide 3 of 6", exact: true })).toBeVisible();
  await page.goto("/shared/slides-example");
  pane = await openSlides(page);
  await pane.getByRole("button", { name: "Start presentation", exact: true }).click();
  player = page.getByRole("dialog", { name: `Presentation: ${deck.title}`, exact: true });
  await expect(player.getByTestId("presentation-counter")).toHaveText("1 / 6");
  await player.getByRole("button", { name: "Show notes and sources", exact: true }).click();
  await expect(player.getByRole("link", { name: /Course reading/ })).toHaveAttribute("href", "https://example.com/reading");
  await player.getByRole("button", { name: "Exit presentation", exact: true }).click();
  await expect(pane.getByRole("button", { name: "Edit presentation", exact: true })).toHaveCount(0);
  expect(remote.saves).toHaveLength(0);
  expect(remote.exports).toHaveLength(0);
});

test("presentation editor exits viewport full screen before opening and keeps shared presentations read-only", async ({ page }) => {
  const remote = await mockSlides(page);
  await askForSlides(page);
  let pane = await openSlides(page);
  await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("Fullscreen unavailable in fixture")); });
  await pane.getByRole("button", { name: "Enter full screen", exact: true }).click();
  await expect(pane).toHaveClass(/asset-viewport-fullscreen/);
  const editor = await editSlides(page, pane);
  await expect(page.locator(".asset-viewport-fullscreen")).toHaveCount(0);
  await editor.getByRole("button", { name: "Cancel editing", exact: true }).click();
  await expect(pane.getByRole("button", { name: "Edit presentation", exact: true })).toBeFocused();
  await page.goto("/shared/slides-example");
  pane = await openSlides(page);
  await expect(pane.getByRole("button", { name: "Edit presentation", exact: true })).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "Start presentation", exact: true })).toBeEnabled();
  await expect(pane.getByRole("button", { name: "Download PPTX", exact: true })).toBeDisabled();
  expect(remote.saves).toHaveLength(0);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`compact presentation workspace keeps controls around the slide at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize(viewport);
    const remote = await mockSlides(page);
    if (viewport.width < 768) await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    const presentation: SlideDeck = {
      ...deck,
      slides: Array.from({ length: 11 }, (_, index) => makeSlide("content", `Measurement ${index + 1}`, {
        bullets: ["Record the reading.", "Compare it with the prediction."], speaker_notes: `Notes for measurement ${index + 1}.`,
        sources: [{ title: "Meter reference", url: "https://example.com/meters" }],
      })),
    };
    remote.payload({ type: "slides", slidesId, title: presentation.title, deck: presentation });
    await askForSlides(page);
    const pane = await openSlides(page);
    const header = pane.locator(".slides-pane-header");
    await expect(header.getByRole("button", { name: "Show speaker notes", exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: "Download PPTX", exact: true })).toHaveAttribute("title", "Download PPTX");
    await expect(header.getByRole("button", { name: "More presentation actions", exact: true })).toHaveCount(0);
    await expect(header.getByRole("button", { name: "Copy presentation", exact: true })).toHaveCount(0);
    await expect(pane.getByRole("button", { name: "Previous slide", exact: true })).toHaveCount(0);
    await expect(pane.getByRole("button", { name: "Next slide", exact: true })).toHaveCount(0);
    await pane.getByRole("button", { name: "Go to slide 2: Measurement 2", exact: true }).click();
    await expect(pane.locator(".slides-count")).toHaveText("2 / 11");
    const geometry = await pane.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const header = element.querySelector(".slides-pane-header")!.getBoundingClientRect();
      const canvas = element.querySelector('[data-testid="slide-canvas"]')!.getBoundingClientRect();
      const area = element.querySelector(".slides-canvas-area")!.getBoundingClientRect();
      const strip = element.querySelector(".slides-filmstrip")!.getBoundingClientRect();
      const count = element.querySelector(".slides-count")!.getBoundingClientRect();
      return {
        headerHeight: header.height, bottomGap: bounds.bottom - strip.bottom,
        noReservedArrowSpace: area.width >= bounds.width - 20,
        countInStrip: count.top >= strip.top && count.bottom <= strip.bottom,
        fillsStage: canvas.width >= area.width - 2 || canvas.height >= area.height - 2,
        fits: element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
      };
    });
    expect(geometry.headerHeight).toBeLessThanOrEqual(57);
    expect(geometry.bottomGap).toBeLessThanOrEqual(2);
    expect(geometry).toMatchObject({ noReservedArrowSpace: true, countInStrip: true, fillsStage: true, fits: true });
    await assertCanvasFits(pane);
    await pane.getByRole("button", { name: "Scroll to later slides", exact: true }).click();
    await expect.poll(() => pane.getByRole("navigation", { name: "Choose a slide" }).evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await expect(pane.locator(".slides-count")).toHaveText("2 / 11");
    await pane.getByRole("button", { name: "Scroll to earlier slides", exact: true }).click();
    await header.getByRole("button", { name: "Show speaker notes", exact: true }).click();
    await expect(pane.getByText("Notes for measurement 2.", { exact: true })).toBeVisible();
    await expect(pane.getByRole("link", { name: "Meter reference", exact: false })).toBeVisible();
    await assertCanvasFits(pane);
    await header.getByRole("button", { name: "Hide speaker notes", exact: true }).click();
    await pane.getByTestId("slides-viewer").focus();
    await page.keyboard.press("End");
    await expect(pane.locator(".slides-count")).toHaveText("11 / 11");
    await page.keyboard.press("ArrowRight");
    await expect(pane.locator(".slides-count")).toHaveText("11 / 11");
    await page.keyboard.press("ArrowLeft");
    await expect(pane.locator(".slides-count")).toHaveText("10 / 11");
    await page.keyboard.press("End");
    await expect(pane.getByRole("button", { name: "Go to slide 11: Measurement 11", exact: true })).toBeInViewport();
    await pane.getByRole("button", { name: "Enter full screen", exact: true }).click();
    await expect(pane.getByRole("button", { name: "Exit full screen", exact: true })).toBeVisible();
    await assertCanvasFits(pane);
    await expect(pane.getByRole("button", { name: "Copy presentation", exact: true })).toHaveCount(0);
    await pane.getByRole("button", { name: "Exit full screen", exact: true }).click();
    await pane.screenshot({ path: testInfo.outputPath(`compact-slides-${viewport.width}.png`), animations: "disabled" });
  });
}

test("slides accept the production stream envelope for an eight-slide deck", async ({ page }) => {
  const remote = await mockSlides(page);
  const presentation: SlideDeck = {
    ...deck, title: "Series and parallel circuits",
    slides: [
      ...deck.slides,
      makeSlide("content", "Trace the paths", { bullets: ["Identify each branch.", "Follow a complete current path."] }),
      makeSlide("summary", "Compare your predictions", { bullets: ["Explain the difference between series and parallel."], speaker_notes: "Invite the learner to explain their prediction." }),
    ],
  };
  remote.payload({ type: "slides", slidesId, title: presentation.title, deck: presentation });
  const input = page.getByRole("textbox").last();
  await input.fill("Create an 8-slide presentation on series and parallel circuits, with speaker notes.");
  await input.press("Enter");
  let dialog = await openSlides(page, presentation.title);
  await expect(page.getByText(SLIDES_INVALID_MESSAGE, { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("status", { name: "Slide 1 of 8", exact: true })).toBeVisible();
  await dialog.getByTestId("slides-viewer").focus();
  await page.keyboard.press("End");
  await dialog.getByRole("button", { name: "Show speaker notes" }).click();
  await expect(dialog.getByText(presentation.slides[7].speaker_notes, { exact: true })).toBeVisible();
  await expect.poll(() => [...remote.messages.values()].find(message => message.role === "assistant")?.metadata?.contentBlocks)
    .toEqual([{ type: "slides", slidesId, title: presentation.title, deck: presentation, agentId }]);
  await reloadFromServer(page);
  dialog = await openSlides(page, presentation.title);
  await expect(dialog.getByRole("status", { name: "Slide 1 of 8", exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
  expect(readFileSync((await (await downloaded).path())!)).toEqual(pptx);
  expect(remote.exports[0].body).toEqual({ deck: presentation });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`slides stream previews, exports binary, reloads and opens from assets/shared chat at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const remote = await mockSlides(page);
    if (viewport.width < 768) await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await askForSlides(page);
    await expect(page.getByRole("button", { name: `Open slides: ${deck.title}`, exact: true }).last()).toBeVisible();
    await page.getByRole("textbox").last().fill("Keep my chat draft");
    let dialog = await openSlides(page);
    await expect(page.getByRole("region", { name: "Presentation pane", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: deck.title, exact: true })).toHaveCount(0);
    const actions = dialog.getByRole("group", { name: "Presentation actions", exact: true });
    await expect(actions.getByRole("button", { name: "Download PPTX", exact: true })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Copy presentation", exact: true })).toHaveCount(0);
    await expect.poll(() => dialog.evaluate(element => {
      const pane = element.getBoundingClientRect();
      const main = element.closest("main")!.getBoundingClientRect();
      return window.innerWidth < 768
        ? Math.abs(pane.width - window.innerWidth) < 2 && Math.abs(pane.left) < 2
        : Math.abs(pane.width * 2 - main.width) < 2 && Math.abs(pane.right - main.right) < 2;
    })).toBe(true);
    if (viewport.width >= 768) {
      const input = await page.getByRole("textbox").last().boundingBox();
      const pane = await dialog.boundingBox();
      expect(input!.x + input!.width).toBeLessThanOrEqual(pane!.x + 1);
    }
    await expect(dialog.getByRole("status", { name: "Slide 1 of 6", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Show speaker notes" }).click();
    await expect(dialog.getByText(deck.slides[0].speaker_notes, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Course reading", exact: false })).toHaveAttribute("href", "https://example.com/reading");
    await expect(dialog.getByRole("link", { name: "Course reading", exact: false })).toHaveAttribute("rel", "noopener noreferrer");
    await expect(dialog.getByRole("link", { name: "Printed handbook" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Go to slide 2: Gather evidence", exact: true }).click();
    await expect(dialog.getByText("Section notes stay in their original order.", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Go to slide 3: Use precise observations", exact: true }).click();
    await expect(dialog.getByTestId("slide-canvas").getByText("<script>window.slideUnsafe = true</script>", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { slideUnsafe?: boolean }).slideUnsafe)).toBeUndefined();
    await dialog.getByTestId("slides-viewer").focus();
    await page.keyboard.press("End");
    await expect(dialog.getByRole("status", { name: "Slide 6 of 6", exact: true })).toBeVisible();
    await expect(dialog.getByText(deck.slides[5].speaker_notes, { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("status", { name: "Slide 5 of 6", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Go to slide 4: Compare explanations", exact: true }).click();
    await expect(dialog.getByTestId("slide-canvas").getByRole("heading", { name: "Interpretation" })).toBeVisible();
    await assertCanvasFits(dialog);
    const downloadEvent = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(`${deck.title}.pptx`);
    expect(readFileSync((await download.path())!)).toEqual(pptx);
    expect(remote.exports[0]).toEqual({ agent: agentId, body: { deck }, cookie: "slide-session=mock-authenticated" });
    await dialog.getByRole("button", { name: "Enter full screen", exact: true }).click();
    const viewer = page.getByTestId("slides-viewer");
    await expect.poll(() => viewer.evaluate(element => Math.round(element.closest("[data-fullscreen-surface]")!.getBoundingClientRect().width))).toBe(viewport.width);
    await expect(viewer.getByRole("status", { name: "Slide 4 of 6", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Exit full screen", exact: true }).click();
    await dialog.screenshot({ path: testInfo.outputPath(`slides-${viewport.width}.png`), animations: "disabled" });
    await page.screenshot({ path: testInfo.outputPath(`slides-split-view-${viewport.width}.png`), animations: "disabled" });
    await dialog.getByRole("button", { name: /^Close(?: presentation)?$/ }).click();
    await page.getByRole("textbox").last().press("ArrowLeft");
    await expect(page.getByRole("textbox").last()).toHaveValue("Keep my chat draft");
    await expect(page.getByRole("dialog", { name: deck.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Presentation pane", exact: true })).toHaveCount(0);
    await expect.poll(() => [...remote.messages.values()].some(message => (message.metadata?.contentBlocks as Array<{ type: string; deck?: unknown }>)?.some(block => block.type === "slides"))).toBe(true);
    const saved = [...remote.messages.values()].find(message => message.role === "assistant")!;
    expect(saved.metadata?.contentBlocks).toEqual([{ type: "slides", slidesId, title: deck.title, deck, agentId }]);
    await expect.poll(() => remote.assets.length).toBe(1);
    expect(remote.assets[0]).toMatchObject({ category: "document", type: "json", agentId });
    expect(JSON.parse(remote.assets[0].content)).toEqual(saved.metadata?.contentBlocks && (saved.metadata.contentBlocks as unknown[])[0]);
    await reloadFromServer(page);
    dialog = await openSlides(page);
    await dialog.getByRole("button", { name: "Show speaker notes" }).click();
    await expect(dialog.getByText(deck.slides[0].speaker_notes, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: /^Close(?: presentation)?$/ }).click();
    // Deliberately stale surrounding asset metadata must not replace the deck's saved originating TA.
    remote.assets[0].agentId = "course-Stale";
    await page.goto("/assets");
    dialog = await openSlides(page);
    await dialog.getByRole("button", { name: "Go to slide 6: Make a defensible claim", exact: true }).click();
    await dialog.getByRole("button", { name: "Show speaker notes" }).click();
    await expect(dialog.getByText(deck.slides[5].speaker_notes, { exact: true })).toBeVisible();
    const assetDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
    await assetDownload;
    expect(remote.exports.at(-1)?.agent).toBe(agentId);
    await page.goto("/shared/slides-example");
    dialog = await openSlides(page);
    await expect(page.getByRole("region", { name: "Presentation pane", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: deck.title, exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Download PPTX", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Show speaker notes" }).click();
    await expect(dialog.getByText(deck.slides[0].speaker_notes, { exact: true })).toBeVisible();
    expect(remote.exports).toHaveLength(2);
  });
}

test("slides download reports access and invalid-response failures and allows retry", async ({ page }) => {
  const remote = await mockSlides(page);
  await askForSlides(page);
  const dialog = await openSlides(page);
  remote.exportFailure(403);
  await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Course access is required");
  remote.exportFailure(200, "text/html");
  await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("did not return a PowerPoint file");
  remote.exportFailure(200);
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
  await downloaded;
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("presentation pane omits copy and closes without changing chat", async ({ page }) => {
  await mockSlides(page);
  await askForSlides(page);
  const pane = await openSlides(page);
  await page.getByRole("textbox").last().fill("Keep this question");
  const actions = pane.getByRole("group", { name: "Presentation actions", exact: true });
  await expect(actions.getByRole("button")).toHaveCount(6);
  for (const name of ["Start presentation", "Edit presentation", "Show speaker notes", "Read aloud", "Download PPTX", "Enter full screen"]) {
    await expect(actions.getByRole("button", { name, exact: true })).toBeEnabled();
  }
  await pane.getByRole("button", { name: "Close presentation", exact: true }).click();
  await expect(page.getByRole("region", { name: "Presentation pane", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox").last()).toHaveValue("Keep this question");
});

test("slides malformed streams fail explicitly without blank cards or asset writes", async ({ page }) => {
  const remote = await mockSlides(page);
  const invalid = [
    { ...deck, unexpected: true },
    { ...deck, slides: [{ ...deck.slides[2], bullets: [""] }] },
    { ...deck, slides: [{ ...deck.slides[2], columns: deck.slides[3].columns }] },
    { ...deck, slides: [{ ...deck.slides[0], sources: [{ title: "Unsafe", url: "https://user:password@example.com" }] }] },
    { ...deck, slides: [{ ...deck.slides[0], sources: [{ title: "Unsafe", url: "javascript:alert(1)" }] }] },
  ];
  for (let index = 0; index < invalid.length; index++) {
    remote.payload({ type: "slides", slidesId, title: deck.title, deck: invalid[index] });
    await askForSlides(page);
    await expect(page.getByText(SLIDES_INVALID_MESSAGE, { exact: true })).toHaveCount(index + 1);
    await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
  }
  expect(remote.assets).toHaveLength(0);
  await expect(page.getByTestId("slides-launch-card")).toHaveCount(0);
  await expect.poll(() => [...remote.messages.values()].filter(message => message.role === "assistant").length).toBe(invalid.length);
  await reloadFromServer(page);
  await expect(page.getByText(SLIDES_INVALID_MESSAGE, { exact: true })).toHaveCount(invalid.length);
});

test("slides cancelled tools remove the placeholder and persist the failure", async ({ page }) => {
  const remote = await mockSlides(page);
  remote.cancel();
  await askForSlides(page);
  await expect(page.getByText(SLIDES_INVALID_MESSAGE, { exact: true })).toBeVisible();
  await expect(page.getByText("Creating slide deck…", { exact: true })).toHaveCount(0);
  expect(remote.assets).toHaveLength(0);
});

test("slides preserve the complete deck when the stream closes without a done event", async ({ page }) => {
  const remote = await mockSlides(page);
  remote.endStream(false);
  await askForSlides(page);
  await openSlides(page);
  await expect.poll(() => [...remote.messages.values()].some(message => message.role === "assistant")).toBe(true);
  await reloadFromServer(page);
  const dialog = await openSlides(page);
  await dialog.getByRole("button", { name: "Go to slide 6: Make a defensible claim", exact: true }).click();
  await dialog.getByRole("button", { name: "Show speaker notes" }).click();
  await expect(dialog.getByText(deck.slides[5].speaker_notes, { exact: true })).toBeVisible();
  expect(remote.assets).toHaveLength(1);
});

for (const action of ["stop", "navigate", "reload"] as const) {
  test(`slides completed during a running turn survive ${action} without duplicating or leaking decks`, async ({ page }) => {
    const remote = await mockSlides(page);
    remote.endStream(false);
    await holdStreamOpen(page);
    await askForSlides(page);
    await expect(page.getByRole("button", { name: `Open slides: ${deck.title}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
    await expect.poll(() => remote.assets.length).toBe(1);
    const originThread = remote.assets[0].threadId!;
    if (action === "stop") {
      await page.getByRole("button", { name: "Stop generating", exact: true }).click();
    } else if (action === "navigate") {
      await page.getByRole("button", { name: "New Chat", exact: true }).click();
      await expect(page.getByTestId("slides-launch-card")).toHaveCount(0);
    } else {
      await page.reload();
      await expect(page.getByRole("button", { name: `Open slides: ${deck.title}`, exact: true })).toBeVisible();
    }
    await expect.poll(() => [...remote.messages.values()].filter(message => message.role === "assistant").length).toBe(1);
    const saved = [...remote.messages.values()].find(message => message.role === "assistant")!;
    expect(saved.threadId).toBe(originThread);
    expect((saved.metadata?.contentBlocks as Array<{ type: string; deck: unknown }>).find(block => block.type === "slides")?.deck).toEqual(deck);
    await page.goto(`/chat/Example/${originThread}`);
    const dialog = await openSlides(page);
    await dialog.getByRole("button", { name: "Show speaker notes" }).click();
    await expect(dialog.getByText(deck.slides[0].speaker_notes, { exact: true })).toBeVisible();
    expect(remote.assets).toHaveLength(1);
  });
}

for (const width of [1440, 390]) {
  test(`asset type chips combine saved slide and simulation filters with search at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const remote = await mockSlides(page);
    const makeAsset = (id: string, category: Asset["category"], fields: Partial<Asset> = {}): Asset => ({
      id, userId, category, title: id, type: "markdown", content: "# Example lesson",
      createdAt: "2026-01-01T12:00:00.000Z", updatedAt: "2026-01-01T12:00:00.000Z",
      ...fields,
    });
    remote.assets.push(
      makeAsset("document", "document", { title: "Circuit notes", tags: ["topic:circuits"] }),
      makeAsset("quiz", "quiz", { title: "Practice quiz", description: "Review measurements.", type: "json", content: JSON.stringify({ questions: [] }) }),
      makeAsset("slides", "document", { title: deck.title, type: "json", content: JSON.stringify({ type: "slides", slidesId, title: deck.title, deck, agentId }), tags: ["topic:circuits"] }),
      makeAsset("presentation", "presentation", { title: "Lesson presentation" }),
      makeAsset("challenge", "challenge", { title: "Wiring challenge" }),
      makeAsset("circuit", "diagram", { title: "Circuit simulator", type: "json", content: JSON.stringify({ type: "circuit", circuitId: "example-circuit" }) }),
      makeAsset("trainer", "other", { title: "Motor trainer", type: "json", content: JSON.stringify({ type: "industrial_trainer" }) }),
      makeAsset("simulation", "simulation", { title: "Interactive simulation", type: "html" }),
      makeAsset("code", "code", { title: "Example code", type: "code" }),
      makeAsset("malformed", "document", { title: "Broken payload", type: "json", content: '{"type":' }),
      makeAsset("json-example", "document", { title: "JSON example", content: JSON.stringify({ type: "slides" }) }),
      makeAsset("retired", "flashcard", { title: "Retired flashcards" }),
    );
    const assetRequests: string[] = [];
    page.on("request", request => {
      if (request.method() === "GET" && new URL(request.url()).pathname === "/api/assets") {
        assetRequests.push(request.url());
      }
    });
    await page.goto("/assets");
    const saved = page.getByRole("region", { name: "Saved assets", exact: true });
    const filters = page.getByRole("group", { name: "Filter assets by type", exact: true });
    const search = page.getByRole("searchbox", { name: "Search assets", exact: true });
    const documentFilter = filters.getByRole("button", { name: "Document", exact: true });
    const quizFilter = filters.getByRole("button", { name: "Quiz", exact: true });
    const presentationFilter = filters.getByRole("button", { name: "Presentation", exact: true });
    const allTitles = remote.assets.filter(asset => asset.category !== "flashcard" && asset.id !== "trainer").map(asset => asset.title);
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(allTitles);
    await expect(saved.getByRole("heading", { name: "Motor trainer", exact: true })).toHaveCount(0);
    expect(remote.assets.find(asset => asset.id === "trainer")?.content).toBe(JSON.stringify({ type: "industrial_trainer" }));
    await expect(filters.getByRole("button")).toHaveText(["Document", "Quiz", "Presentation", "Challenge", "Simulation", "Code"]);
    for (const chip of await filters.getByRole("button").all()) {
      await expect(chip).toHaveCSS("border-top-style", "dashed");
      await expect(chip).toHaveAttribute("aria-pressed", "false");
    }
    await expect(page.getByText(/^\d+ assets?$/)).toHaveCount(0);
    const card = saved.getByRole("heading", { name: "Circuit notes", exact: true }).locator("..");
    await expect(card).toHaveJSProperty("tagName", "DIV");
    await expect(card).toHaveCSS("min-height", "140px");
    await expect(card).toHaveCSS("padding", "16px");
    await expect(card.locator("svg")).toHaveCount(0);
    const grid = saved.locator(".grid");
    const columns = await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width === 390 ? 1 : 3);
    const initialRequestCount = assetRequests.length;
    expect(initialRequestCount).toBeGreaterThan(0);
    expect(assetRequests.every(url => !new URL(url).searchParams.has("category"))).toBe(true);

    await documentFilter.focus();
    await page.keyboard.press("Enter");
    await expect(documentFilter).toHaveAttribute("aria-pressed", "true");
    await expect(documentFilter).toHaveCSS("border-top-style", "dashed");
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(["Circuit notes", "Broken payload", "JSON example"]);
    await quizFilter.click();
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(["Circuit notes", "Practice quiz", "Broken payload", "JSON example"]);
    await search.fill("  CIRCUIT  ");
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(["Circuit notes"]);
    await search.fill("measurements");
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(["Practice quiz"]);
    await page.getByRole("search").getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(documentFilter).toHaveAttribute("aria-pressed", "true");
    await documentFilter.locator("svg").click();
    await expect(documentFilter).toHaveAttribute("aria-pressed", "false");
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(["Practice quiz"]);
    await filters.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(allTitles);

    await presentationFilter.click();
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText([deck.title, "Lesson presentation"]);
    await search.fill("  CIRCUITS  ");
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText([deck.title]);
    await page.getByRole("button", { name: `Open slides: ${deck.title}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: deck.title, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Close(?: presentation)?$/ }).click();
    await page.getByRole("search").getByRole("button", { name: "Clear search", exact: true }).click();
    await presentationFilter.click();
    await filters.getByRole("button", { name: "Simulation", exact: true }).click();
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(["Circuit simulator", "Interactive simulation"]);
    await search.fill("missing-topic");
    await expect(saved.getByRole("heading", { name: "No matching assets", exact: true })).toBeVisible();
    await expect(saved).toContainText("in the selected asset types");
    await expect(filters.getByRole("button", { name: "Simulation", exact: true })).toHaveAttribute("aria-pressed", "true");
    await saved.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(allTitles);
    await filters.getByRole("button", { name: "Code", exact: true }).click();
    await expect(saved.getByRole("heading", { level: 3 })).toHaveText(["Example code"]);
    await filters.getByRole("button", { name: "Clear filters", exact: true }).click();
    await documentFilter.click();
    await presentationFilter.click();
    expect(assetRequests).toHaveLength(initialRequestCount);
    await page.screenshot({ path: testInfo.outputPath(`asset-type-chips-${width}.png`), animations: "disabled" });
    const filterWidth = await filters.evaluate(element => ({
      content: element.scrollWidth,
      available: element.clientWidth,
    }));
    expect(filterWidth.content, JSON.stringify(filterWidth)).toBeLessThanOrEqual(filterWidth.available);
  });
}

test("slides malformed saved metadata and assets report failure instead of raw JSON or empty documents", async ({ page }) => {
  const remote = await mockSlides(page);
  await askForSlides(page);
  await expect.poll(() => [...remote.messages.values()].some(message => message.role === "assistant")).toBe(true);
  const badBlock = { type: "slides", slidesId, title: deck.title, deck: { ...deck, theme: "unknown" }, agentId };
  remote.restoreBlock(badBlock);
  remote.assets[0].content = JSON.stringify(badBlock);
  await reloadFromServer(page);
  await expect(page.getByText(SLIDES_INVALID_MESSAGE, { exact: true })).toBeVisible();
  await expect(page.getByTestId("slides-launch-card")).toHaveCount(0);
  await page.goto("/assets");
  await page.getByRole("button", { name: `Open slides: ${deck.title}`, exact: true }).click();
  await expect(page.getByText(SLIDES_INVALID_MESSAGE, { exact: true })).toBeVisible();
  await expect(page.getByTestId("slides-viewer")).toHaveCount(0);
  await page.goto("/shared/slides-example");
  await expect(page.getByText(SLIDES_INVALID_MESSAGE, { exact: true })).toBeVisible();
});

for (const theme of ["academic", "midnight", "warm"] as const) {
  test(`slides largest legal deck keeps all six layouts inside a 16:9 canvas on desktop/mobile (${theme})`, async ({ page }) => {
    const remote = await mockSlides(page);
    const max = (label: string, length: number) => (label + " W").padEnd(length, "W");
    const large: SlideDeck = {
      title: max("Largest deck", 120), subtitle: max("Deck subtitle", 180), theme,
      slides: Array.from({ length: 20 }, (_, index) => {
        const layout = deck.slides[index % 6].layout;
        return makeSlide(layout, max(`${index + 1} ${layout}`, 120), {
          subtitle: max("Subtitle", 180), speaker_notes: max("Notes", 4000),
          bullets: ["content", "question", "summary"].includes(layout) ? Array.from({ length: 5 }, (_, item) => max(`Bullet ${item}`, 160)) : [],
          columns: layout === "two_column" ? Array.from({ length: 2 }, (_, column) => ({ heading: max(`Heading ${column}`, 60), bullets: Array.from({ length: 4 }, (_, item) => max(`Column bullet ${item}`, 140)) })) : [],
          sources: Array.from({ length: 3 }, (_, item) => ({ title: max(`Source ${item}`, 120), url: `https://example.com/${"a".repeat(2028)}` })),
        });
      }),
    };
    expect(parseSlideDeck(large)).not.toBeNull();
    remote.payload({ type: "slides", slidesId, title: large.title, deck: large });
    await askForSlides(page);
    const dialog = await openSlides(page, large.title);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (let index = 0; index < 6; index++) {
        await dialog.getByRole("button", { name: `Go to slide ${index + 1}: ${large.slides[index].title}`, exact: true }).click();
        await expect(dialog.getByTestId("slide-canvas")).toHaveAttribute("data-layout", large.slides[index].layout);
        await assertCanvasFits(dialog);
      }
      await dialog.getByTestId("slides-viewer").focus();
      await page.keyboard.press("End");
      await expect(dialog.getByRole("status", { name: "Slide 20 of 20", exact: true })).toBeVisible();
    }
    await dialog.getByRole("button", { name: "Show speaker notes" }).click();
    await expect(dialog.getByText(large.slides[19].speaker_notes, { exact: true })).toBeVisible();
    await expect(dialog.getByTestId("slide-canvas").getByRole("heading", { name: large.slides[19].title, exact: true })).toBeVisible();
  });
}

test("slides existing-agent enabling requires confirmation and only sends the expected version", async ({ page }) => {
  const remote = await mockSlides(page);
  expect(remote.toolWrites).toHaveLength(0);
  await page.getByTestId("chat-header").getByRole("button", { name: "Example", exact: true }).click();
  const control = page.getByRole("region", { name: "Slide presentation tool", exact: true });
  await expect(control.getByRole("button", { name: "Enable slides", exact: true })).toBeVisible();
  expect(remote.toolWrites).toHaveLength(0);
  await control.getByRole("button", { name: "Enable slides", exact: true }).click();
  await expect(control.getByText(/preserves its other tools and settings/)).toBeVisible();
  expect(remote.toolWrites).toHaveLength(0);
  await control.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(remote.toolWrites).toHaveLength(0);
  await control.getByRole("button", { name: "Enable slides", exact: true }).click();
  await control.getByRole("button", { name: "Confirm enable slides", exact: true }).click();
  await expect(control.getByText("Enabled", { exact: true })).toBeVisible();
  expect(remote.toolWrites).toEqual([{ expected_version: "3" }]);
  expect(remote.unexpectedWrites.filter(path => /\/(circuit\/tool|agents\/.*update|agents\/setup\/save)$/.test(path))).toEqual([]);
});

test("slides tool mutation is not offered to students", async ({ page }) => {
  const remote = await mockSlides(page, "student");
  await page.getByTestId("chat-header").getByRole("button", { name: "Example", exact: true }).click();
  await expect(page.getByRole("region", { name: "Slide presentation tool", exact: true })).toHaveCount(0);
  expect(remote.toolWrites).toHaveLength(0);
});

test("outdated slide tools refresh only after owner confirmation and recheck stale versions", async ({ page }) => {
  await mockSlides(page);
  let version = "7";
  let updated = false;
  const writes: unknown[] = [];
  await page.route("**/api/agents/*/slides/tool", route => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      if (version === "7") {
        version = "8";
        return route.fulfill({ status: 409, json: { detail: "The TA changed. Recheck its slide tool status." } });
      }
      updated = true;
      version = "9";
    }
    return route.fulfill({ json: { enabled: true, agent_version: version, update_available: !updated } });
  });
  await page.getByTestId("chat-header").getByRole("button", { name: "Example", exact: true }).click();
  const control = page.getByRole("region", { name: "Slide presentation tool", exact: true });
  await expect(control.getByRole("button", { name: "Update slides", exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await control.getByRole("button", { name: "Update slides", exact: true }).click();
  await expect(control.getByText(/slide layouts and speaker-note guidance/)).toBeVisible();
  await control.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(writes).toHaveLength(0);
  await control.getByRole("button", { name: "Update slides", exact: true }).click();
  await control.getByRole("button", { name: "Confirm update slides", exact: true }).click();
  await expect(control.getByRole("alert")).toContainText("TA changed");
  expect(writes).toEqual([{ expected_version: "7" }]);
  await control.getByRole("button", { name: "Recheck slide tool", exact: true }).click();
  await control.getByRole("button", { name: "Update slides", exact: true }).click();
  await control.getByRole("button", { name: "Confirm update slides", exact: true }).click();
  await expect(control.getByRole("button", { name: "Update slides", exact: true })).toHaveCount(0);
  await expect(control.getByText("Enabled", { exact: true })).toBeVisible();
  expect(writes).toEqual([{ expected_version: "7" }, { expected_version: "8" }]);
});

test("slides enabling handles stale versions without automatic retries or replacing other tools", async ({ page }) => {
  await mockSlides(page);
  let version = "3";
  const writes: unknown[] = [];
  await page.route("**/api/agents/*/slides/tool", route => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      if (version === "3") {
        version = "4";
        return route.fulfill({ status: 409, json: { detail: "The agent changed. Recheck its version." } });
      }
      return route.fulfill({ json: { enabled: true, agent_version: "5" } });
    }
    return route.fulfill({ json: { enabled: false, agent_version: version } });
  });
  await page.getByTestId("chat-header").getByRole("button", { name: "Example", exact: true }).click();
  const control = page.getByRole("region", { name: "Slide presentation tool", exact: true });
  await control.getByRole("button", { name: "Enable slides", exact: true }).click();
  await control.getByRole("button", { name: "Confirm enable slides", exact: true }).click();
  await expect(control.getByRole("alert")).toContainText("agent changed");
  expect(writes).toEqual([{ expected_version: "3" }]);
  await expect(control.getByRole("button", { name: "Enable slides", exact: true })).toHaveCount(0);
  await control.getByRole("button", { name: "Recheck slide tool", exact: true }).click();
  await control.getByRole("button", { name: "Enable slides", exact: true }).click();
  expect(writes).toHaveLength(1);
  await control.getByRole("button", { name: "Confirm enable slides", exact: true }).click();
  await expect(control.getByText("Enabled", { exact: true })).toBeVisible();
  expect(writes).toEqual([{ expected_version: "3" }, { expected_version: "4" }]);
});

const themeColors = {
  academic: ["#F8FAFC", "#14213D", "#126E82", "#E8F0F5", "#506176"],
  midnight: ["#111827", "#F8FAFC", "#67E8F9", "#1F2937", "#CBD5E1"],
  warm: ["#FFF8ED", "#49311F", "#A94C22", "#F5E9D8", "#785B45"],
} as const;

for (const theme of ["academic", "midnight", "warm"] as const) {
  test(`slides visual review ${theme} shows the full presentation with notes and sources`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1300 });
    const remote = await mockSlides(page);
    const visualDeck: SlideDeck = { ...deck, theme, slides: deck.slides.map((slide, index) => index === 3 ? {
      ...slide,
      speaker_notes: "Ask learners to compare a direct observation with an interpretation. Invite an alternative explanation before advancing.",
      sources: [{ title: "Classroom evidence guide", url: "https://example.com/evidence" }],
    } : slide) };
    remote.payload({ type: "slides", slidesId, title: visualDeck.title, deck: visualDeck });
    await askForSlides(page);
    const dialog = await openSlides(page);
    await dialog.getByRole("button", { name: "Go to slide 4: Compare explanations", exact: true }).click();
    await dialog.getByRole("button", { name: "Show speaker notes", exact: true }).click();
    expect(await dialog.getByTestId("slide-canvas").evaluate(element => {
      const style = getComputedStyle(element);
      return ["--slide-bg", "--slide-ink", "--slide-accent", "--slide-panel", "--slide-muted"].map(name => style.getPropertyValue(name).trim().toUpperCase());
    })).toEqual(themeColors[theme]);

    for (const viewport of [{ width: 1440, height: 1300, label: "desktop" }, { width: 390, height: 1040, label: "mobile" }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.getAnimations().filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().iterations))).map(animation => animation.finished.catch(() => undefined)));
      });
      await assertCanvasFits(dialog);
      await expect(dialog.getByRole("status", { name: "Slide 4 of 6", exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Go to slide 4: Compare explanations", exact: true })).toBeInViewport({ ratio: .99 });
      await expect(dialog.getByText(visualDeck.slides[3].speaker_notes, { exact: true })).toBeInViewport();
      await expect(dialog.getByRole("link", { name: /Classroom evidence guide/ })).toBeInViewport();
      const screenshot = testInfo.outputPath(`slides-${theme}-${viewport.label}.png`);
      await dialog.screenshot({ path: screenshot, animations: "disabled" });
      await testInfo.attach(`${theme}-${viewport.label}`, { path: screenshot, contentType: "image/png" });
    }
    expect(remote.exports).toHaveLength(0);
  });
}

test("slides replacement resets index and title, cancels old exports, and releases every download URL", async ({ page }) => {
  await mockSlides(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests: Array<{ deck: SlideDeck }> = [];
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await page.route("**/api/agents/*/slides/export", async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await pending;
    await route.fulfill({ contentType: PPTX_MIME, body: pptx }).catch(() => undefined);
  });
  await page.evaluate(mime => {
    const urls = { live: [], created: [], revoked: [] } as SlidesBrowserWindow["slidesDownloadUrls"];
    (window as SlidesBrowserWindow).slidesDownloadUrls = urls;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = create(blob);
      if (blob instanceof Blob && blob.type === mime) { urls.live.push(url); urls.created.push(url); }
      return url;
    };
    URL.revokeObjectURL = url => {
      if (urls.created.includes(url)) {
        urls.live = urls.live.filter(value => value !== url);
        urls.revoked.push(url);
      }
      revoke(url);
    };
  }, PPTX_MIME);
  const original: CompleteSlidesBlock = { type: "slides", slidesId, title: "Original preview", deck: { ...deck, title: "Original preview" }, agentId };
  await page.evaluate(async block => {
    const path = "/slides-browser-harness.tsx";
    const { mountSlidesPreview } = await import(path);
    (window as SlidesBrowserWindow).slidesPreview = mountSlidesPreview(block);
  }, original);
  const replace = async (block: CompleteSlidesBlock) => {
    await page.evaluate(async next => {
      (window as SlidesBrowserWindow).slidesPreview.update(next);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, block);
  };
  const urls = () => page.evaluate(() => (window as SlidesBrowserWindow).slidesDownloadUrls);
  try {
    let dialog = await openSlides(page, original.title);
    await dialog.getByTestId("slides-viewer").focus();
    await page.keyboard.press("End");
    await expect(dialog.getByRole("status", { name: "Slide 6 of 6", exact: true })).toBeVisible();
    await replace(structuredClone(original));
    await expect(dialog.getByRole("status", { name: "Slide 6 of 6", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    const replacement: CompleteSlidesBlock = {
      ...original, title: "Updated preview",
      deck: { title: "Updated preview", subtitle: "Replacement lesson", theme: "warm", slides: [
        makeSlide("content", "A new starting point", { bullets: ["Only the new lesson is exported."], speaker_notes: "New speaker notes." }),
      ] },
    };
    await replace(replacement);
    dialog = page.getByRole("dialog", { name: replacement.title, exact: true });
    await expect(dialog.getByRole("status", { name: "Slide 1 of 1", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Previous slide", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Next slide", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Scroll to earlier slides", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Scroll to later slides", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Download PPTX", exact: true })).toBeEnabled();
    await expect(dialog.getByTestId("slide-canvas").getByRole("heading", { name: "A new starting point", exact: true })).toBeVisible();
    release();
    const firstDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
    const firstFile = await firstDownload;
    expect(firstFile.suggestedFilename()).toBe("Updated preview.pptx");
    expect(requests[1]).toEqual({ deck: replacement.deck });
    expect(downloads).toBe(1);
    expect((await urls()).created).toHaveLength(1);
    expect((await urls()).live).toHaveLength(1);

    const renamed = { ...replacement, title: "Renamed preview", deck: { ...replacement.deck, title: "Renamed preview" } };
    await replace(renamed);
    dialog = page.getByRole("dialog", { name: renamed.title, exact: true });
    await expect(dialog.getByRole("status", { name: "Slide 1 of 1", exact: true })).toBeVisible();
    expect((await urls()).live).toHaveLength(0);
    const secondDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
    await secondDownload;
    expect((await urls()).live).toHaveLength(1);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect((await urls()).live).toHaveLength(0);

    dialog = await openSlides(page, renamed.title);
    const thirdDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download PPTX", exact: true }).click();
    await thirdDownload;
    await expect.poll(async () => (await urls()).live.length).toBe(0);
    const finalUrls = await urls();
    expect(finalUrls.created).toHaveLength(3);
    expect(finalUrls.revoked).toEqual(finalUrls.created);
    expect(downloads).toBe(3);
  } finally {
    release();
    await page.evaluate(() => (window as SlidesBrowserWindow).slidesPreview.dispose());
  }
});
