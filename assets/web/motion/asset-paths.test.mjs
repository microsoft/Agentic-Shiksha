import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { test } from "node:test";
import { assetPath, assetUrl, imageDir } from "./asset-paths.mjs";
import "./scenes.js";

const here = dirname(fileURLToPath(import.meta.url));
const imageExtensions = [".png", ".svg", ".gif", ".jpg", ".jpeg", ".webp", ".avif",
  ".ico", ".bmp", ".tif", ".tiff", ".apng", ".heic", ".heif", ".jxl"];
const isImage = (filename) => imageExtensions.includes(extname(filename).toLowerCase());

test("motion images and web assets resolve to separate flat directories", () => {
  for (const extension of [...imageExtensions, ".SVG"]) {
    const filename = `example${extension}`;
    assert.equal(assetPath(filename), join(imageDir, filename));
    assert.equal(assetUrl(filename), `../../images/motion/${filename}`);
    assert.equal(fileURLToPath(new URL(assetUrl(filename), pathToFileURL(join(here, "index.html")))),
      assetPath(filename));
  }
  for (const extension of [".html", ".js", ".mjs", ".json", ".mp4", ".vtt", ".zip"]) {
    const filename = `example${extension}`;
    assert.equal(assetPath(filename), join(here, filename));
    assert.equal(assetUrl(filename), filename);
  }
  for (const filename of ["", ".", "..", "../example.png", "nested/example.mp4"]) {
    assert.throws(() => assetPath(filename), /single basename/);
    assert.throws(() => assetUrl(filename), /single basename/);
  }
});

test("published motion folders do not mix images with web files", async () => {
  const images = await readdir(imageDir, { withFileTypes: true });
  assert(images.length > 0);
  for (const image of images) {
    assert(image.isFile() && isImage(image.name), `Non-image under images/motion: ${image.name}`);
  }
  for (const entry of await readdir(here, { withFileTypes: true })) {
    assert(!entry.isFile() || !isImage(entry.name), `Image under web/motion: ${entry.name}`);
  }
});

async function checkGalleryAssets(html, filename) {
  const base = pathToFileURL(join(here, filename));
  let images = 0;
  for (const [, attribute, value] of html.matchAll(/\b(src|href|poster)="([^"]+)"/g)) {
    if (/^(?:data:|https?:|#)/.test(value)) continue;
    const url = new URL(value, base);
    const target = fileURLToPath(url);
    const extension = extname(target).toLowerCase();
    if (isImage(target)) {
      images++;
      assert.match(value, /^\.\.\/\.\.\/images\/(?:motion|research|architecture|azure-icons)\//,
        `${filename} ${attribute} must point to an image directory: ${value}`);
    } else if ([".mp4", ".vtt", ".json", ".zip"].includes(extension)) {
      assert.equal(dirname(target), here, `${filename} must keep ${value} local`);
    } else if (![".js", ".mjs"].includes(extension)) {
      continue;
    }
    assert((await stat(target)).size > 0, `${filename} links to an empty asset: ${value}`);
  }
  assert(images > 0, `${filename} must retain image previews/downloads`);
  for (const [, attributes, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\bsrc=/.test(attributes)) new Script(code, { filename });
  }
  assert(!html.includes("npm --prefix images\\motion"), "Gallery commands must use web\\motion");
  assert(!html.includes("node images\\motion\\"), "Gallery commands must use web\\motion");
}

test("existing pages retain valid image, video, caption, script and ZIP paths", async () => {
  for (const filename of ["index.html", "architecture.html", "demos.html"]) {
    await checkGalleryAssets(await readFile(join(here, filename), "utf8"), filename);
  }
});

test("repository READMEs resolve nested paths and provide GitHub-compatible animated demos", async () => {
  const root = resolve(here, "..", "..", "..");
  const rootReadme = await readFile(join(root, "README.md"), "utf8");
  for (const section of ["The teaching approach", "Demos", "How it works", "Learner memory",
    "Getting started", "Research status", "Repository guide", "Contributing",
    "Repository automation", "Citation", "License"]) {
    assert(rootReadme.includes(`## ${section}`), `Missing merged section: ${section}`);
  }
  assert(rootReadme.includes("[.github/workflows/](.github/workflows/)"));
  assert(rootReadme.includes("[.github/dependabot.yml](.github/dependabot.yml)"));
  assert(!/<(?:video|iframe)\b/i.test(rootReadme), "GitHub README must not depend on unsupported video HTML");
  const base = pathToFileURL(join(root, "README.md"));
  const targets = [
    ...Array.from(rootReadme.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g), match => match[1] || match[2]),
    ...Array.from(rootReadme.matchAll(/\b(?:href|src|srcset)="([^"]+)"/g), match => match[1]),
  ];
  for (const target of targets) {
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const url = new URL(target, base);
    url.search = "";
    url.hash = "";
    assert((await stat(fileURLToPath(url))).isFile() || (await stat(fileURLToPath(url))).isDirectory(),
      `README.md has a broken local link: ${target}`);
  }
  for (const name of ["shiksha-course-setup-tutorial", "shiksha-chat-tutorial"]) {
    assert.match(rootReadme, new RegExp(`!\\[[^\\]]+\\]\\(assets/images/motion/${name}\\.gif\\)`));
    assert(rootReadme.includes(`assets/web/motion/${name}.mp4?raw=1`),
      "MP4 links must serve the file rather than GitHub's unsupported binary preview");
    const gif = await readFile(assetPath(`${name}.gif`));
    assert.equal(gif.subarray(0, 6).toString("ascii"), "GIF89a");
    assert(gif.includes(Buffer.from("NETSCAPE2.0")), "README preview must be an animated looping GIF");
    assert((await stat(assetPath(`${name}.mp4`))).size > 0);
  }
});

