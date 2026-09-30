import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMemoryFigures, MEMORY_PALETTES } from "./artwork.mjs";

const figures = createMemoryFigures();

test("all graph views use compact canvases and real, typed endpoints", () => {
  assert.equal(figures.length, 3);
  for (const figure of figures) {
    assert.equal(figure.width, 1600);
    assert(figure.height <= 1220);
    assert.equal(new Set(figure.nodes.map(node => node.id)).size, figure.nodes.length);
    assert.doesNotMatch(figure.svg, /<foreignObject|<script\b/);
    for (const edge of figure.edges) {
      assert(figure.nodes.some(node => node.id === edge.source));
      assert(figure.nodes.some(node => node.id === edge.target));
      assert.match(edge.type, /^[A-Z][A-Z_]+$/);
    }
    const fonts = [...figure.svg.matchAll(/font-size="(\d+)"/g)].map(match => Number(match[1]));
    assert(Math.min(...fonts) >= 17, "No microscopic export text");
    assert(Math.max(...fonts) >= 32, "Clear type hierarchy");
    assert(figure.alt.length >= 100, "A meaningful standalone image description");
    assert.doesNotMatch(figure.alt, /\.\./);
  }
});

test("a shared misconception has two parents, not two duplicate nodes", () => {
  for (const figure of figures.slice(0, 2)) {
    assert.equal(figure.nodes.filter(node => node.id === "MC3").length, 1);
    assert.deepEqual(figure.edges.filter(edge => edge.target === "MC3" && edge.type === "HAS_COMMON_MISCONCEPTION").map(edge => edge.source).sort(), ["TC1", "TC2"]);
    assert(figure.edges.some(edge => edge.source === "TC1" && edge.target === "TC2" && edge.type === "PREREQUISITE_OF"));
  }
});

test("the overview preserves definition bindings and ownership despite edge bundling", () => {
  const overview = figures[0];
  assert.deepEqual(overview.edges.filter(edge => edge.type === "INSTANCE_OF").map(({ source, target }) => [source, target]), [["CS1", "TC1"], ["CS2", "TC2"], ["MS3", "MC3"]]);
  assert(overview.edges.some(edge => edge.source === "L1" && edge.target === "MS3" && edge.type === "HAS_MISCONCEPTION_STATE"));
  assert(overview.edges.filter(edge => edge.type === "INSTANCE_OF").every(edge => edge.bundled));
});

test("the evidence view keeps sources, interpretations, state and agent hypotheses separate", () => {
  const evidence = figures[2];
  const type = id => evidence.nodes.find(node => node.id === id).type;
  assert.equal(type("E12"), "Evidence");
  assert.equal(type("O12"), "Observation");
  assert.equal(type("MS3"), "MisconceptionState");
  assert.equal(type("I1"), "Insight");
  assert(evidence.edges.some(edge => edge.source === "O12" && edge.target === "MS3" && edge.type === "SUPPORTS"));
  assert(evidence.edges.some(edge => edge.source === "O19" && edge.target === "MS3" && edge.type === "CONTRADICTS"));
  assert.deepEqual(evidence.edges.filter(edge => edge.source === "I1").map(edge => edge.target).sort(), ["E12", "E19", "E26"]);
  assert(evidence.edges.filter(edge => edge.source === "IA").every(edge => ["READS", "GENERATED_INSIGHT"].includes(edge.type)));
  assert(!evidence.edges.some(edge => edge.source === "IA" && type(edge.target) === "Evidence"));
  assert.match(evidence.svg, /PROPOSED \/ READ-ONLY/);
});

test("light and dark figures have identical graph meaning and layout", () => {
  const dark = createMemoryFigures("dark");
  const geometry = figure => figure.nodes.map(({ id, type, x, y, width, height }) => ({ id, type, x, y, width, height }));
  for (const [index, figure] of figures.entries()) {
    assert.equal(dark[index].id, figure.id);
    assert.equal(dark[index].alt, figure.alt);
    assert.equal(dark[index].width, figure.width);
    assert.equal(dark[index].height, figure.height);
    assert.deepEqual(geometry(dark[index]), geometry(figure));
    assert.deepEqual(dark[index].edges, figure.edges);
    assert.notEqual(dark[index].svg, figure.svg);
  }
  assert.equal(figures.filter(figure => figure.recommended).length, 1);
  assert.equal(figures[0].recommended, true);
  assert.throws(() => createMemoryFigures("unknown"), /Unknown memory figure theme/);
});

test("both themes keep text contrast at least 4.5 to 1", () => {
  const luminance = hex => {
    const values = hex.slice(1).match(/../g).map(value => {
      const channel = Number.parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  for (const [theme, colors] of Object.entries(MEMORY_PALETTES)) {
    for (const [foreground, background] of [
      ["ink", "canvas"], ["muted", "canvas"], ["muted", "panel"],
      ["blue", "blueLight"], ["teal", "tealLight"], ["amber", "amberLight"],
      ["violet", "violetLight"], ["onAccent", "accent"],
    ]) {
      const [bright, dark] = [luminance(colors[foreground]), luminance(colors[background])].sort((a, b) => b - a);
      assert((bright + 0.05) / (dark + 0.05) >= 4.5, `${theme}: ${foreground} on ${background}`);
    }
  }
});

test("committed SVG and 2x PNG exports match the editable source", () => {
  for (const figure of [...figures, ...createMemoryFigures("dark")]) {
    const name = `${figure.id}${figure.theme === "dark" ? "-dark" : ""}`;
    const svg = readFileSync(new URL(`../../images/memory/${name}.svg`, import.meta.url), "utf8");
    const png = readFileSync(new URL(`../../images/memory/${name}.png`, import.meta.url));
    assert.equal(svg.trim(), figure.svg);
    assert.doesNotMatch(svg, /<script\b|<foreignObject|<image\b|@import|@font-face|\shref=/i);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), figure.width * 2);
    assert.equal(png.readUInt32BE(20), figure.height * 2);
  }
});

test("project and memory READMEs embed both overview themes", () => {
  for (const relative of ["../../../README.md", "../../../docs/memory/README.md"]) {
    const readme = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(readme, /<picture>/);
    assert.match(readme, /prefers-color-scheme: dark/);
    assert.match(readme, /01-connected-memory-graphs-dark\.svg/);
    assert.match(readme, /01-connected-memory-graphs\.svg/);
  }
});

test("memory gallery and README image links resolve without a web server", () => {
  for (const relative of ["./index.html", "../../images/memory/README.md", "../../../README.md", "../../../docs/memory/README.md"]) {
    const url = new URL(relative, import.meta.url);
    const content = readFileSync(url, "utf8");
    const links = [...content.matchAll(/\b(?:href|src|srcset)=["']([^"']+)["']/g)].map(match => match[1]);
    if (relative.endsWith(".md")) {
      links.push(...[...content.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)].map(match => match[1] || match[2]));
    }
    for (const link of links) {
      if (/^(?:#|[a-z][a-z\d+.-]*:|\/\/)/i.test(link)) continue;
      const target = new URL(link, url);
      target.hash = "";
      target.search = "";
      assert.doesNotThrow(() => statSync(fileURLToPath(target)), `${relative}: ${link}`);
    }
  }
});
