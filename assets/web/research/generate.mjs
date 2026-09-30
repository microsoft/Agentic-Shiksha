import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assets, contactSheet, esc, FONT, SNAPSHOT } from "./artwork.mjs";
import { azureServiceIcons } from "../azure-icons/diagram-icons.mjs";

const output = dirname(fileURLToPath(import.meta.url));
const root = resolve(output, "..", "..", "..");
const imageOutput = join(root, "assets", "images", "research");
const raster = process.argv.includes("--png");
assert(process.argv.slice(2).every((arg) => arg === "--png"), "Usage: node assets\\web\\research\\generate.mjs [--png]");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const sourcePath = (path) => join(root, ...path.split("/"));
const sourceHref = (path) => `../../../${path.split("/").map(encodeURIComponent).join("/")}`;
const imageHref = (name) => `../../images/research/${name}`;
const outputPath = (name) => {
  assert(!/[\\/]/.test(name) && !name.startsWith("."), `Output must be a research asset filename: ${name}`);
  return join(/\.(?:svg|png)$/.test(name) || name === "README.md" ? imageOutput : output, name);
};

const serviceIconPlacements = {
  "01-course-creation": {
    "Blob material storage": ["blob"],
    "Common material search index": ["search"],
    "Named Foundry agent": ["foundry"],
    "Application and curriculum records": ["cosmos", "blob"],
  },
  "03-platform-topology": {
    "Microsoft Foundry service": ["foundry"],
    "Azure AI Search service": ["search"],
    "Cosmos application and graph documents": ["cosmos"],
    "Blob materials and artifacts": ["blob"],
  },
};
const usedServiceIcons = [...new Set(Object.values(serviceIconPlacements).flatMap((nodes) => Object.values(nodes).flat()))];