test("architecture manifest references the unchanged image files", async () => {
  const manifest = JSON.parse(await readFile(join(here, "architecture-manifest.json"), "utf8"));
  assert.equal(manifest.gifs.length, 5);
  for (const entry of manifest.gifs) {
    assert.match(entry.file, /^\.\.\/\.\.\/images\/motion\/[^/]+\.gif$/);
    const bytes = await readFile(fileURLToPath(new URL(entry.file, pathToFileURL(join(here, "architecture-manifest.json")))));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  }
});

test("motion source references resolve from the shared assets parent", async () => {
  const manifest = JSON.parse(await readFile(join(here, "architecture-manifest.json"), "utf8"));
  const entries = [...Object.values(globalThis.ShikshaMotion.scenes), ...manifest.gifs];
  for (const entry of entries) {
    for (const [label, target] of entry.sources || []) {
      const filename = fileURLToPath(new URL(target, pathToFileURL(join(here, "architecture.html"))));
      assert((await stat(filename)).isFile(), `Missing repository source for ${label}: ${target}`);
    }
  }
});

test("tutorial metadata, dimensions and repository-relative source mapping are preserved", async () => {
  const catalog = JSON.parse(await readFile(join(here, "tutorials.json"), "utf8"));
  assert.equal(catalog.count, catalog.tutorials.length);
  assert(catalog.count > 0);
  for (const tutorial of catalog.tutorials) {
    const metadata = JSON.parse(await readFile(assetPath(`${tutorial.name}.json`), "utf8"));
    assert.equal(metadata.name, tutorial.name);
    assert.deepEqual(metadata.chapters, tutorial.chapters);
    assert.equal(metadata.duration, tutorial.duration);
    assert((await stat(resolve(here, "..", "..", "..", metadata.source))).isDirectory());
    const png = await readFile(assetPath(`${tutorial.name}.png`));
    const gif = await readFile(assetPath(`${tutorial.name}.gif`));
    assert.equal(png.readUInt32BE(16), metadata.width);
    assert.equal(png.readUInt32BE(20), metadata.height);
    assert.equal(gif.readUInt16LE(6), metadata.width);
    assert.equal(gif.readUInt16LE(8), metadata.height);
    for (const extension of ["mp4", "vtt"]) {
      assert((await stat(assetPath(`${tutorial.name}.${extension}`))).size > 0);
    }
  }
});

