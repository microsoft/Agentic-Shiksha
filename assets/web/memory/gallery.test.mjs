import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "..", "..", "..");
const require = createRequire(join(root, "Agentic Shiksha Platform", "Frontend", "package.json"));
const { chromium } = require("@playwright/test");

test("gallery themes, downloads, keyboard tabs and zoom work without page overflow", { timeout: 120_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  let server;
  try {
    const page = await browser.newPage({ colorScheme: "light" });
    await page.route("**/*", route => new URL(route.request().url()).protocol === "file:" ? route.continue() : route.abort());
    await page.goto(pathToFileURL(join(directory, "index.html")).href);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth === 1600));
    const tabs = page.getByRole("tab");
    assert.equal(await tabs.count(), 3);
    for (const width of [1440, 960, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["Light", "Dark"]) {
        await page.getByRole("button", { name: theme, exact: true }).click();
        await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth === 1600));
        assert.equal(await page.locator("body").getAttribute("data-theme"), theme.toLowerCase());
        for (let index = 0; index < 3; index += 1) {
          await tabs.nth(index).click();
          assert.equal(await tabs.nth(index).getAttribute("aria-selected"), "true");
          assert.equal(await page.getByRole("tabpanel").count(), 1);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          const panel = page.getByRole("tabpanel");
          const image = panel.locator("img");
          assert.equal(await image.evaluate(element => element.complete && element.naturalWidth === 1600), true);
          const suffix = theme === "Dark" ? "-dark" : "";
          const name = await panel.getAttribute("id") + suffix;
          assert((await image.getAttribute("src")).endsWith(`${name}.svg`));
          assert((await panel.getByRole("link", { name: "Open PNG", exact: false }).getAttribute("href")).endsWith(`${name}.png`));
          assert((await panel.getByRole("link", { name: "Open SVG", exact: true }).getAttribute("href")).endsWith(`${name}.svg`));
          assert.equal(await panel.getByRole("alert").count(), 0);
        }
        await page.getByRole("button", { name: "Zoom to actual size", exact: true }).click();
        assert.equal(await page.getByRole("tabpanel").locator(".canvas").evaluate(element => element.scrollWidth > element.clientWidth), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.getByRole("button", { name: "Fit to window", exact: true }).click();
      }
    }
    await tabs.first().click();
    await tabs.first().press("ArrowRight");
    assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
    assert.equal(await tabs.nth(1).evaluate(element => element === document.activeElement), true);
    await tabs.nth(1).press("End");
    assert.equal(await tabs.nth(2).getAttribute("aria-selected"), "true");
    await page.reload();
    assert.equal(await tabs.nth(2).getAttribute("aria-selected"), "true");
    await tabs.nth(2).press("Home");
    assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
    await tabs.first().press("ArrowLeft");
    assert.equal(await tabs.nth(2).getAttribute("aria-selected"), "true");
    await tabs.nth(2).press("ArrowRight");
    assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    const opened = page.waitForEvent("popup");
    await page.getByRole("tabpanel").getByRole("link", { name: "Open PNG", exact: false }).click();
    const imagePage = await opened;
    await imagePage.waitForLoadState();
    assert(imagePage.url().endsWith("01-connected-memory-graphs-dark.png"));
    await imagePage.close();
    server = createServer(async (request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      const resource = resolve(root, ...decodeURIComponent(url.pathname).split("/"));
      const contentType = { ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" }[extname(resource)];
      if (!resource.startsWith(join(root, "assets") + sep) || !contentType) {
        response.writeHead(404).end("Asset not found");
        return;
      }
      try {
        const body = await readFile(resource);
        response.writeHead(200, { "Content-Type": contentType, "Content-Length": body.length }).end(body);
      } catch (error) {
        if (error.code !== "ENOENT") console.error(error);
        response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Asset could not be read");
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.unroute("**/*");
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/assets/web/memory/index.html`);
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("tabpanel").getByRole("link", { name: "Download PNG", exact: false }).click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), "01-connected-memory-graphs-dark.png");
    assert.equal(await download.failure(), null);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    assert.equal(await page.locator("body").getAttribute("data-theme"), "dark");
  } finally {
    await browser.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});

test("README snippets follow the selected theme and clipboard failures remain actionable", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async value => { window.copiedMarkdown = value; },
      } });
    });
    await page.route("**/*", route => new URL(route.request().url()).protocol === "file:" ? route.continue() : route.abort());
    await page.goto(pathToFileURL(join(directory, "index.html")).href);
    const panel = page.getByRole("tabpanel");
    await panel.locator("summary").click();
    const text = panel.getByRole("textbox", { name: "Markdown image link", exact: true });
    const status = panel.getByRole("status");
    assert.match(await text.inputValue(), /assets\/images\/memory\/01-connected-memory-graphs\.svg/);
    await panel.getByRole("button", { name: "Copy Markdown", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".copy-status").textContent === "Markdown copied.");
    assert.equal(await page.evaluate(() => window.copiedMarkdown), await text.inputValue());
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    assert.match(await text.inputValue(), /01-connected-memory-graphs-dark\.svg/);
    assert.equal(await status.textContent(), "");
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => { throw new DOMException("Denied", "NotAllowedError"); };
    });
    await panel.getByRole("button", { name: "Copy Markdown", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".copy-status").textContent.includes("Clipboard unavailable"));
    assert.match(await status.textContent(), /Ctrl\+C or Command\+C/);
    assert.equal(await text.evaluate(element => element.selectionStart === 0 && element.selectionEnd === element.value.length && element === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally {
    await browser.close();
  }
});