const B = "Agentic Shiksha Platform/Backend/";
const sourceFacts = [
  ["Course Companion operates on the draft", "Agentic Shiksha Platform/Frontend/src/features/create/FormAssistant.tsx", /Applied to the draft/],
  ["Creation uses a named agent reference", `${B}utils/course_creation.py`, /"type": "agent_reference"/],
  ["Specification is schema validated", `${B}utils/course_creation.py`, /CourseSpecification\.model_validate_json/],
  ["Creation binds the shared Search index", `${B}utils/course_creation.py`, /search_index_name=COMMON_INDEX_NAME/],
  ["Material worker stays in main backend lifespan", `${B}backend/routers/course_materials.py`, /asyncio\.create_task\(material_jobs\.run_worker/],
  ["Curriculum worker stays in main backend lifespan", `${B}backend/routers/course_materials.py`, /asyncio\.create_task\(run_curriculum_worker/],
  ["Material readiness verifies indexed files", `${B}utils/material_jobs.py`, /expected <= indexed/],
  ["Common material pipeline is implemented", `${B}azure_services/tools/search/course_index_manager.py`, /def ensure_common_index_pipeline/],
  ["Layout skill is source-backed", `${B}azure_services/tools/search/course_index_manager.py`, /DocumentIntelligenceLayoutSkill/],
  ["Embedding skill is source-backed", `${B}azure_services/tools/search/course_index_manager.py`, /AzureOpenAIEmbeddingSkill/],
  ["Course retrieval combines scoped filters", `${B}utils/course_materials.py`, /session_filter\(session_uuid\)/],
  ["Graph memory is disabled by default", `${B}learner_memory/settings.py`, /enabled: bool = False/],
  ["Graph worker is independently disabled by default", `${B}learner_memory/settings.py`, /worker_enabled: bool = False/],
  ["Observations are validated before use", `${B}learner_memory/processor.py`, /validate_observation_set\(extracted, evidence, graph\)/],
  ["State uses a deterministic reducer", `${B}learner_memory/processor.py`, /snapshot = reduce_learner_state/],
  ["Learner publication is a single repository batch", `${B}learner_memory/processor.py`, /self\.repository\.batch\("learner", scope\.partition_key, operations\)/],
  ["Profile is a projection", `${B}learner_memory/profile.py`, /LearningProfile/],
  ["Runtime uses named Foundry references", `${B}harness/runtime.py`, /"type": "agent_reference"/],
  ["Runtime uses conversations", `${B}harness/runtime.py`, /conversations\.create/],
  ["Runtime dispatches local tools", `${B}harness/runtime.py`, /def _dispatch_tool_call/],
  ["Admin UI distinguishes dashboard and main API origins", "Admin-Dashboard/frontend/src/lib/config.ts", /DASHBOARD_API_URL[\s\S]+API_BASE_URL/],
  ["Admin API directly constructs a Cosmos client", "Admin-Dashboard/backend/cosmos_queries.py", /CosmosClient\(/],
  ["Publication is distinct from activation", "docs/memory/overview.md", /Publication and activation are separate operations/],
  ["Shadow mode is not a no-write dry run", "docs/memory/overview.md", /no-write dry run/],
  ["Graph does not require a separate graph database", "docs/memory/overview.md", /does not\s+require a separate graph database/],
  ["Architecture does not claim universal route enforcement", "docs/architecture.md", /standalone admin API lacks equivalent route-level/],
  ["The decision-record example is an explicit synthetic projection", "docs/memory/see-it-think.md", /synthetic projection/],
  ["The displayed extraction confidence is documented", "docs/memory/see-it-think.md", /0\.95/],
  ["The next-probe reason is implemented", `${B}learner_memory/profile.py`, /INDEPENDENT_DIAGNOSTIC_REQUIRED/],
  ["Six teaching cards do not invent a new constitution", "docs/pedagogy/ekalaiva.md", /Transform, Agency, Ludic, Contextualize, and Proof/],
];

async function verifySources() {
  const paths = [...new Set([
    ...assets.flatMap((asset) => asset.sources.map(([, path]) => path)),
    ...sourceFacts.map(([, path]) => path),
    "Agentic Shiksha Platform/Frontend/package.json",
    "Agentic Shiksha Platform/Backend/requirements.txt",
    "Admin-Dashboard/frontend/package.json",
    "Admin-Dashboard/backend/requirements.txt",
    "assets/web/azure-icons/diagram-icons.mjs",
    "assets/images/azure-icons/README.md",
    "assets/images/azure-icons/Microsoft_Terms_of_Use.pdf",
    ...usedServiceIcons.map((service) => `assets/images/azure-icons/${azureServiceIcons[service].filename}`),
  ])].sort();
  const files = new Map();
  for (const path of paths) files.set(path, await readFile(sourcePath(path)));
  for (const [fact, path, expected] of sourceFacts) {
    assert.match(files.get(path).toString("utf8"), expected, `Source changed; review artwork claim: ${fact} (${path})`);
  }
  return {
    factsChecked: sourceFacts.map(([fact]) => fact),
    sourceFiles: paths.map((path) => ({ path, sha256: hash(files.get(path)) })),
  };
}

function verifyFigureHeadings(svg, id) {
  const labels = [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map(([, value]) => value).join("\n");
  assert.doesNotMatch(labels, /AGENTIC SHIKSHA\s*[/·]|SYNTHETIC EXAMPLE|SOURCE VIEW|^\s*\d{4}-\d{2}-\d{2}\s*$/im,
    `${id}: repeated branding headers, date stamps and top badges must stay removed`);
}

async function verifyEmbeddedAssets(svg, id) {
  const originals = new Map();
  const services = [];
  const images = [...svg.matchAll(/<image\b[^>]*>/g)];
  for (const [image] of images) {
    const attributes = Object.fromEntries([...image.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
    const label = `${id}: ${attributes["aria-label"] || "image"}`;
    assert.match(attributes.href || "", /^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/=]+$/, `${label} must embed its image`);
    assert.equal(attributes.preserveAspectRatio, "xMidYMid meet", `${label} must preserve the full original proportions`);
    const service = attributes["data-azure-icon"];
    const original = service ? azureServiceIcons[service] : null;
    if (service) {
      assert(original, `${label}: unknown Microsoft service icon ${service}`);
      assert.equal(attributes["aria-label"], original.label, `${label}: product identification`);
      assert.equal(Number(attributes.width), Number(attributes.height), `${label}: square icon viewport`);
      assert(Number(attributes.width) > 0, `${label}: positive icon size`);
      services.push(service);
    }
    const source = original ? `assets/images/azure-icons/${original.filename}` : "assets/images/branding/agentic-shiksha-logo.png";
    const mediaType = original ? "image/svg+xml" : "image/png";
    assert(attributes.href.startsWith(`data:${mediaType};base64,`), `${label}: original media type`);
    const bytes = Buffer.from(attributes.href.split(",")[1], "base64");
    assert(bytes.equals(await readFile(sourcePath(source))), `${label}: embedded bytes must match ${source} exactly`);
    const record = originals.get(source) || { source, sha256: hash(bytes), occurrences: 0 };
    record.occurrences++;
    originals.set(source, record);
  }
  const expected = id === "00-research-overview"
    ? assets.flatMap((asset) => Object.values(serviceIconPlacements[asset.id] || {}).flat())
    : Object.values(serviceIconPlacements[id] || {}).flat();
  assert.deepEqual(services, expected, `${id}: official icons belong only at the reviewed service placements`);
  return { id, embeddedImages: images.length, officialServiceIcons: services.length, originals: [...originals.values()] };
}

function gallery() {
  const articles = assets.map((asset) => `<article id="${asset.id}" class="artwork ${asset.kind}" data-asset="${asset.id}">
    <header class="asset-heading">
      <div><p class="eyebrow">${asset.kind === "banner" ? "Research identity" : "Architecture figure"} / ${esc(asset.theme)}</p><h2>${esc(asset.title)}</h2><p>${esc(asset.summary)}</p></div>
      <span class="editable">Editable SVG</span>
    </header>
    <figure class="${asset.theme === "dark" ? "dark-frame" : ""}">
      <a href="${imageHref(`${asset.id}.svg`)}" target="_blank" rel="noopener" aria-label="Open full-size ${esc(asset.title)}">
        <img src="${imageHref(`${asset.id}.svg`)}" width="${asset.width}" height="${asset.height}" loading="${asset.id === assets[0].id ? "eager" : "lazy"}" alt="${esc(asset.summary)}">
      </a>
      <figcaption>${serviceIconPlacements[asset.id] ? "Original source-backed diagram with unmodified official Microsoft service icons." : "Original conceptual artwork."} Open the image at full size to inspect details; it is not a screenshot or a live-resource inventory.</figcaption>
    </figure>
    <div class="asset-tools"><div class="downloads">
      <a class="button primary" download href="${imageHref(`${asset.id}.svg`)}">Download SVG <span aria-hidden="true">↓</span></a>
      <a class="button" download href="${imageHref(`${asset.id}.png`)}">Download PNG <span aria-hidden="true">↓</span></a>
      <a class="text-link" target="_blank" rel="noopener" href="${imageHref(`${asset.id}.svg`)}">Open full size ↗</a>
    </div><p class="dimensions">SVG ${asset.width} × ${asset.height}<br>PNG ${asset.width * 2} × ${asset.height * 2} · 2×</p></div>
    <div class="asset-context"><p><strong>Read this figure correctly.</strong> ${esc(asset.note)}</p>
      <details><summary>Source trail <span>${asset.sources.length} local references</span></summary>
        <ul>${asset.sources.map(([label, path]) => `<li><a href="${sourceHref(path)}">${esc(label)}</a><code>${esc(path)}</code></li>`).join("")}</ul>
      </details>
    </div>
  </article>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="description" content="Original Agentic Shiksha research banners and source-backed architecture figures, with editable SVGs, high-resolution PNGs and a reproducible local generator.">
  <title>Agentic Shiksha / Research visual system</title>
  <style>
    :root{font-family:${FONT};color:#203047;background:#edf1f6;font-synthesis:none;line-height:1.6;font-size:16px}
    *{box-sizing:border-box}body{margin:0}a{color:#345eb4;text-underline-offset:4px}a:hover{color:#644799}
    a:focus-visible,summary:focus-visible{outline:3px solid #8b59bd;outline-offset:5px;border-radius:4px}
    .skip{position:absolute;left:20px;top:-80px;background:white;padding:12px;z-index:5}.skip:focus{top:16px}
    .masthead{background:#0e1930;color:#eaf1ff;border-top:6px solid #a5b1e9;padding:clamp(34px,5vw,74px) max(24px,calc((100vw - 1510px)/2))}
    .masthead .eyebrow{color:#bac9e4}.masthead h1{font-size:clamp(34px,4.7vw,70px);line-height:1.1;letter-spacing:-2px;max-width:1000px;margin:18px 0 24px;font-weight:650}
    .masthead p{max-width:900px;color:#bdcbe2;font-size:18px}.masthead a{color:#d2e0ff}
    .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:2.2px;font-weight:750;color:#536daa;margin:0 0 8px}
    .top-links,.downloads{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.top-links{margin-top:30px}
    .top-links a{border:1px solid #506380;padding:9px 15px;border-radius:7px;text-decoration:none}
    .snapshot{display:inline-flex;align-items:center;gap:9px;border:1px solid #465877;padding:5px 12px;border-radius:30px;font-size:13px}
    .snapshot::before{content:"";width:7px;height:7px;background:#80cfbf;border-radius:100%}
    main{max-width:1558px;margin:0 auto;padding:30px 24px 70px}
    nav{display:flex;flex-wrap:wrap;gap:10px;padding:0 0 28px}nav a{background:white;border:1px solid #cad3e2;border-radius:7px;padding:8px 13px;text-decoration:none;font-size:14px}
    .artwork{background:#fff;border:1px solid #d1d9e5;border-radius:17px;margin:0 0 34px;overflow:hidden;scroll-margin-top:22px;box-shadow:0 7px 28px #20304708}
    .asset-heading{padding:27px 30px 23px;display:flex;justify-content:space-between;align-items:start;gap:20px}
    .asset-heading h2{font-size:clamp(24px,2.4vw,32px);letter-spacing:-.6px;line-height:1.22;margin:4px 0 10px;font-weight:650}
    .asset-heading p:last-child{max-width:1000px;margin:0;color:#596b83}.editable{white-space:nowrap;padding:5px 11px;border:1px solid #c9d8ee;background:#f0f5fc;border-radius:22px;font-size:12px;font-weight:650;color:#416092}
    figure{margin:0;padding:14px 16px 8px;background:#f5f7fb;border-top:1px solid #e0e5ed;border-bottom:1px solid #e0e5ed}
    figure a{display:block;line-height:0}img{display:block;max-width:100%;width:100%;height:auto;border-radius:8px}
    figure.dark-frame{background:#0b1425}figcaption{font-size:12px;color:#637189;text-align:center;padding:12px 10px 4px}.dark-frame figcaption{color:#adbed8}
    .asset-tools{display:flex;justify-content:space-between;gap:22px;align-items:center;padding:20px 30px}
    .button{border:1px solid #b8c8df;border-radius:7px;padding:9px 14px;text-decoration:none;font-size:14px;font-weight:600;background:#fff;color:#284575}
    .button.primary{background:#304e94;border-color:#304e94;color:white}.button span{margin-left:9px}.text-link{font-size:14px}
    .dimensions{font-size:12px;color:#63738a;text-align:right;margin:0;font-variant-numeric:tabular-nums;min-width:180px}
    .asset-context{padding:0 30px 27px;font-size:14px;color:#55677e}.asset-context>p{margin:0 0 15px;border-left:3px solid #b9cbe5;padding-left:14px}
    details{background:#f5f7fb;border:1px solid #dce3ed;border-radius:8px;padding:12px 16px}
    summary{cursor:pointer;color:#284575;font-weight:600}summary span{font-size:12px;font-weight:400;color:#62758e;margin-left:12px}
    details ul{padding-left:22px;margin-bottom:4px}details li{margin:11px 0}details code{display:block;color:#627189;font-size:12px;overflow-wrap:anywhere}
    .notes{background:#fff;border:1px solid #d1d9e5;border-radius:17px;padding:30px;scroll-margin-top:24px}
    .notes h2{margin:0 0 16px;font-size:28px}.notes h3{margin:26px 0 8px;font-size:20px}
    .legend{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:20px 0 28px}
    .legend>div{border:1px solid #d3deec;border-radius:10px;padding:18px}.legend strong{display:block;margin:8px 0}.legend p{margin:0;color:#60728a;font-size:14px}
    .keyline{height:5px;width:58px;background:#315fba;position:relative;margin:9px 10px 18px 0}.keyline::after{content:"";position:absolute;right:-6px;top:-4px;border-left:9px solid #315fba;border-top:6px solid transparent;border-bottom:6px solid transparent}
    .keyline.dashed{background:repeating-linear-gradient(to right,#8051ab 0 7px,transparent 7px 13px)}.keyline.dashed::after{border-left-color:#8051ab}
    .keybox{width:70px;height:24px;border:2px dashed #778eac;border-radius:6px;margin-bottom:8px}
    .notes p,.notes li{color:#55677e}.notes pre{background:#101c32;color:#e1edff;padding:17px;border-radius:9px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px}
    code{font-family:Consolas,"Courier New",monospace}.notes .caution{background:#fcf3e6;border:1px solid #e4c9a5;border-radius:9px;padding:14px 18px}
    footer{padding:28px 4px 0;color:#66768b;font-size:13px}
    @media(max-width:700px){main{padding:20px 12px 36px}.masthead{padding:35px 22px}.masthead h1{letter-spacing:-1px}.masthead p{font-size:16px}.asset-heading{padding:20px;display:block}.editable{display:inline-block;margin-top:15px}.asset-tools{padding:18px 20px;display:block}.dimensions{text-align:left;margin-top:15px}.asset-context{padding:0 20px 20px}figure{padding:7px 6px}.notes{padding:23px 20px}.legend{grid-template-columns:1fr}summary span{display:block;margin:4px 0 0}nav{gap:7px}nav a{font-size:13px}.button{font-size:13px}}
    @media print{.masthead{background:white;color:#203047}.masthead p{color:#526176}.top-links,nav,.asset-tools,.skip{display:none}.artwork{break-inside:avoid;box-shadow:none}.notes{break-before:page}main{padding:0}}
  </style>
</head>
<body>
  <a class="skip" href="#artworks">Skip to research artwork</a>
  <header class="masthead">
    <span class="snapshot">SOURCE SNAPSHOT · ${SNAPSHOT}</span>
    <p class="eyebrow" style="margin-top:24px">Agentic Shiksha / Research visual system</p>
    <h1>A learning system,<br>made legible.</h1>
    <p>A research identity, a learner feedback loop, a learner-memory graph, and an observable decision record. Separate figures explain the pedagogy, agent creation, evidence pipeline, and engineering boundaries. Original diagram artwork with official Azure icons at existing service nodes; synthetic examples are labeled, not passed off as study evidence.</p>
    <div class="top-links"><a href="${imageHref("00-research-overview.png")}" target="_blank" rel="noopener">Open contact sheet ↗</a><a href="${imageHref("00-research-overview.svg")}" download>Contact sheet SVG ↓</a><a href="#reproduce">Reproduce locally</a><a href="manifest.json">Generation manifest</a></div>
  </header>
  <main id="artworks">
    <nav aria-label="Research artwork">
      <a href="#shiksha-research-banner">Primary identity</a><a href="#shiksha-research-banner-dark">Dark identity</a>
      ${assets.filter((asset) => asset.kind === "figure").map((asset) => `<a href="#${asset.id}">${esc(asset.title)}</a>`).join("")}
      <a href="#reading-guide">Reading guide</a>
    </nav>
    ${articles}
    <section class="notes" id="reading-guide">
      <p class="eyebrow">Legend / research boundaries</p><h2>What the visual language means</h2>
      <div class="legend">
        <div><div class="keyline"></div><strong>Directional work or data flow</strong><p>Arrowheads indicate request, result, persistence or processing direction. Numbers in figure 03 resolve to the flow key in the image.</p></div>
        <div><div class="keyline dashed"></div><strong>Context-dependent dashed links</strong><p>Figure 01: unsaved proposals. Figure 02: reviewed graph and policy inputs, plus separate activation. Figure 03: an optional graph-memory module.</p></div>
        <div><div class="keybox"></div><strong>Logical ownership boundaries</strong><p>Dashed enclosures group responsibilities. They do not claim network isolation, separate deployment units or a universally enforced security boundary.</p></div>
      </div>
      <ul>
        <li>Four services are independently built: the main frontend and API, and the separate admin frontend and API. Material and curriculum workers remain inside the main backend.</li>
        <li>Teacher dashboard views belong to the main web app. The admin web app also calls the main API for placement/student assignment operations. The admin API queries storage directly.</li>
        <li>Graph memory is opt-in and off by default. Publication of a reviewed curriculum and activation of a course binding are distinct operations. Shadow mode is not a no-write dry run.</li>
        <li>A graph is stored as Cosmos documents. An LLM can propose observations, but deterministic policy decides state. A generated artifact, a legacy “learned” label, or a model confidence score is not proof of crossing.</li>
        <li>The conceptual loop has six components, not six services. Learner-memory and “See it think” examples are synthetic explanatory views, not screenshots, participant records, hidden chain-of-thought, or measured learning outcomes.</li>
        <li>The banners embed the supplied Agentic Shiksha logo from <a href="../../images/branding/agentic-shiksha-logo.png">assets/images/branding</a>, preserved unchanged. The pedagogical and application-component glyphs remain original drawings, not Microsoft service marks.</li>
        <li>Figures 01 and 03 embed official Microsoft Foundry, Azure AI Search, Azure Cosmos DB and Azure Blob Storage icons only at existing managed-service nodes. All images are self-contained; generation makes no remote-image, cloud or model calls and uses no real learner data or external fonts.</li>
      </ul>
      <p class="caution"><strong>Operational limit.</strong> Source presence is not deployment or readiness evidence. The standalone admin API lacks equivalent route-level enforcement and still needs an independently authenticated, restricted access boundary. No hosting platform, private network or unspecified service is invented here.</p>
      <h3>Official service icon provenance and usage</h3>
      <p>The Microsoft marks come from the downloaded Azure Architecture Center V24 package. See the <a href="../../images/azure-icons/README.md">local official-icon provenance and archive mapping</a> and the <a href="../../images/azure-icons/Microsoft_Terms_of_Use.pdf">bundled Microsoft terms</a>. The icons retain their original SVG bytes, colors and proportions, with no clipping, recoloring or rotation; a separate light backing keeps them legible in the dark figure. They identify Microsoft services, not Agentic Shiksha branding or Microsoft endorsement, and do not inherit the repository’s MIT license. The surrounding diagrams and conceptual glyphs are original project artwork.</p>
      <h3 id="reproduce">Edit and regenerate</h3>
      <p><a href="artwork.mjs">artwork.mjs</a> contains the editable drawing definitions and source trails; <a href="generate.mjs">generate.mjs</a> creates the SVGs, gallery, contact sheet, PNGs and manifest. From the repository root, run:</p>
      <pre><code>node assets\\web\\research\\generate.mjs --png</code></pre>
      <p>Run without <code>--png</code> for dependency-free SVG/HTML generation. Raster generation uses the main frontend’s existing <code>@playwright/test</code> package and its installed Chromium browser. No package manifest is changed and no application backend starts. If Chromium is missing, install it once from <code>Agentic Shiksha Platform\\Frontend</code> with <code>npx playwright install chromium</code>, then rerun the command above.</p>
      <p>The renderer blocks HTTP(S) requests. It verifies source claims and links, embedded image bytes against the originals, reviewed service-icon placement, icon/text clearance, unaltered mark presentation, actual rendered text containment and overlaps, minimum 22 px diagram type, orthogonal routing and connector/node clearance, PNG dimensions and desktop/tablet/mobile gallery layout. The manifest records source, embedded-asset and output SHA-256 hashes. No timestamp-dependent content or random layout is generated.</p>
      <p>Text remains editable in each SVG; the supplied logo remains an embedded PNG and Microsoft service icons remain embedded original SVGs. Fonts are local Segoe UI / Arial; there are no font downloads. Pixel-exact PNG reproduction assumes the same Chromium and installed fonts. Import SVGs into a vector editor or place SVG/PNG files in a research slide deck. Direct SVG edits are valid, but regeneration replaces them; make repeatable changes in <code>artwork.mjs</code>. See the <a href="${imageHref("README.md")}">research asset guide</a> for the placement scope and preservation rules.</p>
      <h3>Integration</h3>
      <p>Use <code>shiksha-research-banner.svg</code> or its ${assets[0].width * 2} × ${assets[0].height * 2} PNG as the primary identity. The dark variant is intended for dark slides. This standalone folder does not replace any existing motion or architecture assets. Keep relative source links with the repository; images themselves are self-contained and can be copied independently.</p>
      <p>Contact sheet: <a href="${imageHref("00-research-overview.svg")}" download>SVG</a> / <a href="${imageHref("00-research-overview.png")}" download>PNG</a>. For technical reading, open the full-size individual diagrams instead of the overview thumbnails.</p>
    </section>
    <footer>Original Agentic Shiksha research artwork with separately licensed Microsoft service icons · ${SNAPSHOT}. A logical source view, not a live resource inventory, product screenshot or learning-outcome guarantee.</footer>
  </main>
</body>
</html>`;
}

async function waitForArtwork(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll("image")].map(async (element) => {
      const image = new Image();
      image.src = element.href.baseVal;
      await image.decode();
    }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function validateServiceIcons(page, expected) {
  const result = await page.evaluate(() => {
    const errors = [];
    const icons = [...document.querySelectorAll("image[data-azure-icon]")];
    const labels = [...document.querySelectorAll("text")];
    const placements = [];
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
    const contains = (a, b) => b.left >= a.left - .5 && b.right <= a.right + .5
      && b.top >= a.top - .5 && b.bottom <= a.bottom + .5;
    for (const image of icons) {
      const service = image.dataset.azureIcon;
      const group = image.closest("[data-node]");
      const name = group?.getAttribute("data-node");
      const bounds = group?.querySelector("[data-bounds]")?.getBoundingClientRect();
      const box = image.getBoundingClientRect();
      if (!bounds || !contains(bounds, box)) errors.push(`Service icon outside its node: ${service} / ${name}`);
      if (box.width <= 0 || box.height <= 0) errors.push(`Invisible service icon: ${service} / ${name}`);
      const matrix = image.getScreenCTM();
      if (!matrix || matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.a - matrix.d) > 1e-6 || Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6) {
        errors.push(`Distorted or rotated service icon: ${service} / ${name}`);
      }
      for (let element = image; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (["transform", "rotate", "scale", "translate", "filter", "clipPath", "maskImage"].some((key) => style[key] && style[key] !== "none")
          || style.opacity !== "1" || style.mixBlendMode !== "normal" || style.visibility !== "visible") {
          errors.push(`Service icon presentation altered by ${element.tagName}: ${service} / ${name}`);
        }
        if (element instanceof SVGSVGElement && !contains(element.getBoundingClientRect(), box)) {
          errors.push(`Service icon clipped by SVG viewport: ${service} / ${name}`);
        }
      }
      for (const label of labels) {
        if (overlaps(box, label.getBoundingClientRect())) errors.push(`Service icon overlaps text: ${service} / "${label.textContent}"`);
      }
      placements.push({
        service, node: name || "(outside a node)",
        x: image.x.baseVal.value, y: image.y.baseVal.value, size: image.width.baseVal.value,
      });
    }
    for (let i = 0; i < icons.length; i++) {
      for (let j = i + 1; j < icons.length; j++) {
        if (overlaps(icons[i].getBoundingClientRect(), icons[j].getBoundingClientRect())) errors.push("Overlapping Microsoft service icons");
      }
    }
    return { errors, officialServiceIcons: icons.length, officialIconPlacements: placements };
  });
  const observed = {};
  for (const { node, service } of result.officialIconPlacements) (observed[node] ||= []).push(service);
  assert.deepEqual(observed, expected, "Official icons must remain on the reviewed source-backed service nodes");
  return result;
}

async function validateSvg(page, asset) {
  await page.setViewportSize({ width: asset.width, height: asset.height });
  await page.goto(pathToFileURL(outputPath(`${asset.id}.svg`)).href);
  await waitForArtwork(page);
  const result = await page.evaluate(({ minimum }) => {
    const errors = [];
    if (document.querySelector("parsererror")) errors.push("Invalid SVG XML");
    const svg = document.documentElement;
    const canvas = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll("text")];
    const intersection = (a, b) => ({
      width: Math.min(a.right, b.right) - Math.max(a.left, b.left),
      height: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    });
    const nodes = [...svg.querySelectorAll("[data-node]")].map((group) => ({
      name: group.getAttribute("data-node"),
      rect: group.querySelector("[data-bounds]").getBoundingClientRect(),
    }));
    for (const node of texts) {
      const box = node.getBoundingClientRect();
      const size = Number.parseFloat(getComputedStyle(node).fontSize);
      if (size < minimum) errors.push(`Text below ${minimum}px: ${node.textContent} (${size})`);
      if (box.left < canvas.left - .5 || box.right > canvas.right + .5 || box.top < canvas.top - .5 || box.bottom > canvas.bottom + .5) {
        errors.push(`Text outside canvas: ${node.textContent}`);
      }
      const group = node.closest("[data-fit]");
      if (group) {
        const bounds = group.querySelector("[data-bounds]").getBoundingClientRect();
        if (box.left < bounds.left + 9 || box.right > bounds.right - 9 || box.top < bounds.top + 6 || box.bottom > bounds.bottom - 6) {
          errors.push(`Text outside padded ${group.getAttribute("data-fit")}: ${node.textContent}`);
        }
      }
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const overlap = intersection(texts[i].getBoundingClientRect(), texts[j].getBoundingClientRect());
        if (overlap.width > .75 && overlap.height > .75) errors.push(`Overlapping labels: "${texts[i].textContent}" / "${texts[j].textContent}"`);
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const overlap = intersection(nodes[i].rect, nodes[j].rect);
        if (overlap.width > 1 && overlap.height > 1) errors.push(`Overlapping nodes: ${nodes[i].name} / ${nodes[j].name}`);
      }
    }
    const connectors = [...svg.querySelectorAll("[data-connector]")];
    const overlapsSegment = (a, b, r, inset = 0) => a.x === b.x
      ? a.x > r.left + inset && a.x < r.right - inset && Math.min(a.y, b.y) < r.bottom - inset && Math.max(a.y, b.y) > r.top + inset
      : a.y > r.top + inset && a.y < r.bottom - inset && Math.min(a.x, b.x) < r.right - inset && Math.max(a.x, b.x) > r.left + inset;
    for (const edge of connectors) {
      const points = [...edge.points].map((point) => ({ x: point.x, y: point.y }));
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const vertical = a.x === b.x, horizontal = a.y === b.y;
        if (!vertical && !horizontal) errors.push(`Non-orthogonal connector: ${edge.dataset.connector}`);
        for (const node of nodes) {
          if (overlapsSegment(a, b, node.rect, 3)) errors.push(`Connector crosses node interior: ${edge.dataset.connector} / ${node.name}`);
        }
        for (const node of texts) {
          if (node.closest("[data-flow-badge]")) continue;
          if (overlapsSegment(a, b, node.getBoundingClientRect())) {
            errors.push(`Connector crosses text: ${edge.dataset.connector} / ${node.textContent}`);
          }
        }
      }
    }
    return { errors, textLabels: texts.length, nodes: nodes.length, connectors: connectors.length, minimumFontSize: Math.min(...texts.map((node) => Number.parseFloat(getComputedStyle(node).fontSize))) };
  }, { minimum: 22 });
  if (asset.kind === "banner") {
    const banner = await page.evaluate(() => {
      const tagline = document.querySelector("[data-banner-tagline]");
      const logo = document.querySelector('image[aria-label="Agentic Shiksha logo"]');
      const background = document.querySelector("[data-banner-background]");
      const canvas = document.documentElement.getBoundingClientRect();
      const baselines = tagline ? Array.from({ length: tagline.getNumberOfChars() },
        (_, index) => tagline.getStartPositionOfChar(index).y) : [];
      const logoBounds = logo?.getBoundingClientRect();
      const taglineBounds = tagline?.getBoundingClientRect();
      const logoSurface = document.querySelector("[data-banner-logo-surface]")?.getBoundingClientRect();
      return {
        text: tagline?.textContent,
        taglineY: Number(tagline?.getAttribute("y")),
        textElements: document.querySelectorAll("text").length,
        foregroundCircles: [...document.querySelectorAll("circle")].filter(circle => !circle.closest("[data-banner-background]")).length,
        backgroundIsDecorative: background?.getAttribute("aria-hidden") === "true" && !background.querySelector("text, image"),
        backgroundBeforeLogo: !!background && !!logo && !!(background.compareDocumentPosition(logo) & Node.DOCUMENT_POSITION_FOLLOWING),
        backgroundPaths: background?.querySelectorAll("path").length || 0,
        backgroundMasked: !!background?.getAttribute("mask"),
        baselineSpread: baselines.length ? Math.max(...baselines) - Math.min(...baselines) : null,
        centeredLogo: !!logoBounds && Math.abs((logoBounds.left + logoBounds.right) / 2 - (canvas.left + canvas.right) / 2) < 1,
        taglineBelowLogo: !!logoBounds && !!taglineBounds && taglineBounds.top > logoBounds.bottom,
        logoToTaglineGap: logoBounds && taglineBounds ? taglineBounds.top - logoBounds.bottom : null,
        logoSurfaceGap: logoSurface && taglineBounds ? taglineBounds.top - logoSurface.bottom : null,
        width: canvas.width,
        height: canvas.height,
        logoWidth: logoBounds?.width,
        logoHeight: logoBounds?.height,
        topInset: logoBounds ? logoBounds.top - canvas.top : null,
        bottomInset: taglineBounds ? canvas.bottom - taglineBounds.bottom : null,
      };
    });
    assert.equal(banner.text, "From knowledge transmission to knowledge transformation.", `${asset.id}: complete tagline`);
    assert.equal(banner.taglineY, 510, `${asset.id}: tagline moves upward without moving the logo`);
    assert.equal(banner.textElements, 1, `${asset.id}: only the single-line tagline remains`);
    assert.equal(banner.foregroundCircles, 0, `${asset.id}: the right-hand learning-path illustration stays removed`);
    assert(banner.backgroundIsDecorative && banner.backgroundBeforeLogo, `${asset.id}: background remains decorative and behind the logo`);
    assert(banner.backgroundPaths >= 20 && banner.backgroundMasked, `${asset.id}: edge artwork fades away from the center`);
    assert.equal(banner.baselineSpread, 0, `${asset.id}: every tagline character shares one baseline`);
    assert(banner.centeredLogo && banner.taglineBelowLogo, `${asset.id}: centered logo above the tagline`);
    assert.equal(banner.width, 2400, `${asset.id}: keep the original banner width`);
    assert.equal(banner.height, 600, `${asset.id}: trim the empty vertical margins`);
    assert.equal(banner.logoWidth, 1180, `${asset.id}: do not resize the logo`);
    assert.equal(banner.logoHeight, 450, `${asset.id}: preserve the full logo proportions`);
    assert.equal(banner.topInset, 20, `${asset.id}: compact top padding without clipping the logo`);
    assert(banner.logoToTaglineGap >= 0 && banner.logoToTaglineGap <= 16, `${asset.id}: keep the tagline close to the logo without overlap`);
    if (asset.theme === "dark") assert(banner.logoSurfaceGap >= 16, `${asset.id}: keep the light backing clear of the tagline`);
    assert(banner.bottomInset >= 20 && banner.bottomInset <= 60, `${asset.id}: compact bottom padding without clipping the tagline`);
  }
  const icons = await validateServiceIcons(page, serviceIconPlacements[asset.id] || {});
  return { ...result, ...icons, errors: [...result.errors, ...icons.errors] };
}

async function verifyPng(filename, width, height) {
  const bytes = await readFile(outputPath(filename));
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${filename} PNG signature`);
  assert.equal(bytes.readUInt32BE(16), width, `${filename} width`);
  assert.equal(bytes.readUInt32BE(20), height, `${filename} height`);
}

async function verifyGalleryLinks(html) {
  const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  for (const link of links) {
    if (link.startsWith("#")) continue;
    assert(!/^[a-z]+:/i.test(link), `Gallery must stay local: ${link}`);
    const path = fileURLToPath(new URL(link, pathToFileURL(outputPath("index.html"))));
    assert((await stat(path)).isFile(), `Missing gallery target: ${link}`);
  }
  return links.length;
}

async function renderAndValidate(html) {
  const require = createRequire(join(root, "Agentic Shiksha Platform", "Frontend", "package.json"));
  let chromium;
  try {
    ({ chromium } = require("@playwright/test"));
  } catch (error) {
    throw new Error("PNG rendering requires the existing main Frontend @playwright/test dependency. Restore the frontend dependencies before running --png.", { cause: error });
  }
  const browser = await chromium.launch({ headless: true });
  const attemptedNetwork = [];
  const errors = [];
  const layoutErrors = [];
  const validated = [];
  try {
    const context = await browser.newContext({ deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
    await context.route(/^https?:\/\//, async (route) => {
      attemptedNetwork.push(route.request().url());
      await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const asset of assets) {
      const checks = await validateSvg(page, asset);
      if (asset.id === "04-conceptual-loop") {
        assert.equal(checks.nodes, 6, "The README research figure contains exactly six major components");
      }
      layoutErrors.push(...checks.errors.map((error) => `${asset.id}: ${error}`));
      await page.screenshot({ path: outputPath(`${asset.id}.png`), animations: "disabled" });
      await verifyPng(`${asset.id}.png`, asset.width * 2, asset.height * 2);
      validated.push({ id: asset.id, ...checks, pngWidth: asset.width * 2, pngHeight: asset.height * 2 });
      console.log(`${checks.errors.length ? "FAIL" : "PASS"} ${asset.id}: ${checks.textLabels} labels, ${checks.connectors} routes, ${checks.officialServiceIcons} official icons, ${asset.width * 2} x ${asset.height * 2} PNG`);
    }
    await context.close();
    const overviewContext = await browser.newContext({ deviceScaleFactor: 1 });
    await overviewContext.route(/^https?:\/\//, async (route) => {
      attemptedNetwork.push(route.request().url());
      await route.abort("blockedbyclient");
    });
    const overview = await overviewContext.newPage();
    await overview.goto(pathToFileURL(outputPath("00-research-overview.svg")).href);
    const overviewWidth = Number(await overview.locator("svg").first().getAttribute("width"));
    const overviewHeight = Number(await overview.locator("svg").first().getAttribute("height"));
    assert(overviewWidth > 0 && overviewHeight > 0, "Contact sheet dimensions are explicit");
    await overview.setViewportSize({ width: overviewWidth, height: overviewHeight });
    await waitForArtwork(overview);
    assert.equal(await overview.locator("parsererror").count(), 0, "Contact sheet SVG parses");
    const overviewIcons = await validateServiceIcons(overview, Object.assign({}, ...Object.values(serviceIconPlacements)));
    layoutErrors.push(...overviewIcons.errors.map((error) => `00-research-overview: ${error}`));
    await overview.screenshot({ path: outputPath("00-research-overview.png"), animations: "disabled" });
    await verifyPng("00-research-overview.png", overviewWidth, overviewHeight);
    await overviewContext.close();
    const galleryContext = await browser.newContext({ reducedMotion: "reduce" });
    await galleryContext.route(/^https?:\/\//, async (route) => {
      attemptedNetwork.push(route.request().url());
      await route.abort("blockedbyclient");
    });
    const galleryPage = await galleryContext.newPage();
    galleryPage.on("pageerror", (error) => errors.push(error.message));
    const layouts = [];
    for (const width of [1440, 768, 390]) {
      await galleryPage.setViewportSize({ width, height: 1000 });
      await galleryPage.goto(pathToFileURL(outputPath("index.html")).href);
      await galleryPage.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => {
          image.loading = "eager";
          return image.decode();
        }));
      });
      const layout = await galleryPage.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        images: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
        figures: document.querySelectorAll("article.artwork").length,
        brokenAnchors: [...document.querySelectorAll('a[href^="#"]')]
          .filter((link) => !document.getElementById(link.getAttribute("href").slice(1)))
          .map((link) => link.getAttribute("href")),
      }));
      assert.deepEqual(layout, { overflow: false, images: true, figures: assets.length, brokenAnchors: [] }, `Gallery layout at ${width}px`);
      layouts.push({ width, ...layout });
    }
    await galleryContext.close();
    assert.deepEqual(attemptedNetwork, [], "No external network calls are allowed");
    assert.deepEqual(errors, [], "No browser errors");
    assert.deepEqual(layoutErrors, [], `Rendered SVG layout failures:\n${layoutErrors.join("\n")}`);
    const localLinks = await verifyGalleryLinks(html);
    console.log(`PASS contact sheet, ${localLinks} local links, gallery 1440/768/390px, zero network requests`);
    return {
      assets: validated, contactSheet: { width: overviewWidth, height: overviewHeight, ...overviewIcons },
      gallery: layouts, localLinks, networkRequests: attemptedNetwork.length, browserErrors: errors, browserVersion: browser.version(),
    };
  } finally {
    await browser.close();
  }
}

await mkdir(output, { recursive: true });
await mkdir(imageOutput, { recursive: true });
const sourceVerification = await verifySources();
const rendered = new Map(assets.map((asset) => [asset.id, asset.draw()]));
const embeddedAssetVerification = [];
for (const [id, svg] of rendered) {
  verifyFigureHeadings(svg, id);
  assert(!/(?:https?:\/\/|@import|@font-face)/.test(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")), `${id} must not load remote content`);
  embeddedAssetVerification.push(await verifyEmbeddedAssets(svg, id));
  await writeFile(outputPath(`${id}.svg`), `${svg}\n`, "utf8");
}
const overviewSvg = contactSheet(rendered);
verifyFigureHeadings(overviewSvg, "00-research-overview");
embeddedAssetVerification.push(await verifyEmbeddedAssets(overviewSvg, "00-research-overview"));
await writeFile(outputPath("00-research-overview.svg"), `${overviewSvg}\n`, "utf8");
const html = gallery();
await writeFile(outputPath("index.html"), html, "utf8");
const manifest = {
  sourceSnapshot: SNAPSHOT,
  description: "Original source-grounded Agentic Shiksha research artwork with unmodified official Microsoft service icons; no live inventory or user data.",
  regenerationCommand: "node assets\\web\\research\\generate.mjs --png",
  font: FONT,
  serviceIconProvenance: "assets/images/azure-icons/README.md",
  serviceIconTerms: "assets/images/azure-icons/Microsoft_Terms_of_Use.pdf",
  embeddedAssetVerification,
  ...sourceVerification,
  assets: assets.map(({ id, width, height, sources }) => ({ id, width, height, pngWidth: width * 2, pngHeight: height * 2, sources })),
  generatedFiles: [],
};
await writeFile(outputPath("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
if (raster) manifest.validation = await renderAndValidate(html);
const names = [
  ...assets.flatMap((asset) => [`${asset.id}.svg`, ...(raster ? [`${asset.id}.png`] : [])]),
  "00-research-overview.svg", ...(raster ? ["00-research-overview.png"] : []),
  "index.html", "artwork.mjs", "generate.mjs", "README.md",
];
for (const file of names) {
  const data = await readFile(outputPath(file));
  const relativeFile = /\.(?:svg|png)$/.test(file) || file === "README.md" ? imageHref(file) : file;
  manifest.generatedFiles.push({ file: relativeFile, bytes: data.length, sha256: hash(data) });
}
await writeFile(outputPath("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Generated ${assets.length} SVGs and overview in images\\research; gallery and manifest in web\\research; ${sourceFacts.length} source assertions passed.`);
if (!raster) console.log("SVG-only run: PNGs were not regenerated. Use --png for raster output and rendered layout validation.");
