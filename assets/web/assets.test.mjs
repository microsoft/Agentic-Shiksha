import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const imageTypes = new Set([".svg", ".png", ".gif", ".jpg", ".jpeg", ".webp", ".ico"]);

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(filename));
    else if (entry.isFile()) result.push(filename);
  }
  return result;
}

function localLinks(content, markdown = false) {
  const links = [...content.matchAll(/\b(?:href|src|poster)=["']([^"']+)["']/g)].map(match => match[1]);
  if (markdown) {
    links.push(...[...content.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)].map(match => match[1] || match[2]));
  } else {
    links.push(...[...content.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => match[1]));
  }
  return links.filter(link => !/^(?:#|[a-z][a-z\d+.-]*:|\/\/)/i.test(link));
}

async function assertLinks(filename, markdown = false) {
  const content = await readFile(filename, "utf8");
  const failures = [];
  for (const link of localLinks(content, markdown)) {
    const url = new URL(link.replaceAll("&amp;", "&"), pathToFileURL(filename));
    url.hash = "";
    url.search = "";
    try {
      await stat(fileURLToPath(url));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      failures.push(link);
    }
  }
  assert.deepEqual(failures, [], `${relative(root, filename)} has missing local targets`);
}

test("images and web share the assets parent rather than repository-root folders", async () => {
  assert.equal(resolve(root), join(repositoryRoot, "assets"));
  for (const name of ["images", "web"]) {
    assert((await stat(join(root, name))).isDirectory());
    await assert.rejects(stat(join(repositoryRoot, name)), { code: "ENOENT" });
  }
});

test("images contain only image assets, guides and license documents", async () => {
  const mixed = (await files(join(root, "images"))).filter(filename =>
    !imageTypes.has(extname(filename)) && ![".md", ".pdf"].includes(extname(filename)),
  );
  assert.deepEqual(mixed.map(filename => relative(root, filename)), []);
});

test("web pages and supporting files do not duplicate image exports", async () => {
  const misplaced = (await files(join(root, "web"))).filter(filename => imageTypes.has(extname(filename)));
  assert.deepEqual(misplaced.map(filename => relative(root, filename)), []);
});

test("every local gallery image, video, script and download link resolves", async () => {
  const pages = (await files(join(root, "web"))).filter(filename => extname(filename) === ".html");
  assert(pages.length >= 5, "The research, architecture and motion galleries must be present");
  for (const filename of pages) await assertLinks(filename);
});

test("image and web guides link to the reorganized files", async () => {
  const guides = [
    join(repositoryRoot, "README.md"),
    join(repositoryRoot, "CHANGELOG.md"),
    join(repositoryRoot, "Agentic Shiksha Platform", "README.md"),
    ...[
      "README.md", "architecture.md", "agent-dataflow.md", "deployment.md",
      "memory/README.md", "pedagogy/README.md", "pedagogy/ekalaiva.md", "providers.md", "research.md",
    ].map(name => join(repositoryRoot, "docs", ...name.split("/"))),
    ...(await files(join(root, "images"))).filter(filename => extname(filename) === ".md"),
    ...(await files(join(root, "web"))).filter(filename => extname(filename) === ".md"),
  ];
  for (const filename of guides) await assertLinks(filename, true);
});

function assertAtlasImageContent(svg, icons) {
  assert.doesNotMatch(svg, /<(?:foreignObject|script)\b/i, "Atlas artwork must not embed scripts or foreign objects");
  for (const [markup] of svg.matchAll(/<image\b[^>]*>/gi)) {
    const service = markup.match(/\sdata-azure-icon="([^"]+)"/)?.[1];
    assert(service && Object.hasOwn(icons, service), "Atlas images must identify an official service icon");
    assert.equal(markup.match(/\shref="([^"]+)"/)?.[1], icons[service].dataUri,
      "Atlas images must embed the unchanged official SVG, not an external or replacement image");
    assert.match(markup, /\spreserveAspectRatio="xMidYMid meet"/,
      "Atlas service icons must preserve their original proportions");
  }
}

test("GitHub README navigation uses five accessible compact two-tone Shields.io badges", async () => {
  const readmePath = join(repositoryRoot, "README.md");
  const readme = await readFile(readmePath, "utf8");
  assert.match(readme, /^<h1 align="center">Welcome to Agentic Shiksha!<\/h1>\r?$/m);
  const navigation = readme.match(/<p align="center">([\s\S]*?)<\/p>/)?.[1];
  assert(navigation, "The welcome heading must be followed by the centered navigation row");
  assert.doesNotMatch(navigation, /<kbd\b|<style\b|<script\b|\sstyle=/i);
  const badges = [...navigation.matchAll(/<a href="([^"]+)">\s*<img\b([^>]+)>\s*<\/a>/g)]
    .map(([, href, attributes]) => ({
      href,
      src: attributes.match(/\bsrc="([^"]+)"/)?.[1],
      alt: attributes.match(/\balt="([^"]+)"/)?.[1],
      height: attributes.match(/\bheight="([^"]+)"/)?.[1],
    }));
  const expected = [
    ["Get Started", "#getting-started", "github", "033CF2"],
    ["Demos", "#demos", "youtube", "0078B8"],
    ["Documentation", "docs/README.md", "readthedocs", "007F8B"],
    ["Architecture", "docs/architecture.md", "diagramsdotnet", "2451C6"],
    ["EKALAIVA", "docs/pedagogy/ekalaiva.md", "googlescholar", "147A78"],
  ];
  assert.deepEqual(badges.map(({ alt, href, height }) => ({ alt, href, height })),
    expected.map(([alt, href]) => ({ alt, href, height: "20" })));
  for (const [index, badge] of badges.entries()) {
    const [label, , logo, color] = expected[index];
    const url = new URL(badge.src.replaceAll("&amp;", "&"));
    assert.equal(url.origin, "https://img.shields.io");
    assert.equal(url.pathname, `/badge/-${label.replaceAll(" ", "_")}-${color}`);
    assert.equal(url.searchParams.get("style"), "plastic");
    assert.equal(url.searchParams.get("labelColor"), "07183A");
    assert.equal(url.searchParams.get("logoColor"), "22F1EC");
    assert.equal(url.searchParams.get("logo"), logo);
  }
  assert.match(readme, /^## Getting started\r?$/m);
  assert.match(readme, /^## Demos\r?$/m);
  assert(readme.includes("shiksha-research-banner.svg"), "Preserve the existing light banner");
  await assertLinks(readmePath, true);
});

