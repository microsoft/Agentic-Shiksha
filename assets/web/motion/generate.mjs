import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { azureServiceIcons } from "../azure-icons/diagram-icons.mjs";
import { assetPath, assetUrl, imageDir } from "./asset-paths.mjs";
import "./scenes.js";

globalThis.ShikshaAzureIcons = azureServiceIcons;

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const args = process.argv.slice(2);
assert(args.every((arg) => ["--stills-only", "--architecture", "--tutorials-only"].includes(arg)), "Usage: node generate.mjs [--architecture] [--stills-only] | --tutorials-only");
const stillsOnly = args.includes("--stills-only");
const architectureOnly = args.includes("--architecture");
const tutorialsOnly = args.includes("--tutorials-only");
assert(!tutorialsOnly || (!stillsOnly && !architectureOnly), "--tutorials-only must be used without diagram-rendering options");
const localRequire = createRequire(import.meta.url);
const frontendRequire = createRequire(join(root, "Agentic Shiksha Platform", "Frontend", "package.json"));
const { chromium } = frontendRequire("@playwright/test");
const ffmpeg = localRequire("@ffmpeg-installer/ffmpeg").path;
const motion = globalThis.ShikshaMotion;
const FPS = 12;
const GIF_FPS = 10;
const architectureEntries = Object.entries(motion.scenes).filter(([, spec]) => spec.file);
const files = architectureOnly
  ? Object.fromEntries(architectureEntries.map(([id, spec]) => [id, spec.file]))
  : { flow: "shiksha-architecture-flow" };
const stamps = {
  flow: [0, 3.9, 4.1, 7.9, 8.1, 11.9, 12.1, 15.9],
  ...Object.fromEntries(architectureEntries.map(([id, spec]) => [
    id, spec.stages.flatMap(({ start }) => [start, start + 2.5, start + 4.9]),
  ])),
};
const allOutputs = [];
const architectureResults = [];
const expectedServiceIcons = {
  flow: ["search", "foundry", "blob", "cosmos"],
  context: ["foundry", "search", "cosmos", "blob"],
  services: ["foundry", "search", "cosmos", "blob"],
  runtime: ["foundry", "cosmos"],
  grounding: ["blob", "document-intelligence", "search"],
  memory: [],
};
const iconDataScript = `<script id="azure-service-icons">globalThis.ShikshaAzureIcons=${JSON.stringify(azureServiceIcons)};</script>`;
const tutorialDefinitions = [
  { id: "image-generation", name: "shiksha-image-generation-tutorial", role: "Learner",
    note: "The actual image-generation loading state, inline image, full-size preview and follow-up chat are exercised with a synthetic tool response. The original solar-irrigation illustration is rendered locally from SVG; it is not live model output. No image-generation service, quota or cloud resource is used." },
  { id: "onboarding-profile", name: "shiksha-onboarding-profile-tutorial", role: "Learner",
    note: "The real first-run flow starts after simulated sign-in. Profile details and saves are synthetic, isolated in memory; no external identity or real learner profile is changed." },
  { id: "teacher-roster", name: "shiksha-teacher-roster-tutorial", role: "Teacher",
    note: "The embedded teacher dashboard shows a fictional course and roster. Learner progress and artifact data are controlled local fixtures, not real participant records or measured outcomes." },
  { id: "teacher-usage", name: "shiksha-teacher-usage-tutorial", role: "Teacher",
    note: "Actual usage and learning-activity controls with synthetic analytics. Filtering changes local fixture responses; the figures are illustrative, not live service usage or evaluation results." },
  { id: "admin-overview", name: "shiksha-admin-overview-tutorial", role: "Administrator",
    note: "Recorded in the separately built Admin Dashboard, with fictional institution, course and usage records. No real administrative account or live analytics service is accessed." },
  { id: "admin-assignments", name: "shiksha-admin-assignments-tutorial", role: "Administrator",
    note: "The real admin assignment controls operate only on an isolated synthetic directory. Any demonstrated save is intercepted and verified locally; no real student's permissions or course access are changed." },
  { id: "memory", name: "shiksha-learner-memory-tutorial", role: "Learner",
    note: "Demonstrates the project's custom learner-memory structure in the actual Graph Memory panel, not the separate hosted Memory Store. Two prior diagnostic records and the before/pending/after snapshots are synthetic fixtures. The new evidence quote comes from the answer typed in this recording. No live memory worker, model or state reducer was run, and no real course was activated. A correct response improves the demonstrated state without clearing a misconception or crossing a threshold." },
  { id: "student-teacher", name: "shiksha-student-teacher-tutorial", role: "Learner + Teacher",
    note: "Two actual application sessions are captured together. The teacher explicitly asks Insights for an update; its scripted reply uses the learner's real intercepted demo question and submitted check. This demonstrates a shared local fixture, not a live cloud telemetry feed or an automatic mastery decision." },
  { id: "challenges", name: "shiksha-challenges-tutorial", role: "Learner",
    note: "A guided challenge is generated and explored through the actual challenge UI. Task content, hints and solution are synthetic. Hints and a revealed solution are learning aids, not assessment proof." },
  { id: "chat", name: "shiksha-chat-tutorial", role: "Learner",
    note: "Real chat and assessment UI with synthetic lesson content and grading. A single correct answer does not establish mastery." },
  { id: "teacher", name: "shiksha-course-setup-tutorial", role: "Teacher",
    note: "Actual Create and Course Companion screens. The walkthrough stops at draft review; it does not submit Create or provision a remote agent." },
  { id: "answer-depth", name: "shiksha-answer-depth-tutorial", role: "Learner",
    note: "The actual answer-depth control changes from Concise to Comprehensive. Responses are scripted examples, not a comparison of live model performance." },
  { id: "documents", name: "shiksha-document-reader-tutorial", role: "Learner",
    note: "A synthetic field guide passes through the real document renderer, full-screen reader and section navigation." },
  { id: "slides", name: "shiksha-slides-tutorial", role: "Learner",
    note: "The deck and tool response are synthetic. The slide viewer, navigation and presentation controls are the actual application's components." },
  { id: "circuits", name: "shiksha-circuit-tutorial", role: "Learner",
    note: "Hypothetical low-voltage circuit practice in the actual Circuit Lab. Numeric results are local fixtures, not live ngspice output or physical wiring instructions." },
  { id: "preferences", name: "shiksha-learning-preferences-tutorial", role: "Learner",
    note: "Custom instructions are saved to an isolated in-memory API and verified on the next chat request. No real learner profile is changed." },
  { id: "companion-review", name: "shiksha-companion-review-tutorial", role: "Teacher",
    note: "Chat only, Allow editing and Undo are exercised in the real builder. No course is created and no remote agent is changed." },
];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

