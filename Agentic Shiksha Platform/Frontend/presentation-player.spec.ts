import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Slide, SlideDeck, SlideLayout } from "./src/lib/slides";

const makeSlide = (layout: SlideLayout, title: string, extra: Partial<Slide> = {}): Slide => ({
  layout, title, subtitle: "", bullets: [], columns: [], speaker_notes: "", sources: [], ...extra,
});
const deck: SlideDeck = {
  title: "A classroom presentation", subtitle: "Evidence and explanation", theme: "academic",
  slides: [
    makeSlide("title", "Start with a question", {
      subtitle: "What does the evidence tell us?",
      speaker_notes: "Opening notes\nInvite every learner to contribute. <img src=x onerror=alert(1)>",
      sources: [
        { title: "Course reading", url: "https://example.com/reading" },
        { title: "Printed handbook", url: null },
        { title: "Unsafe source", url: "javascript:alert(1)" },
      ],
    }),
    makeSlide("section", "Gather evidence"),
    makeSlide("content", "Use precise observations", { bullets: ["Describe what changed.", "<script>window.slideUnsafe = true</script>", "Separate evidence from opinion."] }),
    makeSlide("two_column", "Compare explanations", { columns: [
      { heading: "Observation", bullets: ["A directly measured change.", "Repeat the measurement."] },
      { heading: "Interpretation", bullets: ["A proposed reason.", "Test an alternative."] },
    ] }),
    makeSlide("question", "What would change your mind?", { bullets: ["Which evidence challenges your first explanation?"] }),
    makeSlide("summary", "Make a defensible claim", { bullets: ["State the claim.", "Link it to evidence.", "Describe uncertainty."] }),
  ],
};