test("Atlas image exceptions reject unrecognized, external and modified icon content", async () => {
  const { azureServiceIcon, azureServiceIcons } = await import("./azure-icons/diagram-icons.mjs");
  const original = azureServiceIcon("foundry", 0, 0, 32);
  assert.doesNotThrow(() => assertAtlasImageContent(original, azureServiceIcons));
  for (const invalid of [
    original.replace('data-azure-icon="foundry"', 'data-azure-icon="unknown"'),
    original.replace('data-azure-icon="foundry"', ""),
    original.replace(/href="[^"]+"/, 'href="https://example.com/replacement.svg"'),
    original.replace(/href="[^"]+"/, 'href="data:image/svg+xml;base64,PHN2Zy8+"'),
    original.replace('preserveAspectRatio="xMidYMid meet"', 'preserveAspectRatio="none"'),
    "<foreignObject></foreignObject>",
    "<script></script>",
  ]) {
    assert.throws(() => assertAtlasImageContent(invalid, azureServiceIcons), assert.AssertionError);
  }
});

test("architecture Atlas uses the full project name, logo palette and unchanged official icons", async () => {
  const { azureServiceIcons } = await import("./azure-icons/diagram-icons.mjs");
  const palette = new Set([
    "#07183A", "#033CF2", "#019BFA", "#22F1EC", "#02B3C3",
    "#CEE7FD", "#F0F6FB", "#FFFFFF", "white", "none",
  ]);
  const diagrams = (await files(join(root, "images", "architecture"))).filter(filename => extname(filename) === ".svg");
  assert.equal(diagrams.length, 6, "Five architecture views and one overview");
  for (const filename of diagrams) {
    const svg = await readFile(filename, "utf8");
    for (const [, color] of svg.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)) {
      assert(palette.has(color), `${relative(root, filename)} has off-palette colour ${color}`);
    }
    assertAtlasImageContent(svg, azureServiceIcons);
    const labels = [...svg.matchAll(/<(?:text|title|desc)\b[^>]*>(.*?)<\/(?:text|title|desc)>/gs)]
      .map(([, value]) => value).join(" ");
    assert.match(labels, /Agentic Shiksha/i);
    assert.doesNotMatch(labels.replace(/Agentic\s+Shiksha/gi, ""), /\bShiksha\b/i);
    assert.match(svg, /stroke-dasharray=/, "Atlas keeps dashed grouping boundaries");
  }
  const html = await readFile(join(root, "web", "architecture", "index.html"), "utf8");
  assert.match(html, /<title>Agentic Shiksha Architecture Atlas<\/title>/);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const [color] of css.matchAll(/#[\da-f]{6}\b/gi)) {
    assert(palette.has(color.toUpperCase()), `Gallery has off-palette colour ${color}`);
  }
});

test("Atlas text retains accessible contrast in the logo palette", () => {
  const luminance = hex => {
    const components = hex.slice(1).match(/../g).map(value => {
      const channel = Number.parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
  };
  for (const [foreground, background] of [
    ["#FFFFFF", "#033CF2"], ["#07183A", "#CEE7FD"],
    ["#07183A", "#F0F6FB"], ["#033CF2", "#FFFFFF"],
  ]) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    assert((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${foreground} on ${background} must meet 4.5:1`);
  }
});

test("research manifest paths and generated-file hashes remain valid", async () => {
  const manifestUrl = new URL("./research/manifest.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  assert.equal(manifest.regenerationCommand, String.raw`node assets\web\research\generate.mjs --png`);
  for (const record of manifest.generatedFiles) {
    const bytes = await readFile(new URL(record.file, manifestUrl));
    assert.equal(bytes.length, record.bytes, `${record.file} byte length`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), record.sha256, `${record.file} hash`);
  }
});

test("moved artwork modules load the original image assets", async () => {
  const { azureServiceIcons } = await import("./azure-icons/diagram-icons.mjs");
  for (const icon of Object.values(azureServiceIcons)) {
    const original = await readFile(join(root, "images", "azure-icons", icon.filename));
    assert.deepEqual(Buffer.from(icon.dataUri.split(",")[1], "base64"), original);
  }
  const { assets } = await import("./research/artwork.mjs");
  assert(assets.length > 0, "Research artwork definitions must be available");
  for (const asset of assets) assert.match(asset.draw(), /<svg\b/, `${asset.id} must render SVG`);
});