test("gallery generators read separated assets and publish only web outputs", async () => {
  const source = await readFile(join(here, "generate.mjs"), "utf8");
  const start = source.indexOf("const tutorialDefinitions = [");
  const end = source.indexOf("\nfunction encode(");
  assert(start > 0 && end > start, "Gallery-generation section must remain identifiable");
  const generated = new Map();
  const originals = await readFile(join(here, "index.html"), "utf8");
  const iconDataScript = originals.match(/<script id="azure-service-icons">[\s\S]*?<\/script>/)?.[0];
  assert(iconDataScript);
  const globals = {
    assert, createHash, readFile, join, here, assetPath, assetUrl, iconDataScript,
    architectureEntries: Object.entries(globalThis.ShikshaMotion.scenes).filter(([, spec]) => spec.file),
    allOutputs: [],
    writeFile: async (filename, content) => {
      assert.equal(dirname(filename), here, `Generated web file escaped web/motion: ${filename}`);
      assert([".html", ".json"].includes(extname(filename)));
      generated.set(filename, content);
    },
  };
  // Exercise the actual publishing functions with writes captured in memory, never re-rendering artwork.
  const factories = new Function(...Object.keys(globals),
    `${source.slice(start, end)}\nreturn { publishArchitectureGallery, publishTutorialCollection };`);
  const generators = factories(...Object.values(globals));
  await generators.publishArchitectureGallery();
  const tutorials = await generators.publishTutorialCollection();
  assert.equal(generated.size, 4);
  for (const filename of ["index.html", "architecture.html", "demos.html"]) {
    await checkGalleryAssets(generated.get(join(here, filename)), filename);
  }
  assert.equal(JSON.parse(generated.get(join(here, "tutorials.json"))).count, tutorials.length);
});

test("relocated script imports, recorder dependencies and fixture font resolve locally", async () => {
  for (const entry of await readdir(here)) {
    if (!/\.(?:mjs|js)$/.test(entry)) continue;
    const source = await readFile(join(here, entry), "utf8");
    for (const [, target] of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.{1,2}\/[^"'`\r\n]+)["']/g)) {
      assert((await stat(fileURLToPath(new URL(target, pathToFileURL(join(here, entry)))))).isFile(),
        `Unresolved module import in ${entry}: ${target}`);
    }
  }
  const recorder = await import("./record-platform.mjs");
  assert.equal(typeof recorder.Recorder, "function");
  assert.equal(typeof recorder.createHelpers, "function");
  assert((await stat(join(here, "node_modules", "@fontsource-variable", "sora", "files",
    "sora-latin-wght-normal.woff2"))).size > 0);
});

test("image-generation recording verifies native preview, retained image and synthetic provenance", async () => {
  const metadata = JSON.parse(await readFile(assetPath("shiksha-image-generation-tutorial.json"), "utf8"));
  const evidence = metadata.verification;
  assert.equal(metadata.demoId, "image-generation");
  assert.equal(metadata.presentation.configuredCourseStarters, 4);
  assert(metadata.presentation.verifiedWelcomeScreens > 0);
  assert(metadata.presentation.assetChecks.some(check => check.event === "generated_image_start"));
  assert(metadata.presentation.assetChecks.some(check => check.event === "generated_image"));
  assert(metadata.presentation.assetChecks.every(check => check.navigationCollapsed));
  assert.equal(evidence.feature, "image-generation");
  assert.equal(evidence.tool, "generate_image");
  for (const key of ["nativeUI", "placeholderVerified", "previewVerified",
    "navigationCollapsedBeforeImage", "sameConversationFollowup", "imageInSyncedHistory"]) {
    assert.equal(evidence[key], true, `${key} must be exercised by the real-interface recipe`);
  }
  assert.equal(evidence.realModelCalls, 0);
  assert.match(evidence.image.source, /not live model output/);
  const fixture = await readFile(assetPath("shiksha-image-generation-example.png"));
  assert.equal(fixture.readUInt32BE(16), 1536);
  assert.equal(fixture.readUInt32BE(20), 1024);
  assert.equal(createHash("sha256").update(fixture).digest("hex"), evidence.image.sha256);
  assert.equal(metadata.chapters.length, 6);
  const captions = await readFile(assetPath("shiksha-image-generation-tutorial.vtt"), "utf8");
  assert(captions.startsWith("WEBVTT\n"));
  for (const chapter of metadata.chapters) assert(captions.includes(chapter.caption));
});