async function mount(page: Page, options: { initialIndex?: number; nested?: boolean; deck?: SlideDeck; previewFullscreen?: "native" | "fallback" } = {}) {
  const unexpectedRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || (url.protocol.startsWith("http") && !["127.0.0.1", "localhost"].includes(url.hostname))) unexpectedRequests.push(request.url());
  });
  await page.route("**/presentation-player-fixture", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Presentation fixture</title></head><body><script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script></body></html>`,
  }));
  await page.goto("/presentation-player-fixture");
  await page.evaluate(async ({ deck, initialIndex, nested }) => {
    const path = "/presentation-player-browser-harness.tsx";
    const { mountPresentationPlayer } = await import(path);
    mountPresentationPlayer(deck, { initialIndex, nested });
  }, { deck: options.deck || deck, initialIndex: options.initialIndex, nested: options.nested });
  if (options.nested) await page.getByRole("button", { name: "Open slide preview", exact: true }).click();
  if (options.previewFullscreen) {
    if (options.previewFullscreen === "fallback") {
      await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new DOMException("Fullscreen is unavailable.", "NotAllowedError")); });
    }
    await page.getByRole("button", { name: "Enter full screen", exact: true }).click();
    if (options.previewFullscreen === "fallback") await expect(page.locator("[data-fullscreen-surface]")).toHaveClass(/asset-viewport-fullscreen/);
    else await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  }
  await page.getByRole("button", { name: "Start presentation", exact: true }).click();
  const player = page.getByRole("dialog", { name: `Presentation: ${(options.deck || deck).title}`, exact: true });
  await expect(player).toBeVisible();
  await expect(player).toHaveAccessibleDescription(/Use arrow keys, Page Up, Page Down, or Space/);
  await expect(player.getByTestId("presentation-stage")).toBeFocused();
  return { player, unexpectedRequests };
}

async function expectPosition(player: Locator, position: number) {
  await expect(player.getByTestId("presentation-counter")).toHaveText(`${position} / ${deck.slides.length}`);
  await expect(player.getByRole("progressbar", { name: "Presentation progress" })).toHaveAttribute("aria-valuenow", String(position));
}

async function expectViewportFit(player: Locator) {
  const bounds = await player.evaluate(element => {
    const frame = element.getBoundingClientRect();
    const canvas = element.querySelector("[data-testid=slide-canvas]")!.getBoundingClientRect();
    const stage = element.querySelector("[data-testid=presentation-stage]")!.getBoundingClientRect();
    const controls = [...element.querySelectorAll("button")].map(button => button.getBoundingClientRect());
    return {
      x: frame.x, y: frame.y, width: frame.width, height: frame.height,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      aspect: canvas.width / canvas.height,
      fits: canvas.x >= stage.x - 1 && canvas.right <= stage.right + 1 && canvas.y >= stage.y - 1 && canvas.bottom <= stage.bottom + 1,
      controlsFit: controls.every(button => button.x >= 0 && button.right <= window.innerWidth + 1 && button.y >= 0 && button.bottom <= window.innerHeight + 1),
      horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect(bounds.x).toBeCloseTo(0, 0);
  expect(bounds.y).toBeCloseTo(0, 0);
  expect(bounds.width).toBeCloseTo(bounds.viewportWidth, 0);
  expect(bounds.height).toBeCloseTo(bounds.viewportHeight, 0);
  expect(bounds.aspect).toBeCloseTo(16 / 9, 2);
  expect(bounds.fits).toBe(true);
  expect(bounds.controlsFit).toBe(true);
  expect(bounds.horizontalOverflow).toBe(false);
}

async function swipe(target: Locator, x: number, y = 0) {
  const box = (await target.boundingBox())!;
  const start = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: box.x + box.width / 2 - x / 2, clientY: box.y + box.height / 2 - y / 2 };
  await target.dispatchEvent("pointerdown", start);
  await target.dispatchEvent("pointerup", { ...start, clientX: start.clientX + x, clientY: start.clientY + y });
}

test("presentation starts at the selected slide, fills the viewport, and retains its exit position", async ({ page }) => {
  const { player, unexpectedRequests } = await mount(page, { initialIndex: 2 });
  const stage = player.getByTestId("presentation-stage");
  await expectPosition(player, 3);
  await expectViewportFit(player);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  for (const [key, position] of [["ArrowRight", 4], ["PageDown", 5], ["PageUp", 4], ["ArrowLeft", 3], [" ", 4], ["Shift+Space", 3], ["ArrowDown", 4], ["ArrowUp", 3]] as const) {
    await stage.press(key);
    await expectPosition(player, position);
  }
  await stage.press("Home");
  await expectPosition(player, 1);
  await expect(player.getByRole("button", { name: "Previous slide", exact: true })).toBeDisabled();
  await stage.press("ArrowLeft");
  await expectPosition(player, 1);
  await stage.press("End");
  await expectPosition(player, 6);
  await expect(player.getByRole("button", { name: "Next slide", exact: true })).toBeDisabled();
  await stage.press("ArrowRight");
  await expectPosition(player, 6);
  await player.getByRole("button", { name: "Previous slide", exact: true }).click();
  await expectPosition(player, 5);
  await expect(page.getByTestId("preview-key-events")).toHaveText("0");
  await page.keyboard.press("Escape");
  await expect(player).toHaveCount(0);
  await expect(page.getByTestId("preview-position")).toHaveText("5");
  await expect(page.getByTestId("presentation-exits")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Start presentation", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("preview-key-events")).toHaveText("1");
  await page.getByRole("button", { name: "Outside control: 0", exact: true }).click();
  await expect(page.getByRole("button", { name: "Outside control: 1", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked", "1");
  expect(unexpectedRequests).toEqual([]);
});

test("nested presentation isolates shortcuts and Escape, restores focus, and leaves no lingering dialog", async ({ page }) => {
  const descriptionWarnings: string[] = [];
  page.on("console", message => {
    if (message.text().includes("Missing `Description`")) descriptionWarnings.push(message.text());
  });
  const { player } = await mount(page, { initialIndex: 4, nested: true });
  await expect(player.getByTestId("presentation-stage")).toHaveAccessibleDescription(/Use arrow keys, Page Up, Page Down, or Space/);
  await player.getByRole("button", { name: "Next slide", exact: true }).click();
  await expectPosition(player, 6);
  await page.keyboard.press("Tab");
  expect(await player.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await player.getByRole("button", { name: "Exit presentation", exact: true }).click();
  const outer = page.getByTestId("outer-preview-dialog");
  await expect(outer).toBeVisible();
  await expect(page.getByTestId("preview-position")).toHaveText("6");
  await expect(outer.getByRole("button", { name: "Start presentation", exact: true })).toBeFocused();
  await outer.getByRole("button", { name: "Start presentation", exact: true }).click();
  await expectPosition(player, 6);
  await player.getByTestId("presentation-stage").press("Home");
  await expectPosition(player, 1);
  await page.keyboard.press("Escape");
  await expect(player).toHaveCount(0);
  await expect(outer).toBeVisible();
  await expect(page.getByTestId("preview-position")).toHaveText("1");
  await expect(page.getByTestId("presentation-exits")).toHaveText("2");
  await expect(page.getByTestId("preview-key-events")).toHaveText("0");
  await expect(outer.getByRole("button", { name: "Start presentation", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open slide preview", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Outside control: 0", exact: true }).click();
  await expect(page.getByRole("button", { name: "Outside control: 1", exact: true })).toBeVisible();
  expect(descriptionWarnings).toEqual([]);
});

test("notes and sources are opt-in, safe text, and hidden while the screen is blanked", async ({ page }) => {
  const { player, unexpectedRequests } = await mount(page);
  const notes = player.getByRole("complementary", { name: "Speaker notes and sources", includeHidden: true });
  await expect(notes).toBeHidden();
  await player.getByRole("button", { name: "Show notes and sources", exact: true }).click();
  await expect(notes).toBeVisible();
  await expect(notes.getByText("Notes are visible on this screen.", { exact: true })).toBeVisible();
  await expect(notes).toContainText(deck.slides[0].speaker_notes);
  await expect(notes.locator("img, script")).toHaveCount(0);
  await expect(notes.getByRole("link")).toHaveCount(1);
  await expect(notes.getByRole("link", { name: "Course reading (opens in a new tab)", exact: true })).toHaveAttribute("href", "https://example.com/reading");
  await expect(notes.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
  await expect(notes.getByText("Printed handbook", { exact: true })).toBeVisible();
  await expect(notes.getByText("Unsafe source", { exact: true })).toBeVisible();
  await player.getByRole("button", { name: "Next slide", exact: true }).click();
  await expect(notes).toContainText("No speaker notes for this slide.");
  await expect(notes).toContainText("No sources for this slide.");
  await player.getByRole("button", { name: "Previous slide", exact: true }).click();
  await player.getByTestId("presentation-stage").press("b");
  await expect(player.getByTestId("slide-canvas")).toBeHidden();
  await expect(notes).toBeHidden();
  await expect(player.getByRole("button", { name: "Show slide", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(player.getByRole("status")).toContainText("Screen blanked");
  await player.getByTestId("presentation-stage").press("B");
  await expectPosition(player, 1);
  await expect(player.getByTestId("slide-canvas")).toBeVisible();
  await expect(notes).toBeVisible();
  await player.getByRole("button", { name: "Hide notes and sources", exact: true }).click();
  await expect(notes).toBeHidden();
  await player.getByRole("button", { name: "Blank screen", exact: true }).click();
  await player.getByRole("button", { name: "Show slide", exact: true }).click();
  await expectPosition(player, 1);
  await player.getByRole("button", { name: "Exit presentation", exact: true }).click();
  await page.getByRole("button", { name: "Start presentation", exact: true }).click();
  await expect(notes).toBeHidden();
  expect(unexpectedRequests).toEqual([]);
});

test("shortcuts ignore editable fields and preserve native Space activation on controls", async ({ page }) => {
  const { player } = await mount(page, { initialIndex: 2, nested: true });
  await player.evaluate(element => {
    const input = document.createElement("textarea");
    input.setAttribute("aria-label", "Presentation test editor");
    element.append(input);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "");
    editable.setAttribute("role", "textbox");
    editable.setAttribute("aria-label", "Editable presentation text");
    element.append(editable);
  });
  for (const name of ["Presentation test editor", "Editable presentation text"]) {
    const input = player.getByRole("textbox", { name, exact: true });
    await input.fill("Editable text");
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End", "PageDown", "PageUp", " ", "b"]) await input.press(key);
    await expectPosition(player, 3);
    await expect(player.getByTestId("slide-canvas")).toBeVisible();
  }
  await player.getByRole("button", { name: "Next slide", exact: true }).press("Space");
  await expectPosition(player, 4);
  await player.getByRole("button", { name: "Blank screen", exact: true }).press("Space");
  await expect(player.getByTestId("slide-canvas")).toBeHidden();
  await player.getByRole("button", { name: "Show slide", exact: true }).press("Space");
  await expectPosition(player, 4);
  await expect(page.getByTestId("preview-key-events")).toHaveText("0");
});

test("elapsed time never auto-advances slides and is reset when a new presentation starts", async ({ page }) => {
  await page.clock.install();
  const { player } = await mount(page, { initialIndex: 3 });
  await expect(player.getByRole("timer")).toHaveText("00:00");
  await page.clock.fastForward(65_000);
  await expect(player.getByRole("timer")).toHaveText("01:05");
  await expectPosition(player, 4);
  await player.getByRole("button", { name: "Exit presentation", exact: true }).click();
  await page.getByRole("button", { name: "Start presentation", exact: true }).click();
  await expect(player.getByRole("timer")).toHaveText("00:00");
  await expectPosition(player, 4);
});

for (const theme of ["academic", "midnight", "warm"] as const) {
  test(`presentation preserves all six layouts in the ${theme} theme`, async ({ page }) => {
    const { player } = await mount(page, { deck: { ...deck, theme } });
    for (const [index, slide] of deck.slides.entries()) {
      const canvas = player.getByTestId("slide-canvas");
      await expect(canvas).toHaveAttribute("data-layout", slide.layout);
      await expect(canvas).toHaveClass(new RegExp(`slides-theme-${theme}`));
      await expect(canvas.getByRole("heading", { name: slide.title, exact: true })).toBeVisible();
      await expectViewportFit(player);
      const overflow = await canvas.locator(".slides-fit-content").evaluate(element => ({
        horizontal: element.scrollWidth > element.parentElement!.clientWidth + 1,
        vertical: element.scrollHeight > element.parentElement!.clientHeight + 1,
      }));
      expect(overflow).toEqual({ horizontal: false, vertical: false });
      if (index < deck.slides.length - 1) await player.getByRole("button", { name: "Next slide", exact: true }).click();
    }
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`presentation fits ${viewport.width}x${viewport.height}, supports swipes, and preserves notes scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const longNotes = { ...deck, slides: [{ ...deck.slides[0], speaker_notes: "A long note for the presenter.\n".repeat(100) }, ...deck.slides.slice(1)] };
    const { player } = await mount(page, { deck: longNotes, nested: true });
    const stage = player.getByTestId("presentation-stage");
    await expectViewportFit(player);
    await swipe(stage, -140);
    await expectPosition(player, 2);
    await swipe(stage, 140);
    await expectPosition(player, 1);
    await swipe(stage, 15, 120);
    await expectPosition(player, 1);
    await swipe(player.getByRole("button", { name: "Next slide", exact: true }), -140);
    await expectPosition(player, 1);
    await player.getByRole("button", { name: "Show notes and sources", exact: true }).click();
    await expectViewportFit(player);
    const notes = player.getByRole("complementary", { name: "Speaker notes and sources" });
    await swipe(notes, -140);
    await expectPosition(player, 1);
    await notes.focus();
    await page.keyboard.press("PageDown");
    await expect.poll(() => notes.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expectPosition(player, 1);
    await player.getByRole("button", { name: "Exit presentation", exact: true }).click();
    await expect(player).toHaveCount(0);
    await expect(page.getByTestId("outer-preview-dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start presentation", exact: true })).toBeFocused();
  });
}

