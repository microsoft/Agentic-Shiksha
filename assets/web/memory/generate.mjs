import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryFigures } from "./artwork.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "..", "..", "..");
const images = join(root, "assets", "images", "memory");
const require = createRequire(join(root, "Agentic Shiksha Platform", "Frontend", "package.json"));
const { chromium } = require("@playwright/test");
const figures = createMemoryFigures();
const variants = [...figures, ...createMemoryFigures("dark")];
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]);

await mkdir(images, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.route("**/*", route => route.abort());
  for (const figure of variants) {
    assert(!/<foreignObject|<script\b/i.test(figure.svg));
    for (const edge of figure.edges) {
      assert(figure.nodes.some(node => node.id === edge.source), `Missing source ${edge.source}`);
      assert(figure.nodes.some(node => node.id === edge.target), `Missing target ${edge.target}`);
    }
    await page.setViewportSize({ width: figure.width, height: figure.height });
    await page.setContent(`<html><head><style>html,body{margin:0}svg{display:block}</style></head><body>${figure.svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const errors = await page.evaluate(() => {
      const root = document.querySelector("body > svg");
      const bounds = root.getBoundingClientRect();
      const errors = [];
      const overlaps = (a, b, margin = 2) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > margin
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > margin;
      for (const text of root.querySelectorAll("text")) {
        const box = text.getBoundingClientRect();
        if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom) errors.push(`Clipped: ${text.textContent}`);
      }
      const texts = [...root.querySelectorAll("text")].map(text => ({ text: text.textContent, box: text.getBoundingClientRect() }));
      for (let a = 0; a < texts.length; a += 1) {
        for (let b = a + 1; b < texts.length; b += 1) {
          if (overlaps(texts[a].box, texts[b].box)) errors.push(`Overlapping text: ${texts[a].text}, ${texts[b].text}`);
        }
      }
      const nodes = [...root.querySelectorAll("[data-node]")].map(node => ({
        id: node.dataset.node, box: node.querySelector("[data-body]").getBoundingClientRect(),
      }));
      for (const node of root.querySelectorAll("[data-node]")) {
        if (node.dataset.type === "MisconceptionDefinition") continue;
        const shape = node.querySelector("[data-body]").getBoundingClientRect();
        for (const text of node.querySelectorAll("text")) {
          const box = text.getBoundingClientRect();
          if (box.left < shape.left - 2 || box.right > shape.right + 2 || box.top < shape.top - 2 || box.bottom > shape.bottom + 2) errors.push(`Text outside node ${node.dataset.node}: ${text.textContent}`);
        }
      }
      for (let a = 0; a < nodes.length; a += 1) {
        for (let b = a + 1; b < nodes.length; b += 1) {
          if (overlaps(nodes[a].box, nodes[b].box)) errors.push(`Overlapping nodes: ${nodes[a].id}, ${nodes[b].id}`);
        }
      }
      const labels = [...root.querySelectorAll("[data-edge-label]")].map(label => ({ text: label.textContent, box: label.getBoundingClientRect() }));
      for (const label of labels) {
        for (const node of nodes) if (overlaps(label.box, node.box)) errors.push(`Edge label covers ${node.id}: ${label.text}`);
      }
      for (let a = 0; a < labels.length; a += 1) {
        for (let b = a + 1; b < labels.length; b += 1) {
          if (overlaps(labels[a].box, labels[b].box)) errors.push(`Overlapping edge labels: ${labels[a].text}, ${labels[b].text}`);
        }
      }
      return errors;
    });
    assert.deepEqual(errors, [], `${figure.id} (${figure.theme}): visual layout validation`);
    const name = `${figure.id}${figure.theme === "dark" ? "-dark" : ""}`;
    await writeFile(join(images, `${name}.svg`), figure.svg + "\n");
    await page.locator("body > svg").screenshot({ path: join(images, `${name}.png`), animations: "disabled" });
    if (figure.theme === "light") {
      const mermaid = `%% Semantic companion to the composed SVG illustration; not its visual layout.\nflowchart TB\n${figure.nodes.map(node => `  ${node.id}["${[node.code, ...(node.lines || [])].join("<br/>").replaceAll('"', "'")}"]`).join("\n")}\n${figure.edges.map(edge => `  ${edge.source} -->|${edge.type}| ${edge.target}`).join("\n")}\n`;
      await writeFile(join(directory, `${figure.id}.mmd`), mermaid);
    }
    console.log(`${name}: ${figure.nodes.length} nodes, PNG ${figure.width * 2} x ${figure.height * 2}`);
  }
} finally {
  await browser.close();
}

const names = ["Two connected graphs", "Shared misconceptions", "Evidence and insights"];
const controls = figures.map((figure, index) => `<button type="button" role="tab" id="tab-${index}" aria-label="${names[index]}" aria-controls="${figure.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-index="${index}"><span>0${index + 1}</span>${names[index]}</button>`).join("");
const panels = figures.map((figure, index) => `<section role="tabpanel" aria-labelledby="tab-${index}" id="${figure.id}"${index ? " hidden" : ""}>
<div class="figure-heading"><div>${figure.recommended ? '<span class="badge">Recommended for READMEs</span>' : `<span class="badge detail">Detail view 0${index + 1}</span>`}<h2>${escape(figure.title)}</h2><p>${escape(figure.subtitle)}</p></div><div class="downloads"><a class="primary" data-export="png" href="../../images/memory/${figure.id}.png" download>Download PNG <span>2&times;</span></a><a data-export="svg" href="../../images/memory/${figure.id}.svg" download>Download SVG</a></div></div>
<div class="canvas" id="canvas-${index}" tabindex="0" aria-label="${escape(names[index])} image; scroll when zoomed"><a data-export="svg" href="../../images/memory/${figure.id}.svg" target="_blank" rel="noopener noreferrer" aria-label="Open full-size ${escape(names[index].toLowerCase())}"><img src="../../images/memory/${figure.id}.svg" width="${figure.width}" height="${figure.height}" alt="${escape(figure.alt)}"/></a></div>
<p class="image-error" role="alert" hidden>The image could not be loaded. Regenerate the memory artwork or check that the image files are present.</p>
<div class="caption"><p>${escape(figure.note)}</p><span>PNG ${figure.width * 2} &times; ${figure.height * 2} &nbsp; / &nbsp; Editable SVG</span></div>
<details class="reuse"><summary>Use this image in a README</summary><div class="reuse-content"><p>This snippet is relative to the repository root. Adjust the path for another folder. <a href="../../images/memory/README.md#use-in-a-readme">Examples and automatic dark mode</a></p><label for="embed-${index}">Markdown image link</label><textarea id="embed-${index}" rows="3" readonly spellcheck="false">${escape(`[![${figure.alt}](assets/images/memory/${figure.id}.svg)](docs/memory/overview.md)`)}</textarea><div class="copy-row"><button type="button" class="copy">Copy Markdown</button><p role="status" aria-live="polite" class="copy-status"></p><a href="${figure.id}.mmd">Mermaid source</a></div></div></details>
</section>`).join("\n");
await writeFile(join(directory, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Agentic Shiksha - Memory Graph Images</title>
<style>
*{box-sizing:border-box}body{--bg:#F0F4FA;--surface:#FFFFFF;--soft:#F5F8FE;--ink:#132440;--muted:#536580;--line:#D6E1F0;--blue:#2454C6;--tint:#EDF3FF;--accent:#2454C6;margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 Arial,Helvetica,sans-serif;color-scheme:light}
body[data-theme=dark]{--bg:#091221;--surface:#0B1426;--soft:#101D32;--ink:#E5EDF9;--muted:#A5B6CC;--line:#354A67;--blue:#A7C1FF;--tint:#1C3154;color-scheme:dark}
main{max-width:1680px;margin:auto;padding:40px 32px}a{color:var(--blue);text-underline-offset:4px}button,a,summary{touch-action:manipulation}
button:focus-visible,a:focus-visible,summary:focus-visible,textarea:focus-visible,.canvas:focus-visible{outline:3px solid var(--blue);outline-offset:4px}button{font:inherit;cursor:pointer}button:disabled{cursor:wait;opacity:.65}
header{display:flex;justify-content:space-between;gap:32px;align-items:end;margin-bottom:32px}header p{margin:10px 0 0;color:var(--muted);max-width:720px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:2px;color:var(--blue)}h1{font-size:clamp(30px,3.3vw,46px);letter-spacing:-1.5px;margin:10px 0;line-height:1.12}.header-links{display:flex;gap:18px;font-size:14px;flex-wrap:wrap;padding-bottom:5px}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px}[role=tablist]{display:flex;gap:6px;flex-wrap:wrap}
[role=tab]{border:1px solid transparent;background:transparent;color:var(--muted);padding:12px 16px;border-radius:10px;font-size:14px;font-weight:600;min-height:44px}[role=tab] span{margin-right:10px;font-size:12px}
[role=tab][aria-selected=true]{color:var(--ink);background:var(--surface);border-color:var(--line);box-shadow:0 2px 6px #07183A08}[role=tab][aria-selected=true] span{color:var(--blue)}
.view-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.appearance{display:flex;gap:3px;padding:3px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.appearance button{border:0;background:transparent;color:var(--muted);border-radius:7px;padding:8px 13px;min-height:36px;font-size:13px}.appearance button[aria-pressed=true]{background:var(--tint);color:var(--blue);font-weight:700}
.zoom,.copy{border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);padding:10px 14px;font-size:13px;min-height:44px;white-space:nowrap}
section{background:var(--surface);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 10px 36px #07183A05}[hidden]{display:none!important}
.figure-heading{display:flex;justify-content:space-between;gap:24px;align-items:center;padding:24px 28px;border-bottom:1px solid var(--line)}.badge{display:inline-block;padding:4px 9px;border-radius:6px;background:var(--tint);color:var(--blue);font-size:11px;font-weight:700;letter-spacing:.3px;margin-bottom:10px}.badge.detail{background:var(--soft);color:var(--muted)}
h2{font-size:22px;letter-spacing:-.4px;margin:0 0 5px}p{margin:0}.figure-heading p{color:var(--muted);font-size:14px}.downloads{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}
.downloads a{border:1px solid var(--line);border-radius:9px;padding:11px 14px;text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap}.downloads a span{font-weight:400;margin-left:5px}.downloads .primary{background:var(--accent);color:#FFFFFF;border-color:var(--accent)}
.canvas{overflow:auto}.canvas img{display:block;width:100%;height:auto}.canvas.actual img{width:1600px;max-width:none}.caption{display:flex;gap:20px;justify-content:space-between;padding:16px 28px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.caption>span{flex-shrink:0}
.reuse{border-top:1px solid var(--line);background:var(--soft)}.reuse summary{padding:17px 28px;font-size:14px;font-weight:700;cursor:pointer}.reuse-content{padding:0 28px 22px}.reuse-content>p{font-size:13px;color:var(--muted);margin-bottom:14px}.reuse label{display:block;font-size:12px;font-weight:700;margin-bottom:7px}
textarea{display:block;width:100%;resize:vertical;min-height:100px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:12px/1.6 Consolas,monospace;padding:12px}.copy-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px}.copy-row p{flex:1;min-width:160px;font-size:13px;color:var(--muted)}.copy-row a{font-size:12px}.image-error{padding:18px 28px;color:var(--ink)}
footer{margin:24px 0 0;color:var(--muted);font-size:13px;max-width:1120px}footer strong{color:var(--ink)}
@media(max-width:1000px){header,.figure-heading{display:block}.header-links{margin-top:18px}.downloads{margin-top:16px}.caption{flex-direction:column;gap:6px}}
@media(max-width:600px){main{padding:24px 14px}h1{letter-spacing:-1px}.toolbar{align-items:stretch}[role=tablist]{display:grid;grid-template-columns:1fr;width:100%}[role=tab]{text-align:left;padding:10px 13px}.view-controls{justify-content:space-between;width:100%;gap:8px}.figure-heading{padding:20px}.caption{padding:14px 20px}.reuse summary{padding:16px 20px}.reuse-content{padding:0 20px 20px}.copy-row{gap:10px}.downloads a{padding:10px 12px}}
</style></head><body data-theme="light"><main>
<header><div><p class="eyebrow">AGENTIC SHIKSHA / DIAGRAM LIBRARY</p><h1>Learner memory, connected.</h1><p>Shared knowledge, personal understanding, traceable evidence. Three original figures, ready for your README, paper, or presentation.</p></div><nav class="header-links" aria-label="Related documentation"><a href="../architecture/index.html">Architecture Atlas</a><a href="../../../docs/memory/overview.md">Memory model</a></nav></header>
<div class="toolbar"><div role="tablist" aria-label="Memory graph views">${controls}</div><div class="view-controls"><div class="appearance" role="group" aria-label="Figure appearance"><button type="button" data-theme-choice="light" aria-pressed="true">Light</button><button type="button" data-theme-choice="dark" aria-pressed="false">Dark</button></div><button type="button" class="zoom" aria-pressed="false" aria-controls="canvas-0">Zoom to actual size</button></div></div>
${panels}
<footer><strong>Conceptual diagrams, synthetic examples.</strong> Not live learner records or evidence of learning outcomes. Graph memory is optional and off by default. The Insights Agent in view 03 is proposed and read-only. State-to-state associations visualize shared curriculum mappings; they are not new stored relationship types. <a href="../../images/memory/README.md">Image guide and reproduction</a></footer>
</main><script>
const tabs = [...document.querySelectorAll('[role="tab"]')];
const panels = [...document.querySelectorAll('[role="tabpanel"]')];
const zoom = document.querySelector('.zoom');
const appearance = [...document.querySelectorAll('[data-theme-choice]')];
const localFiles = location.protocol === 'file:';
function select(index, focus) {
  tabs.forEach((tab, position) => { const active = position === index; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; panels[position].hidden = !active; });
  zoom.setAttribute('aria-controls', panels[index].querySelector('.canvas').id);
  if (focus) tabs[index].focus();
  history.replaceState(null, '', '#' + panels[index].id);
}
function setAppearance(theme) {
  document.body.dataset.theme = theme;
  appearance.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
  panels.forEach(panel => {
    const name = panel.id + (theme === 'dark' ? '-dark' : '');
    const image = panel.querySelector('img');
    image.src = '../../images/memory/' + name + '.svg';
    panel.querySelectorAll('[data-export]').forEach(link => { link.href = '../../images/memory/' + name + '.' + link.dataset.export; });
    panel.querySelector('textarea').value = '[![' + image.alt + '](assets/images/memory/' + name + '.svg)](docs/memory/overview.md)';
    panel.querySelector('.copy-status').textContent = '';
  });
}
tabs.forEach((tab, index) => { tab.addEventListener('click', () => select(index, false)); tab.addEventListener('keydown', event => {
  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
  if (next !== null) { event.preventDefault(); select(next, true); }
}); });
appearance.forEach(button => button.addEventListener('click', () => setAppearance(button.dataset.themeChoice)));
zoom.addEventListener('click', () => { const active = zoom.getAttribute('aria-pressed') !== 'true'; zoom.setAttribute('aria-pressed', String(active)); zoom.textContent = active ? 'Fit to window' : 'Zoom to actual size'; document.querySelectorAll('.canvas').forEach(canvas => canvas.classList.toggle('actual', active)); });
panels.forEach(panel => {
  panel.querySelectorAll('.downloads [data-export]').forEach(link => {
    if (localFiles) {
      link.removeAttribute('download');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    link.textContent = (localFiles ? 'Open ' : 'Download ') + link.dataset.export.toUpperCase();
    if (link.dataset.export === 'png') {
      const scale = document.createElement('span');
      scale.textContent = ' 2x';
      link.append(scale);
    }
  });
  const image = panel.querySelector('img');
  image.addEventListener('error', () => { panel.querySelector('.image-error').hidden = false; });
  image.addEventListener('load', () => { panel.querySelector('.image-error').hidden = true; });
  panel.querySelector('.copy').addEventListener('click', async event => {
    const button = event.currentTarget;
    const text = panel.querySelector('textarea');
    const status = panel.querySelector('.copy-status');
    button.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text.value);
      status.textContent = 'Markdown copied.';
    } catch {
      text.focus();
      text.select();
      status.textContent = 'Clipboard unavailable. Markdown selected; press Ctrl+C or Command+C to copy.';
    } finally { button.disabled = false; }
  });
});
function restoreHash() {
  const index = panels.findIndex(panel => '#' + panel.id === location.hash);
  if (index >= 0) select(index, false);
}
setAppearance(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
restoreHash();
window.addEventListener('hashchange', restoreHash);
</script></body></html>\n`);
console.log("Rendered three light/dark SVG and 2x PNG figures, Mermaid sources, and the README-ready gallery.");