async function publishIconData() {
  const filename = join(here, "index.html");
  const html = await readFile(filename, "utf8");
  const existing = /<script id="azure-service-icons">[\s\S]*?<\/script>/;
  const updated = existing.test(html)
    ? html.replace(existing, iconDataScript)
    : html.replace('<script src="scenes.js" defer></script>', `${iconDataScript}\n  <script src="scenes.js" defer></script>`);
  assert(updated.includes(iconDataScript), "Gallery must load official icon data before the scenes");
  if (updated !== html) await writeFile(filename, updated);
}

async function publishArchitectureGallery() {
  const original = await readFile(join(here, "index.html"), "utf8");
  const style = original.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert(style, "Reference gallery styling is missing");
  const nav = architectureEntries.map(([id, spec], i) =>
    `<a class="level-link" href="#${id}"><span>${String(i + 1).padStart(2, "0")}</span><strong>${escapeHtml(spec.name)}</strong><small>${i < 3 ? `Zoom level ${i + 1}` : "Dataflow detail"}</small></a>`).join("");
  const articles = architectureEntries.map(([id, spec], i) => `<article class="sample" id="${id}" data-player="${id}">
    <header><div><p class="eyebrow">${escapeHtml(spec.level)} / ${spec.duration} SECONDS</p><h2>${escapeHtml(spec.title)}</h2></div>
      <div class="downloads">${["gif", "mp4", "svg", "png"].map(extension =>
        `<a href="${assetUrl(`${spec.file}.${extension}`)}" download>${extension === "png" ? "2x PNG" : extension.toUpperCase()}</a>`).join("")}</div></header>
    <div class="viewport" aria-label="${escapeHtml(spec.name)} animated architecture"></div>
    <div class="controls"><button type="button" data-play aria-pressed="false" aria-label="Play or pause ${escapeHtml(spec.name)}">Play</button>
      <button type="button" data-replay aria-label="Replay ${escapeHtml(spec.name)}">Replay</button>
      <label class="seek">Timeline<input type="range" min="0" max="${spec.duration - 0.01}" step="0.01" value="${spec.poster}" aria-label="${escapeHtml(spec.name)} time"></label><output data-time></output></div>
    <p class="status" data-status role="status"></p>
    <p class="note" id="${id}-note">${escapeHtml(spec.note)}</p>
    <details><summary>Four steps / source references</summary>
      <ol class="chapters">${spec.stages.map((phase, index) => `<li><strong>${phase.start}-${(index + 1) * 5}s / ${escapeHtml(phase.title)}</strong><br>${escapeHtml(phase.caption.slice(5))}</li>`).join("")}</ol>
      <p class="source-links">${spec.sources.map(([label, path]) => `<a href="${escapeHtml(path)}">${escapeHtml(label)}</a>`).join(" &middot; ")}</p></details>
  </article>`).join("\n");
  await writeFile(join(here, "architecture.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Five original animated architecture views of Agentic Shiksha, from system context to teaching runtime and evidence flow.">
<title>Agentic Shiksha / Architecture in Motion</title><style>${style}
.atlas-hero { max-width:none; display:grid; grid-template-columns:minmax(0,1fr) 290px; align-items:center; gap:48px; padding-bottom:12px; }
.atlas-hero h1 { font-size:clamp(36px,4.5vw,66px); max-width:950px; }
.atlas-hero .intro { max-width:830px; }
.set-card { border:1px solid #ded9f6; border-radius:20px; padding:26px; background:#eeebff; }
.set-card strong { display:block; font-size:45px; letter-spacing:-1.6px; line-height:1.15; color:#5346e8; }
.set-card p { margin:14px 0 0; color:#5e5780; font-size:14px; }
.level-nav { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; margin:12px 0 28px; }
.level-link { display:grid; gap:5px; border:1px solid #e0e5ef; border-radius:14px; background:white; padding:18px; text-decoration:none; }
.level-link:hover { border-color:#9183ef; background:#f6f3ff; }
.level-link span { font-weight:700; color:#9187bc; font-size:12px; letter-spacing:1px; }
.level-link strong { color:#202941; font-size:15px; }
.level-link small { color:#667085; font-size:12px; }
.legend { display:flex; align-items:center; gap:24px; flex-wrap:wrap; font-size:13px; color:#667085; margin:0 0 30px; }
.legend span { display:flex; align-items:center; gap:8px; }
.legend i { width:20px; height:3px; background:#5346e8; }
.legend .dash { height:0; background:none; border-top:2px dashed #939eaf; }
.legend .packet { width:8px; height:8px; border-radius:50%; }
.sample { padding:26px; }
.sample .eyebrow { margin-bottom:9px; }
.sample h2 { font-size:clamp(22px,2.5vw,30px); }
.chapters { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px 36px; }
.source-links { line-height:2; }
.provenance { margin:10px 0 40px; padding:26px; border:1px solid #e0e5ef; border-radius:14px; background:white; color:#667085; }
.provenance h2 { font-size:22px; color:#202941; }
.provenance code { font-size:13px; }
@media (max-width:900px) { .atlas-hero { grid-template-columns:1fr; gap:8px; }.set-card { display:none; }.level-nav { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (max-width:560px) { .level-nav { grid-template-columns:repeat(2,minmax(0,1fr)); }.sample { padding:14px; }.chapters { grid-template-columns:1fr; }.legend { gap:14px; } }
</style>${iconDataScript}<script src="scenes.js" defer></script><script src="player.js" defer></script></head>
<body><header class="topbar"><div class="wrap"><div class="brand"><span>AS</span> AGENTIC SHIKSHA / ARCHITECTURE IN MOTION</div><a href="index.html">All motion studies</a></div></header>
<main class="wrap"><section class="hero atlas-hero"><div><p class="eyebrow">FROM THE BIG PICTURE TO A SINGLE TURN</p>
<h1>Five views.<br>One learning system.</h1>
<p class="intro">A closer look at Agentic Shiksha, one layer at a time. Soft color groups, moving signals, and four readable steps turn architecture into a story.</p>
<div class="tags"><span>5 looping GIFs</span><span>1280 &times; 720</span><span>20 seconds each</span><span>Editable SVG + 2x PNG</span></div></div>
<aside class="set-card"><strong>Wide view.<br>Then deeper.</strong><p>Three structural zoom levels.<br>Two focused dataflow views.<br>Source-backed, not a live inventory.</p></aside></section>
<div class="downloads"><a href="../architecture/shiksha-azure-architecture-diagrams.zip" download>Download all updated architecture diagrams</a><a href="shiksha-architecture-gifs.zip" download>Download five architecture GIFs</a></div>
<nav class="level-nav" aria-label="Architecture views">${nav}</nav>
<div class="legend" aria-label="Animation legend"><span><i></i> Active step</span><span><i class="packet"></i> Illustrative signal</span><span><i class="dash"></i> Conditional or required boundary</span><span>Previews start paused. Play one at a time.</span></div>
${articles}
<section class="provenance"><h2>Made to explain. Made to reuse.</h2>
<p>These are original source-derived illustrations inspired by the architecture-flow motion study, not interface recordings, participant data, or timing benchmarks. The three levels are presentation zoom levels; the two dataflows are not additional deployment units. Unconfigured services have not been invented.</p>
<p>Azure service nodes embed the unmodified official Microsoft icons in their original colors and proportions. Generic application and pedagogical symbols remain original artwork. <a href="../../images/azure-icons/README.md">Icon sources and usage rules</a> &middot; <a href="../../images/azure-icons/Microsoft_Terms_of_Use.pdf">Microsoft terms</a>.</p>
<p>Use GIF in documents and slides. Choose MP4 for native pause and seek controls, SVG for editing, or PNG for print. The gallery uses the same deterministic vector scenes as the exports and makes no external network requests. Raw GIFs loop continuously; use the paused previews here when reduced motion is preferred.</p>
<p>Regenerate from the repository root: <code>npm --prefix assets\\web\\motion run render-architecture</code>. Add <code>-- --stills-only</code> for a quick layout pass. The existing media FFmpeg and frontend Playwright installations are reused; no application server or Azure credentials are needed.</p>
<p><a href="../../../docs/architecture.md">Architecture documentation</a> &middot; <a href="../architecture/index.html">Detailed static atlas</a> &middot; <a href="scenes.js">Editable motion source</a> &middot; <a href="generate.mjs">Export and verification code</a></p></section>
<footer>Source snapshot: 30 September 2026 / Original diagrams / Synthetic, illustrative timing / No cloud resources changed.</footer></main>
<div id="export-stage" hidden></div></body></html>
`);
  allOutputs.push("architecture.html");
}

async function publishTutorialCollection() {
  const tutorials = [];
  const videoHashes = new Set();
  for (const definition of tutorialDefinitions) {
    const metadata = JSON.parse(await readFile(join(here, `${definition.name}.json`), "utf8"));
    assert.equal(metadata.name, definition.name);
    assert.equal(metadata.projectName, "Agentic Shiksha");
    assert.equal(metadata.width, definition.id === "student-teacher" ? 2656 : 1360);
    assert.equal(metadata.height, definition.id === "student-teacher" ? 976 : 928);
    assert.deepEqual(metadata.headerStyle, { background: "#EDE9FE", text: "#30264D", badge: false },
      `${definition.name} must use the lavender header without the old badge`);
    assert.equal(metadata.presentation?.configuredCourseStarters, definition.role === "Administrator" ? 0 : 4,
      `${definition.name} must respect the course starter rule where applicable`);
    if (definition.role === "Administrator") {
      assert.equal(metadata.source, "Admin-Dashboard/frontend", "Admin demos must use the real standalone admin app");
      assert.equal(metadata.presentation.starterRuleApplicable, false);
    }
    if (definition.role.startsWith("Learner")) {
      assert(metadata.presentation.verifiedWelcomeScreens > 0, `${definition.name} must verify four visible starter buttons`);
    }
    if (["chat", "documents", "slides", "circuits", "challenges", "student-teacher", "memory", "image-generation"].includes(definition.id)) {
      assert(metadata.presentation.assetChecks.length > 0
        && metadata.presentation.assetChecks.every((check) => check.navigationCollapsed === true),
      `${definition.name} must verify collapsed navigation before opening assets`);
    }
    if (definition.id === "student-teacher") {
      assert.deepEqual(metadata.linkedUsage.map((snapshot) => snapshot.submittedChecks), [0, 1],
        "The paired recording must reflect the learner's actual simulated submission");
      assert.equal(metadata.layout, "side-by-side");
    }
    if (definition.id === "image-generation") {
      const evidence = metadata.verification;
      assert.equal(evidence?.feature, "image-generation");
      assert.equal(evidence.nativeUI, true);
      assert.equal(evidence.tool, "generate_image");
      for (const check of ["placeholderVerified", "previewVerified", "navigationCollapsedBeforeImage", "sameConversationFollowup", "imageInSyncedHistory"]) {
        assert.equal(evidence[check], true, `Image-generation recording must verify ${check}`);
      }
      assert.equal(evidence.realModelCalls, 0);
      assert.equal(evidence.image.width, 1536);
      assert.equal(evidence.image.height, 1024);
      assert.equal(evidence.image.sha256, createHash("sha256")
        .update(await readFile(assetPath("shiksha-image-generation-example.png"))).digest("hex"),
      "The published illustration must match the image displayed and verified in the actual UI");
    }
    if (definition.id === "memory") {
      assert.equal(metadata.verification?.feature, "custom-learner-memory");
      const snapshots = metadata.verification.snapshots;
      assert(snapshots.some((state) => state.version === 1 && state.pending === 0));
      assert(snapshots.some((state) => state.version === 1 && state.pending === 1));
      assert(snapshots.some((state) => state.version === 2 && state.pending === 0
        && state.concept === "PROGRESSING" && state.misconception === "RESOLVING"));
      assert(snapshots.every((state) => state.crossing === "NOT_CROSSED"));
      assert.equal(metadata.verification.noAutomaticMasteryOrCrossing, true);
    }
    if (definition.id === "onboarding-profile") {
      assert.equal(metadata.verification?.feature, "onboarding-profile");
      assert.equal(metadata.verification.completedOnboarding, true);
      assert(metadata.verification.writesVerified >= 2, "Onboarding and a later profile edit must be saved through the UI");
    }
    if (definition.id === "teacher-roster") {
      assert.equal(metadata.verification?.readOnly, true);
      assert.equal(metadata.verification.navigationCollapsedBeforeAsset, true);
      assert(metadata.verification.openedAssetId, "The roster demo must open actual saved work");
    }
    if (definition.id === "teacher-usage") {
      assert.equal(metadata.verification?.readOnly, true);
      assert.equal(metadata.verification.distributionSuppressed, true);
      assert(metadata.verification.analyticsQueries.some((query) => query.query.includes("granularity=week")),
        "The usage demo must exercise weekly grouping");
    }
    if (definition.id === "admin-overview") {
      assert.equal(metadata.verification?.nativeUI, true);
      assert.equal(metadata.verification.readOnly, true);
      assert.equal(metadata.verification.search.shareUnchanged, true);
      assert.equal(metadata.verification.reportingPeriods.length, 2);
    }
    if (definition.id === "admin-assignments") {
      assert.equal(metadata.verification?.syntheticWrites, 1);
      assert.equal(metadata.verification.realWrites, 0);
      assert.equal(metadata.verification.confirmationControl, "Save assignments");
      assert.equal(metadata.verification.directoryMembershipVisible, true);
      assert.equal(metadata.verification.reopenedRosterVerified, true);
      assert.equal(metadata.verification.otherCoursesUnchanged, true);
    }
    assert(metadata.duration >= 20 && metadata.duration <= 60, `${definition.name} must be a readable 20-60 second tutorial`);
    assert(metadata.chapters.length >= 4, `${definition.name} must have at least four distinct steps`);
    for (const extension of ["mp4", "gif", "png", "vtt"]) {
      const data = await readFile(assetPath(`${definition.name}.${extension}`));
      assert(data.length > 0, `${definition.name}.${extension} is empty`);
      if (extension === "mp4") videoHashes.add(createHash("sha256").update(data).digest("hex"));
    }
    tutorials.push({ ...definition, ...metadata });
  }
  assert.equal(tutorials.length, tutorialDefinitions.length);
  assert.equal(videoHashes.size, tutorials.length, "Every video must be a distinct recording");
  const cards = `<section id="demo-collection" aria-label="${tutorials.length} video demos"><div class="demo-grid">${tutorials.map((tutorial, i) =>
    `<a class="demo-card" href="#${tutorial.id}"><img src="${assetUrl(`${tutorial.name}.png`)}" width="${tutorial.width}" height="${tutorial.height}" alt=""><span class="demo-meta">${String(i + 1).padStart(2, "0")} / ${tutorial.role} / ${Math.round(tutorial.duration)}s</span><strong>${escapeHtml(tutorial.title)}</strong></a>`).join("")}</div></section>`;
  const articles = tutorials.map((tutorial, i) => `<article class="sample" id="${tutorial.id}" data-tutorial="${tutorial.name}">
    <header><div><p class="eyebrow">${String(i + 1).padStart(2, "0")} / ACTUAL ${tutorial.role.toUpperCase()} INTERFACE / ${Math.round(tutorial.duration)} SECONDS</p><h2>${escapeHtml(tutorial.title)}</h2></div>
      <div class="downloads"><a href="${tutorial.name}.mp4" download>MP4</a><a href="${assetUrl(`${tutorial.name}.gif`)}" download>GIF</a><a href="${assetUrl(`${tutorial.name}.png`)}" download>Still PNG</a><a href="${tutorial.name}.vtt" download>Captions</a></div></header>
    <video class="recording" style="aspect-ratio:${tutorial.width}/${tutorial.height}" controls loop playsinline preload="metadata" poster="${assetUrl(`${tutorial.name}.png`)}" aria-label="${escapeHtml(tutorial.title)} - actual Agentic Shiksha demo" aria-describedby="${tutorial.id}-note"><source src="${tutorial.name}.mp4" type="video/mp4">Use the download links above to watch this demo.</video>
    <p class="note" id="${tutorial.id}-note">${escapeHtml(tutorial.note)}</p>
    <details><summary>Transcript and timings</summary><ol>${tutorial.chapters.map((chapter) =>
      `<li><strong>${chapter.start.toFixed(1)}-${chapter.end.toFixed(1)}s:</strong> ${escapeHtml(chapter.caption.replace(/^\d{1,2}(?:\.|\s)\s*/, ""))}</li>`).join("")}</ol>
      <p>Actual React interface, scripted local data and responses. The pointer and caption frame are added for clarity; timing is not a latency benchmark.</p></details>
  </article>`).join("\n");
  const indexPath = join(here, "index.html");
  let html = await readFile(indexPath, "utf8");
  const marker = /<!-- platform-demos:start -->[\s\S]*?<!-- platform-demos:end -->/;
  assert(marker.test(html), "The media gallery must retain its generated tutorial region");
  html = html.replace(marker, `<!-- platform-demos:start -->\n${cards}\n${articles}\n<!-- platform-demos:end -->`);
  await writeFile(indexPath, html);
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert(style, "Gallery styling is missing");
  await writeFile(join(here, "demos.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agentic Shiksha / ${tutorials.length} Video Demos</title><style>${style}</style><script src="player.js" defer></script></head>
<body><header class="topbar"><div class="wrap"><div class="brand"><span>AS</span> AGENTIC SHIKSHA / VIDEO DEMOS</div><span>${tutorials.length} real-interface walkthroughs</span></div></header>
<main class="wrap"><section class="hero"><p class="eyebrow">LEARNER. TEACHER. ADMINISTRATOR.</p><h1>${tutorials.length} ways to explore<br>Agentic Shiksha.</h1>
<p class="intro">Now with image generation: request a learning illustration, inspect it and ask a follow-up. Explore course chat, learner memory, onboarding, teacher dashboards and the separate Admin Dashboard too. All videos use the real interfaces with synthetic records and locally simulated responses. Choose a demo below; playback starts only when you press Play.</p>
<div class="tags"><span>Actual website UI</span><span>Four course starters</span><span>Asset-focused layout</span><span>MP4 + GIF</span><span>No live learner data</span></div></section>
${cards}${articles}<footer>Agentic Shiksha / 30 September 2026. Original recordings of the actual frontend with local fixtures. No cloud resources or live learner records were changed.</footer></main></body></html>\n`);
  await writeFile(join(here, "tutorials.json"), JSON.stringify({
    projectName: "Agentic Shiksha", count: tutorials.length, generatedOn: "2026-09-30",
    tutorials: tutorials.map(({ id, name, title, role, duration, width, height, note, chapters, presentation, layout, linkedUsage, headerStyle, verification, source }) => ({
      id, name, title, role, duration, width, height, note, chapters, presentation, layout, linkedUsage, headerStyle, verification, source,
    })),
  }, null, 2) + "\n");
  return tutorials;
}

function encode(argv) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", ...argv], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `FFmpeg failed:\n${result.stderr}`);
  return result.stdout;
}

function gifMetadata(data) {
  assert.match(data.subarray(0, 6).toString(), /^GIF8[79]a$/);
  const width = data.readUInt16LE(6), height = data.readUInt16LE(8);
  let p = 13 + (data[10] & 128 ? 3 * 2 ** ((data[10] & 7) + 1) : 0);
  let frames = 0, centiseconds = 0, delay = 0, loop = null, ended = false;
  function blocks() {
    const chunks = [];
    while (p < data.length) {
      const length = data[p++];
      if (length === 0) return Buffer.concat(chunks);
      assert(p + length <= data.length, "Truncated GIF extension or image block");
      chunks.push(data.subarray(p, p + length));
      p += length;
    }
    throw new Error("GIF sub-block terminator is missing");
  }
  while (p < data.length) {
    const kind = data[p++];
    if (kind === 0x3b) { ended = true; break; }
    if (kind === 0x21) {
      const type = data[p++];
      if (type === 0xf9) {
        assert.equal(data[p], 4);
        delay = data.readUInt16LE(p + 2);
        p += 6;
      } else if (type === 0xff) {
        const size = data[p++];
        const name = data.subarray(p, p + size).toString();
        p += size;
        const value = blocks();
        if (name === "NETSCAPE2.0" && value[0] === 1) loop = value.readUInt16LE(1);
      } else {
        blocks();
      }
    } else if (kind === 0x2c) {
      assert(p + 9 <= data.length, "Truncated GIF image descriptor");
      const packed = data[p + 8];
      p += 9 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      p++;
      blocks();
      frames++;
      centiseconds += delay;
      delay = 0;
    } else {
      throw new Error(`Unexpected GIF block 0x${kind.toString(16)}`);
    }
  }
  assert(ended, "GIF trailer is missing");
  return { width, height, frames, duration: centiseconds / 100, loop };
}

function decodeAndVerify(filename, expectedFrames, dimensions) {
  const result = encode(["-i", filename, "-an", "-vsync", "0", "-f", "framemd5", "-"]);
  assert(result.includes(dimensions), `${basename(filename)} dimensions do not match ${dimensions}`);
  const hashes = result.split(/\r?\n/).filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").at(-1).trim());
  assert.equal(hashes.length, expectedFrames, `${basename(filename)} decoded frame count`);
  assert(new Set(hashes).size > 25, `${basename(filename)} must contain changing visual frames`);
  return new Set(hashes).size;
}

async function checkPng(filename, width, height) {
  const data = await readFile(filename);
  assert.equal(data.subarray(1, 4).toString(), "PNG");
  assert.equal(data.readUInt32BE(16), width);
  assert.equal(data.readUInt32BE(20), height);
}

async function checkLayout(page, name, kind) {
  const failures = await page.evaluate(({ expected, icons }) => {
    const issues = [];
    const svg = document.querySelector("#export-stage svg") || document.querySelector("svg");
    if (!svg || document.querySelector("parsererror")) return ["Missing or invalid SVG"];
    const bounds = svg.getBoundingClientRect();
    const scale = bounds.width / svg.viewBox.baseVal.width;
    const texts = [...svg.querySelectorAll("text")].filter((node) => {
      const group = node.closest("[opacity]");
      return !group || Number(group.getAttribute("opacity")) > 0.1;
    });
    for (const node of texts) {
      if (/AGENTIC SHIKSHA\s*\/|^\s*AS\s*$|\/\s*\d+\s*SEC\s*$/i.test(node.textContent)) {
        issues.push(`Repeated branding header or top badge: ${node.textContent}`);
      }
      const b = node.getBoundingClientRect();
      if (b.left < bounds.left || b.right > bounds.right || b.top < bounds.top || b.bottom > bounds.bottom) {
        issues.push(`Label outside canvas: ${node.textContent}`);
      }
    }
    const serviceImages = [...svg.querySelectorAll("image[data-azure-icon]")];
    if (JSON.stringify(serviceImages.map(node => node.dataset.azureIcon)) !== JSON.stringify(expected)) {
      issues.push("Official icon selection differs from the declared service nodes");
    }
    for (const image of serviceImages) {
      const icon = icons[image.dataset.azureIcon];
      if (!icon || image.getAttribute("href") !== icon.dataUri
        || image.getAttribute("preserveAspectRatio") !== "xMidYMid meet") {
        issues.push(`Altered or missing original icon: ${image.dataset.azureIcon}`);
      }
      const b = image.getBoundingClientRect();
      if (b.width <= 0 || Math.abs(b.width - b.height) > scale
        || b.left < bounds.left || b.right > bounds.right || b.top < bounds.top || b.bottom > bounds.bottom) {
        issues.push(`Icon outside canvas or distorted: ${image.dataset.azureIcon}`);
      }
      for (const label of texts) {
        const t = label.getBoundingClientRect();
        if (Math.min(b.right, t.right) - Math.max(b.left, t.left) > scale
          && Math.min(b.bottom, t.bottom) - Math.max(b.top, t.top) > scale) {
          issues.push(`Icon overlaps label: ${image.dataset.azureIcon} / ${label.textContent}`);
        }
      }
    }
    for (const group of svg.querySelectorAll("[data-fit]")) {
      const x = bounds.left + Number(group.dataset.x) * scale;
      const y = bounds.top + Number(group.dataset.y) * scale;
      const w = Number(group.dataset.w) * scale;
      const h = Number(group.dataset.h) * scale;
      for (const node of group.querySelectorAll("text")) {
        const b = node.getBoundingClientRect();
        if (b.left < x + 5 * scale || b.right > x + w - 5 * scale || b.top < y + 2 * scale || b.bottom > y + h - 2 * scale) {
          issues.push(`Label does not fit ${group.dataset.fit}: ${node.textContent}`);
        }
      }
    }
    for (let i = 0; i < texts.length; i++) {
      const a = texts[i].getBoundingClientRect();
      for (let j = i + 1; j < texts.length; j++) {
        const b = texts[j].getBoundingClientRect();
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > scale
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > scale) {
          issues.push(`Overlapping labels: ${texts[i].textContent} / ${texts[j].textContent}`);
        }
      }
    }
    return issues;
  }, { expected: expectedServiceIcons[kind], icons: azureServiceIcons });
  assert.deepEqual(failures, [], `${name} failed layout checks:\n${failures.join("\n")}`);
}

async function renderPosters(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  for (const kind of Object.keys(files)) {
    const spec = motion.scenes[kind];
    const file = join(imageDir, files[kind]);
    await writeFile(`${file}.svg`, motion.render(kind, spec.poster) + "\n");
    await page.goto(pathToFileURL(`${file}.svg`).href);
    await checkLayout(page, `${kind} poster`, kind);
    await page.screenshot({ path: `${file}.png` });
    await checkPng(`${file}.png`, 2560, 1440);
    allOutputs.push(`${files[kind]}.svg`, `${files[kind]}.png`);
  }
  if (!architectureOnly) {
    const research = resolve(root, "assets", "images", "research");
    const banner = await readFile(join(research, "shiksha-research-banner.svg"), "utf8");
    await writeFile(assetPath("shiksha-research-banner.svg"), banner);
    await writeFile(assetPath("shiksha-research-banner.png"), await readFile(join(research, "shiksha-research-banner.png")));
    await page.goto(pathToFileURL(assetPath("shiksha-research-banner.svg")).href);
    assert.equal(await page.locator("parsererror").count(), 0, "Compatibility banner must be valid SVG");
    allOutputs.push("shiksha-research-banner.svg", "shiksha-research-banner.png");
  }
  await context.close();
  console.log(`Verified ${Object.keys(files).length} scene posters and editable SVGs.`);
}

async function renderVideo(browser, kind) {
  const spec = motion.scenes[kind];
  const work = await mkdtemp(join(tmpdir(), `shiksha-motion-${kind}-`));
  const created = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const mp4 = assetPath(`${files[kind]}.mp4`);
  const gif = assetPath(`${files[kind]}.gif`);
  const gifWidth = architectureOnly ? 1280 : 1024;
  const gifHeight = architectureOnly ? 720 : 576;
  try {
    const url = pathToFileURL(join(here, "index.html"));
    url.searchParams.set("export", kind);
    await page.goto(url.href);
    await page.waitForFunction(() => typeof globalThis.renderFrame === "function");
    for (const time of stamps[kind]) {
      await page.evaluate((value) => globalThis.renderFrame(value), time);
      await checkLayout(page, `${kind} at ${time}s`, kind);
    }
    if (stillsOnly) return;
    const count = FPS * spec.duration;
    for (let i = 0; i < count; i++) {
      await page.evaluate((time) => globalThis.renderFrame(time), i / FPS);
      const frame = join(work, `frame-${String(i).padStart(4, "0")}.png`);
      await page.screenshot({ path: frame, animations: "disabled" });
      created.push(frame);
      if (i % 96 === 0) console.log(`Rendering ${kind}: ${i}/${count} frames`);
    }
    encode(["-framerate", String(FPS), "-i", join(work, "frame-%04d.png"),
      "-frames:v", String(count), "-an", "-c:v", "libx264", "-threads", "2",
      "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
    const palette = join(work, "palette.png");
    // Flat-color diagrams stay cleaner when the GIF avoids the lossy MP4 intermediate.
    const gifInput = architectureOnly
      ? ["-framerate", String(FPS), "-i", join(work, "frame-%04d.png")]
      : ["-i", mp4];
    const paletteSettings = architectureOnly ? "max_colors=256:stats_mode=full" : "max_colors=192:stats_mode=diff";
    const dither = architectureOnly ? "none" : "bayer:bayer_scale=3";
    encode([...gifInput, "-vf", `fps=${GIF_FPS},scale=${gifWidth}:${gifHeight}:flags=lanczos,palettegen=${paletteSettings}`,
      "-frames:v", "1", palette]);
    created.push(palette);
    encode([...gifInput, "-i", palette, "-filter_complex_threads", "1", "-lavfi",
      `fps=${GIF_FPS},scale=${gifWidth}:${gifHeight}:flags=lanczos[x];[x][1:v]paletteuse=dither=${dither}:diff_mode=rectangle`,
      "-loop", "0", "-gifflags", "+transdiff", gif]);
    const metadata = gifMetadata(await readFile(gif));
    assert.deepEqual(metadata, { width: gifWidth, height: gifHeight, frames: GIF_FPS * spec.duration, duration: spec.duration, loop: 0 });
    const gifUnique = decodeAndVerify(gif, GIF_FPS * spec.duration, `${gifWidth}x${gifHeight}`);
    const mp4Unique = decodeAndVerify(mp4, count, "1280x720");
    const size = (await readFile(gif)).length;
    assert(size < 8 * 1024 * 1024, `${kind} GIF exceeds the 8 MiB target`);
    allOutputs.push(`${files[kind]}.mp4`, `${files[kind]}.gif`);
    if (architectureOnly) architectureResults.push({
      id: kind, name: spec.name, file: assetUrl(`${files[kind]}.gif`), ...metadata,
      fps: GIF_FPS, bytes: size, distinctFrames: gifUnique,
      sha256: createHash("sha256").update(await readFile(gif)).digest("hex"),
      phases: spec.stages, sources: spec.sources,
    });
    console.log(`Verified ${kind}: ${spec.duration}s, ${metadata.frames} GIF frames, infinite loop, ${(size / 1048576).toFixed(2)} MiB; ${gifUnique}/${mp4Unique} distinct decoded GIF/MP4 frames.`);
  } finally {
    await context.close();
    for (const filename of created) await unlink(filename);
    const leftovers = await readdir(work);
    assert.equal(leftovers.length, 0, `Unexpected render files left in ${work}`);
    await rmdir(work);
  }
}

async function verifyArchitectureGallery(browser) {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https?:/, route => {
    errors.push(`Unexpected network request: ${route.request().url()}`);
    return route.abort();
  });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(pathToFileURL(join(here, "architecture.html")).href);
    await page.waitForFunction(() => document.querySelectorAll(".viewport svg").length === 5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px gallery overflow`);
    assert.equal(await page.locator('[data-play][aria-pressed="true"]').count(), 0, "Gallery must start paused");
    for (const [id, spec] of architectureEntries) {
      const player = page.locator(`[data-player="${id}"]`);
      for (const phase of spec.stages) {
        await player.locator("input").fill(String(phase.start + 1.2));
        assert.equal(await player.locator("[data-status]").innerText(), `Step ${phase.start / 5 + 1}: ${phase.title}`);
        assert(await player.locator("svg text").allTextContents().then(labels => labels.includes(phase.caption)));
      }
    }
    const first = page.locator("[data-player]").first();
    const second = page.locator("[data-player]").nth(1);
    await first.locator("input").fill("1");
    await first.locator("[data-play]").click();
    await page.waitForFunction(() => Number(document.querySelector("[data-player] input").value) > 1.2);
    await second.locator("[data-play]").click();
    assert.equal(await first.locator("[data-play]").getAttribute("aria-pressed"), "false", "Only one player may run");
    await second.locator("[data-play]").click();
    const stopped = await second.locator("input").inputValue();
    await page.waitForTimeout(180);
    assert.equal(await second.locator("input").inputValue(), stopped, "Paused animation must not advance");
    await second.locator("[data-replay]").focus();
    await page.keyboard.press("Enter");
    assert.equal(await second.locator("[data-play]").getAttribute("aria-pressed"), "true", "Replay must be keyboard accessible");
    await second.locator("[data-play]").click();
  }
  const links = await page.locator("a[href]").evaluateAll(elements => elements.map(element => element.getAttribute("href")));
  for (const href of links) {
    if (href.startsWith("#")) {
      assert.equal(await page.locator(href).count(), 1, `Broken gallery anchor: ${href}`);
    } else if (!stillsOnly || !/\.(gif|mp4)$/.test(href)) {
      const file = fileURLToPath(new URL(href, pathToFileURL(join(here, "architecture.html"))));
      assert((await readFile(file)).length > 0, `Missing gallery link: ${href}`);
    }
  }
  const duplicates = await page.locator("[id]").evaluateAll(elements =>
    elements.map(element => element.id).filter((id, index, ids) => ids.indexOf(id) !== index));
  assert.deepEqual(duplicates, []);
  assert.deepEqual(errors, [], "Architecture gallery errors");
  await context.close();
  console.log("Verified five architecture players at 1440/390/320px, all phases, keyboard replay, pause, seeking, local links, and no external requests.");
}

async function verifyGallery(browser, tutorials) {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) errors.push(`Unexpected network request: ${request.url()}`);
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(pathToFileURL(join(here, "index.html")).href);
    await page.waitForFunction(() => document.querySelectorAll(".viewport svg").length === 1);
    await page.evaluate(async () => {
      await Promise.all([...document.images].map((image) => { image.loading = "eager"; return image.decode(); }));
      await Promise.all([...document.querySelectorAll("video")].map((video) => video.readyState >= 1
        ? Promise.resolve() : new Promise((resolve, reject) => {
          video.addEventListener("loadedmetadata", resolve, { once: true });
          video.addEventListener("error", () => reject(new Error("Tutorial video failed to load")), { once: true });
        })));
    });
    const state = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      players: document.querySelectorAll(".viewport svg").length,
      playing: document.querySelectorAll('[data-play][aria-pressed="true"]').length,
      images: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
      videos: [...document.querySelectorAll("video")].map((video) => ({
        paused: video.paused, width: video.videoWidth, height: video.videoHeight,
        durationInRange: video.duration >= 20 && video.duration <= 60,
      })),
      brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].filter((link) => !document.getElementById(link.hash.slice(1))).length,
      duplicateIds: [...document.querySelectorAll("[id]")].map((node) => node.id).filter((id, i, ids) => ids.indexOf(id) !== i),
    }));
    assert.deepEqual(state, { overflow: false, players: 1, playing: 0, images: true,
      videos: tutorials.map(({ width, height }) => ({ paused: true, width, height, durationInRange: true })),
      brokenAnchors: 0, duplicateIds: [] });
    for (let index = 0; index < tutorials.length; index++) {
      const video = page.locator("video").nth(index);
      const duration = await video.evaluate((element) => element.duration);
      assert(Math.abs(duration - tutorials[index].duration) < 0.1, "Video duration must match its real recording metadata");
    }
    const flowRoot = page.locator('[data-player="flow"]');
    await page.locator("video").first().evaluate((video) => video.play());
    await page.waitForFunction(() => document.querySelector("video").currentTime > 0.2);
    await page.locator("video").first().evaluate((video) => video.pause());
    const stopped = await page.locator("video").first().evaluate((video) => video.currentTime);
    await page.waitForTimeout(180);
    assert.equal(await page.locator("video").first().evaluate((video) => video.currentTime), stopped, "Paused video must not advance");
    await page.locator("video").first().evaluate((video) => { video.currentTime = 25; });
    await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 25) < 0.1);
    await page.locator("video").first().evaluate((video) => video.play());
    await page.locator("video").nth(1).evaluate((video) => video.play());
    assert.equal(await page.locator("video").first().evaluate((video) => video.paused), true);
    await flowRoot.locator("[data-replay]").click();
    assert.equal(await page.locator("video").nth(1).evaluate((video) => video.paused), true);
    await page.waitForFunction(() => Number(document.querySelector('[data-player="flow"] input').value) > 0.2);
    await flowRoot.locator("[data-play]").click();
    await flowRoot.locator("input").fill("12.5");
    assert.match(await flowRoot.locator("[data-status]").innerText(), /Learning outputs/);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(pathToFileURL(join(here, "demos.html")).href);
    await page.waitForFunction(() => [...document.querySelectorAll("video")].every((video) => video.readyState >= 1));
    const standalone = await page.evaluate(() => ({
      count: document.querySelectorAll("video").length,
      paused: [...document.querySelectorAll("video")].every((video) => video.paused),
      overflow: document.documentElement.scrollWidth > innerWidth,
      anchors: [...document.querySelectorAll('a[href^="#"]')].every((link) => document.getElementById(link.hash.slice(1))),
    }));
    assert.deepEqual(standalone, { count: tutorials.length, paused: true, overflow: false, anchors: true });
  }
  assert.deepEqual(errors, [], "Gallery must have no script errors or external network requests");
  await context.close();
  console.log(`Verified both ${tutorials.length}-video galleries, role-specific sources, exact dimensions/durations, MP4 playback, pause/seek, responsive layout and one-player policy.`);
}

await mkdir(here, { recursive: true });
await mkdir(imageDir, { recursive: true });
if (!tutorialsOnly) await publishIconData();
const browser = await chromium.launch({ headless: true });
try {
  const tutorials = architectureOnly ? [] : await publishTutorialCollection();
  if (architectureOnly) await publishArchitectureGallery();
  if (!tutorialsOnly) {
    await renderPosters(browser);
    for (const kind of Object.keys(files)) await renderVideo(browser, kind);
  }
  if (architectureOnly) {
    await verifyArchitectureGallery(browser);
    if (!stillsOnly) {
      assert.equal(architectureResults.length, 5);
      assert.equal(new Set(architectureResults.map(result => result.sha256)).size, 5, "GIFs must be distinct");
      await writeFile(join(here, "architecture-manifest.json"), JSON.stringify({
        project: "Agentic Shiksha", snapshot: "2026-09-30",
        provenance: "Original source-derived diagram layout with unmodified official Microsoft Azure service icons; not a live inventory or performance benchmark.",
        iconSource: "https://learn.microsoft.com/en-us/azure/architecture/icons/",
        gifs: architectureResults,
      }, null, 2) + "\n");
      allOutputs.push("architecture-manifest.json");
    }
  } else {
    await verifyGallery(browser, tutorials);
  }
} finally {
  await browser.close();
}
for (const filename of allOutputs) {
  const data = await readFile(assetPath(filename));
  console.log(`${filename}: ${data.length} bytes / SHA-256 ${createHash("sha256").update(data).digest("hex").slice(0, 16)}`);
}
console.log(tutorialsOnly ? "Tutorial galleries passed verification; existing recordings, diagrams and banners were not regenerated."
  : stillsOnly ? "Stills and all scene-layout checkpoints passed." : "All animated and static outputs passed verification.");