test("out-of-range initial positions are clamped safely", async ({ page }) => {
  const { player } = await mount(page, { initialIndex: 100 });
  await expectPosition(player, 6);
  await player.getByRole("button", { name: "Exit presentation", exact: true }).click();
  await expect(page.getByTestId("preview-position")).toHaveText("6");
});

test("presentation remains above a preview when native fullscreen is denied", async ({ page }) => {
  const { player } = await mount(page, { initialIndex: 2, previewFullscreen: "fallback" });
  await expectViewportFit(player);
  await player.getByRole("button", { name: "Next slide", exact: true }).click();
  await expectPosition(player, 4);
  await player.getByRole("button", { name: "Exit presentation", exact: true }).click();
  await expect(page.getByTestId("preview-position")).toHaveText("4");
  await expect(page.getByRole("button", { name: "Start presentation", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Exit full screen", exact: true }).click();
  await expect(page.locator("[data-fullscreen-surface]")).not.toHaveClass(/asset-viewport-fullscreen/);
});

test("presentation opened in native fullscreen stays visible and exits cleanly with that surface", async ({ page }) => {
  const { player } = await mount(page, { initialIndex: 1, nested: true, previewFullscreen: "native" });
  await expectViewportFit(player);
  expect(await player.evaluate(element => !!document.fullscreenElement?.contains(element))).toBe(true);
  await player.getByRole("button", { name: "Next slide", exact: true }).click();
  await expectPosition(player, 3);
  await page.evaluate(() => document.exitFullscreen());
  await expect(player).toHaveCount(0);
  await expect(page.getByTestId("outer-preview-dialog")).toBeVisible();
  await expect(page.getByTestId("preview-position")).toHaveText("3");
  await expect(page.getByTestId("presentation-exits")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Start presentation", exact: true })).toBeFocused();
});
