import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assetPath, imageDir } from "./asset-paths.mjs";
import { installDemo, agentId, courseName, courseDraft, courseStarters, lesson, question, quizId } from "./platform-demo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const frontendRequire = createRequire(join(resolve(here, "..", "..", ".."), "Agentic Shiksha Platform", "Frontend", "package.json"));
const { chromium, expect } = frontendRequire("@playwright/test");
const ffmpeg = require("@ffmpeg-installer/ffmpeg").path;
const baseURL = process.env.TUTORIAL_BASE_URL || "http://127.0.0.1:4188";
const base = new URL(baseURL);
assert(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname), "Tutorials only run against a local HTTP frontend");
const adminBaseURL = process.env.TUTORIAL_ADMIN_BASE_URL || "http://127.0.0.1:4190";
const adminBase = new URL(adminBaseURL);
assert(adminBase.protocol === "http:" && ["localhost", "127.0.0.1"].includes(adminBase.hostname),
  "Admin tutorials only run against a local HTTP frontend");
function parseOptions(args) {
  let inspect = false;
  let checkFlow = false;
  let selected = null;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--inspect") inspect = true;
    else if (argument === "--check-flow") checkFlow = true;
    else {
      assert.equal(selected, null, "Choose only one demo selector");
      if (argument === "--learner") selected = ["learner"];
      else if (argument === "--teacher") selected = ["teacher"];
      else if (argument === "--additional") selected = ["answer-depth", "documents", "preferences", "companion-review", "slides", "circuits"];
      else if (argument === "--all") selected = ["learner", "teacher", "answer-depth", "documents", "preferences", "companion-review", "slides", "circuits", "challenges", "student-teacher", "memory", "onboarding-profile", "teacher-roster", "teacher-usage", "admin-overview", "admin-assignments", "image-generation"];
      else if (argument === "--demo") {
        assert(args[index + 1] && !args[index + 1].startsWith("--"), "--demo requires a name or comma-separated names");
        selected = args[++index].split(",");
      } else throw new Error(`Unknown recorder argument: ${argument}`);
    }
  }
  return { inspect, checkFlow, selected };
}
const FPS = 12;
const WIDTH = 1360;
const HEIGHT = 928;
const HEADER_COLOR = "0xEDE9FE";
const HEADER_TEXT = "0x30264D";

function encode(args) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", ...args], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Encoding failed:\n${result.stderr}`);
  return result.stdout;
}

function timecode(seconds, separator = ",") {
  const millis = Math.round(seconds * 1000);
  return `${String(Math.floor(millis / 3600000)).padStart(2, "0")}:${String(Math.floor(millis / 60000) % 60).padStart(2, "0")}:${String(Math.floor(millis / 1000) % 60).padStart(2, "0")}${separator}${String(millis % 1000).padStart(3, "0")}`;
}

class Recorder {
  constructor(page, folder, name, title, dryRun = false, pairedPage = null) {
    this.page = page; this.folder = folder; this.name = name; this.title = title;
    this.primaryPage = page;
    this.pairedPage = pairedPage;
    this.width = pairedPage ? 2656 : WIDTH;
    this.height = pairedPage ? 976 : HEIGHT;
    this.frames = 0; this.created = []; this.chapters = []; this.x = 25; this.y = 25; this.posterTime = 0;
    this.dryRun = dryRun;
    this.starterChecks = 0;
    this.assetChecks = [];
    this.startersApplicable = true;
  }
  async installCursor(page = this.page) {
    await page.evaluate(() => {
      const cursor = document.createElement("div");
      cursor.id = "tutorial-pointer";
      cursor.setAttribute("aria-hidden", "true");
      cursor.style.cssText = "position:fixed;left:25px;top:25px;width:26px;height:32px;z-index:2147483647;pointer-events:none";
      cursor.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="32" viewBox="0 0 26 32"><path d="M2 2v23l6-6 5 10 5-3-5-9h10z" fill="white" stroke="#252536" stroke-width="1.5"/></svg>';
      document.body.append(cursor);
      document.addEventListener("fullscreenchange", () => (document.fullscreenElement || document.body).append(cursor));
    });
  }
  async activate(page) {
    assert(page === this.primaryPage || page === this.pairedPage, "Only this recording's browser pages may be activated");
    this.page = page;
    for (const candidate of [this.primaryPage, this.pairedPage].filter(Boolean)) {
      await candidate.evaluate((active) => {
        const cursor = document.getElementById("tutorial-pointer");
        if (cursor) cursor.style.visibility = active ? "visible" : "hidden";
      }, candidate === page);
    }
    this.x = 25;
    this.y = 25;
  }
  async hold(seconds) {
    const count = Math.max(1, Math.round(seconds * FPS));
    if (this.dryRun) {
      this.frames += count;
      await this.page.waitForTimeout(Math.min(200, count * 12));
      return;
    }
    for (let i = 0; i < count; i++) {
      const file = join(this.folder, `frame-${String(this.frames).padStart(5, "0")}.png`);
      const captures = [this.primaryPage.screenshot({ path: file, animations: "allow" })];
      this.created.push(file);
      if (this.pairedPage) {
        const paired = join(this.folder, `teacher-${String(this.frames).padStart(5, "0")}.png`);
        captures.push(this.pairedPage.screenshot({ path: paired, animations: "allow" }));
        this.created.push(paired);
      }
      await Promise.all(captures);
      this.frames++;
    }
  }
  async chapter(caption, action) {
    const start = this.frames / FPS;
    await action();
    this.chapters.push({ start, end: this.frames / FPS, caption });
    console.log(`${this.name}: ${caption} (${(this.frames / FPS).toFixed(1)}s)`);
  }
  async move(locator) {
    await locator.scrollIntoViewIfNeeded();
    const target = await locator.boundingBox();
    assert(target, "Tutorial target must be visible");
    const startX = this.x, startY = this.y;
    const endX = target.x + target.width / 2, endY = target.y + target.height / 2;
    for (let i = 1; i <= 6; i++) {
      const ratio = i / 6;
      this.x = startX + (endX - startX) * ratio;
      this.y = startY + (endY - startY) * ratio;
      await this.page.mouse.move(this.x, this.y);
      await this.page.evaluate(({ x, y }) => {
        const pointer = document.getElementById("tutorial-pointer");
        pointer.style.left = `${x}px`; pointer.style.top = `${y}px`;
      }, { x: this.x, y: this.y });
      await this.hold(1 / FPS);
    }
  }
  async click(locator) {
    await this.move(locator);
    await locator.click();
    await this.hold(0.35);
  }
  async type(locator, value, seconds = 3) {
    await this.click(locator);
    const count = Math.round(seconds * FPS);
    let previous = 0;
    for (let i = 1; i <= count; i++) {
      const next = Math.round(value.length * i / count);
      if (next > previous) await locator.pressSequentially(value.slice(previous, next));
      previous = next;
      await this.hold(1 / FPS);
    }
  }
  async finish() {
    const duration = this.frames / FPS;
    const captions = this.chapters.map((chapter, i) => `${i + 1}\n${timecode(chapter.start)} --> ${timecode(chapter.end)}\n${chapter.caption}\n`).join("\n");
    const srt = join(this.folder, "captions.srt");
    await writeFile(srt, captions);
    this.created.push(srt);
    const pathForFilter = (path) => path.replace(/\\/g, "/").replace(/:/g, "\\:");
    const font = pathForFilter(join(process.env.WINDIR || "C:\\Windows", "Fonts", "segoeui.ttf"));
    const output = (extension) => assetPath(`${this.name}.${extension}`);
    const filter = [
      `pad=${this.width}:${this.height}:40:${this.pairedPage ? 112 : 64}:color=0x0c111b`,
      `drawbox=x=0:y=0:w=iw:h=64:color=${HEADER_COLOR}:t=fill`,
      `drawtext=fontfile='${font}':text='Agentic Shiksha  /  ${this.title}':x=40:y=20:fontsize=22:fontcolor=${HEADER_TEXT}`,
      ...(this.pairedPage ? [
        `drawtext=fontfile='${font}':text='LEARNER  /  COURSE CHAT + PRACTICE':x=40:y=80:fontsize=20:fontcolor=0xD2CBF3`,
        `drawtext=fontfile='${font}':text='TEACHER  /  INSIGHTS AGENT':x=1336:y=80:fontsize=20:fontcolor=0xD2CBF3`,
      ] : []),
      `subtitles=filename='${pathForFilter(srt)}':force_style='FontName=Segoe UI,FontSize=11,PrimaryColour=&H00FFFFFF,Outline=0,Shadow=0,MarginV=6'`,
    ].join(",");
    const inputs = ["-framerate", String(FPS), "-i", join(this.folder, "frame-%05d.png")];
    const filters = this.pairedPage ? [
      "-filter_complex_threads", "1", "-filter_complex",
      `[0:v]pad=1296:800:0:0:color=0x0c111b[left];[left][1:v]hstack=inputs=2,${filter}`,
    ] : ["-vf", filter];
    if (this.pairedPage) inputs.push("-framerate", String(FPS), "-i", join(this.folder, "teacher-%05d.png"));
    encode([...inputs, ...filters, "-frames:v", String(this.frames), "-an", "-c:v", "libx264", "-threads", "2",
      "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output("mp4")]);
    const palette = join(this.folder, "palette.png");
    encode(["-i", output("mp4"), "-vf", "fps=10,palettegen=max_colors=192:stats_mode=diff", "-frames:v", "1", palette]);
    this.created.push(palette);
    encode(["-i", output("mp4"), "-i", palette, "-filter_complex_threads", "1", "-lavfi",
      "fps=10[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
      "-loop", "0", "-gifflags", "+transdiff", output("gif")]);
    encode(["-ss", String(this.posterTime || duration - 2), "-i", output("mp4"), "-frames:v", "1", output("png")]);
    await writeFile(output("vtt"), `WEBVTT\n\n${captions.replace(/(\d{2}:\d{2}:\d{2}),/g, "$1.")}`);
    const gif = await readFile(output("gif"));
    assert.equal(gif.subarray(0, 6).toString(), "GIF89a");
    assert.equal(gif.readUInt16LE(6), this.width);
    assert.equal(gif.readUInt16LE(8), this.height);
    const loop = gif.indexOf(Buffer.from("NETSCAPE2.0"));
    assert(loop > 0 && gif[loop + 11] === 3 && gif[loop + 12] === 1 && gif.readUInt16LE(loop + 13) === 0, "GIF must loop indefinitely");
    const digest = encode(["-i", output("mp4"), "-an", "-vsync", "0", "-f", "framemd5", "-"]);
    const frames = digest.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
    assert.equal(frames.length, this.frames);
    assert(digest.includes(`${this.width}x${this.height}`));
    const gifDigest = encode(["-i", output("gif"), "-an", "-vsync", "0", "-f", "framemd5", "-"]);
    const gifFrames = gifDigest.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
    assert(Math.abs(gifFrames.length - Math.round(duration * 10)) <= 1);
    assert(new Set(gifFrames.map((line) => line.split(",").at(-1))).size > 30, "Recorded GIF must contain real changing UI states");
    assert(gif.length < (this.pairedPage ? 24 : 12) * 1024 * 1024, "Tutorial GIF exceeds its readability/size budget");
    console.log(`Verified ${this.name}: ${duration.toFixed(2)}s / ${this.frames} MP4 frames / ${gifFrames.length} GIF frames / ${(gif.length / 1048576).toFixed(2)} MiB`);
    return {
      name: this.name, title: this.title, duration, frames: this.frames, width: this.width, height: this.height,
      gifFrames: gifFrames.length, gifBytes: gif.length, chapters: this.chapters,
      headerStyle: { background: "#EDE9FE", text: "#30264D", badge: false },
      layout: this.pairedPage ? "side-by-side" : "single-screen",
      presentation: {
        configuredCourseStarters: this.startersApplicable ? courseStarters.length : 0,
        starterRuleApplicable: this.startersApplicable,
        verifiedWelcomeScreens: this.starterChecks,
        assetChecks: this.assetChecks,
      },
    };
  }
  async clean() {
    for (const file of this.created) await unlink(file);
    assert.equal((await readdir(this.folder)).length, 0, `Unexpected files in ${this.folder}`);
    await rmdir(this.folder);
  }
}

async function emit(page, event, stream = 0) {
  await page.evaluate(({ event, stream }) => globalThis.tutorialStreams[stream].emit(event), { event, stream });
}

function createHelpers(page, recorder) {
  async function collapseNavigation() {
    const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
    if (await collapse.isVisible()) await recorder.click(collapse);
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    await expect(collapse).toHaveCount(0);
  }
  const assetEvents = new Set([
    "document_start", "document", "quiz_start", "quiz",
    "slides_start", "slides", "circuit_start", "circuit", "challenge_start", "challenge",
    "generated_image_start", "generated_image",
  ]);
  return {
    async openCourse() {
      await recorder.click(page.getByRole("main").getByRole("button", { name: new RegExp(`^${courseName} `) }));
      await expect(page.getByRole("button", { name: "Start Chat", exact: true })).toBeVisible();
      await recorder.click(page.getByRole("button", { name: "Start Chat", exact: true }));
      await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
      assert.equal(courseStarters.length, 4);
      for (const starter of courseStarters) {
        await expect(page.getByRole("button", { name: starter.prompt, exact: true })).toBeVisible();
      }
      recorder.starterChecks++;
      await recorder.hold(0.8);
    },
    async ask(prompt, seconds = 3) {
      const index = await page.evaluate(() => globalThis.tutorialStreams.length);
      const input = page.getByRole("textbox", { name: "Ask anything about the course..." });
      await expect(input).toHaveValue("");
      await recorder.type(input, prompt, seconds);
      await recorder.click(page.getByRole("button", { name: "Send message", exact: true }));
      await page.waitForFunction((expected) => globalThis.tutorialStreams.length === expected, index + 1);
      return index;
    },
    collapseNavigation,
    async emit(event, stream = 0) {
      if (assetEvents.has(event.type)) {
        await collapseNavigation();
        recorder.assetChecks.push({ event: event.type, atSeconds: recorder.frames / FPS, navigationCollapsed: true });
      }
      await emit(page, event, stream);
    },
    finishTurn: (stream = 0) => emit(page, { type: "done", thread_id: "tutorial-conversation" }, stream),
  };
}

async function scenarioFor(id) {
  if (id === "learner") return { id, name: "shiksha-chat-tutorial", title: "Ask, practise and explain", role: "student",
    run: ({ page, demo, recorder }) => learnerTutorial(page, demo, recorder) };
  if (id === "teacher") return { id, name: "shiksha-course-setup-tutorial", title: "Draft a course with Course Companion", role: "teacher",
    run: ({ page, demo, recorder }) => teacherTutorial(page, demo, recorder) };
  if (["answer-depth", "documents", "preferences", "companion-review"].includes(id)) {
    const { additionalDemos } = await import("./additional-demos.mjs");
    const scenario = additionalDemos.find((demo) => demo.id === id);
    assert(scenario, `Missing demo definition: ${id}`);
    return scenario;
  }
  if (["slides", "circuits"].includes(id)) {
    const { artifactDemos } = await import("./artifact-demos.mjs");
    const scenario = artifactDemos.find((demo) => demo.id === id);
    assert(scenario, `Missing artifact demo definition: ${id}`);
    return scenario;
  }
  if (id === "challenges") {
    const { challengeDemo } = await import("./challenge-demo.mjs");
    return challengeDemo;
  }
  if (id === "image-generation") {
    const { imageGenerationDemo } = await import("./image-generation-demo.mjs");
    return imageGenerationDemo;
  }
  if (id === "memory") {
    const { memoryDemo } = await import("./memory-demo.mjs");
    return memoryDemo;
  }
  if (id === "onboarding-profile") {
    const { onboardingDemo } = await import("./onboarding-demo.mjs");
    return onboardingDemo;
  }
  if (["teacher-roster", "teacher-usage"].includes(id)) {
    const { teacherDemos } = await import("./teacher-dashboard-demos.mjs");
    const scenario = teacherDemos.find((demo) => demo.id === id);
    assert(scenario, `Missing teacher dashboard recipe: ${id}`);
    return scenario;
  }
  if (["admin-overview", "admin-assignments"].includes(id)) {
    const { adminDemos } = await import("./admin-dashboard-demos.mjs");
    const scenario = adminDemos.find((demo) => demo.id === id);
    assert(scenario, `Missing admin dashboard recipe: ${id}`);
    return scenario;
  }
  throw new Error(`Unknown demo: ${id}`);
}

async function learnerTutorial(page, demo, recorder) {
  const helpers = createHelpers(page, recorder);
  await recorder.chapter("01  Open a course from the Teaching Assistant library, then choose Start Chat.", async () => {
    await recorder.hold(1.8);
    await helpers.openCourse();
    await recorder.hold(2);
  });
  await recorder.chapter("02  Choose an answer depth, then ask a focused question.", async () => {
    await recorder.click(page.getByRole("button", { name: /^Answer depth:/ }));
    await recorder.hold(1.2);
    await recorder.click(page.getByRole("menuitemradio", { name: /^Comprehensive/ }));
    await recorder.type(page.getByRole("textbox", { name: "Ask anything about the course..." }),
      "Why does current fall when resistance rises? Keep voltage fixed.", 3.5);
    await recorder.hold(0.6);
    await recorder.click(page.getByRole("button", { name: "Send message", exact: true }));
    await page.waitForFunction(() => globalThis.tutorialStreams.length === 1);
    const sent = await page.evaluate(() => globalThis.tutorialStreams[0].request);
    assert.equal(sent.answer_depth, "detailed");
  });
  await recorder.chapter("03  Follow context preparation and the streamed course explanation.", async () => {
    await recorder.hold(1.5);
    await emit(page, { type: "context_status", status: "ready" });
    await emit(page, { type: "tool_status", tool: "search_knowledge_base" });
    await recorder.hold(1.4);
    await emit(page, { type: "message_block_start" });
    for (const line of lesson.split("\n")) {
      await emit(page, { type: "message_block_delta", delta: `${line}\n` });
      await recorder.hold(0.15);
    }
    await emit(page, { type: "message_block", content: lesson });
    await helpers.emit({ type: "quiz_start" });
    await recorder.hold(0.6);
    await helpers.emit({ type: "quiz", quizId, title: "Current and resistance", assessmentType: "concept_inventory", questions: [question] });
    await emit(page, { type: "done", thread_id: "tutorial-conversation" });
    await expect(page.locator(`#asset-anchor-${quizId}`).getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await recorder.hold(2.5);
  });
  await recorder.chapter("04  Open the generated concept inventory in the actual artifact pane.", async () => {
    await helpers.collapseNavigation();
    await recorder.click(page.locator(`#asset-anchor-${quizId}`).getByRole("button", { name: "Start", exact: true }));
    await expect(page.getByRole("region", { name: "Document pane", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    await recorder.hold(2.2);
  });
  const pane = page.getByRole("region", { name: "Document pane", exact: true });
  await recorder.chapter("05  Select an answer and explain the reasoning before submitting.", async () => {
    await recorder.click(pane.getByRole("button", { name: /It halves$/ }));
    await recorder.type(pane.getByRole("textbox", { name: /Reason for your choice/ }).first(),
      "I = V/R. With voltage fixed, doubling resistance halves the current.", 3);
    await recorder.hold(0.8);
    await recorder.click(pane.getByRole("button", { name: "Submit", exact: true }));
    await expect.poll(() => demo.attempt?.score).toBe(1);
  });
  await recorder.chapter("06  Review the result and tutor feedback. One answer is not proof of mastery.", async () => {
    await page.waitForFunction(() => globalThis.tutorialStreams.length === 2);
    await emit(page, { type: "context_status", status: "ready" }, 1);
    await emit(page, { type: "message_block", content: "**Correct reasoning.** You kept the voltage fixed and used I = V/R. Doubling the denominator halves the current. Next, consider what would happen if voltage changed too." }, 1);
    await emit(page, { type: "done", thread_id: "tutorial-conversation" }, 1);
    await recorder.hold(3);
    recorder.posterTime = recorder.frames / FPS - 1;
  });
  assert(demo.messages.size > 0, "Conversation persistence must be exercised");
  assert.equal(demo.attempt.totalQuestions, 1);
}

async function teacherTutorial(page, demo, recorder) {
  await recorder.chapter("01  Use Create in the real Agentic Shiksha teacher workspace.", async () => {
    await recorder.hold(1.8);
    await recorder.click(page.getByRole("complementary").first().getByRole("button", { name: "Create", exact: true }));
    await expect(page.getByPlaceholder("e.g., Data Structures & Algorithms")).toBeVisible();
    await recorder.hold(2);
  });
  await recorder.chapter("02  Give the course a name, then open Course Companion.", async () => {
    await recorder.type(page.getByPlaceholder("e.g., Data Structures & Algorithms"), courseDraft.courseName, 2.2);
    await recorder.click(page.getByRole("button", { name: "Course Companion", exact: true }));
    await recorder.hold(1.8);
  });
  const companion = page.getByRole("complementary", { name: "Course Companion", exact: true });
  await recorder.chapter("03  Describe the level, duration, code and learning goals.", async () => {
    await recorder.type(companion.getByRole("textbox", { name: "Message Course Companion", exact: true }),
      "Draft a one-month certificate course on voltage, current and resistance. Code ELEC101. No prerequisites. Include Ohm's law and concept checks.", 5);
    await recorder.hold(0.7);
    await recorder.click(companion.getByRole("button", { name: "Send message", exact: true }));
    await expect.poll(() => demo.companionReady).toBe(true);
    await recorder.hold(1.6);
    demo.completeCompanion();
    await expect(page.getByPlaceholder("e.g., CS101")).toHaveValue("ELEC101");
  });
  await recorder.chapter("04  Review the Companion's proposed fields in the actual course form.", async () => {
    await expect(companion.getByRole("log")).toContainText("Nothing has been submitted.");
    await recorder.hold(3);
    await recorder.click(companion.getByRole("button", { name: "Close Course Companion", exact: true }));
    await recorder.hold(2);
  });
  await recorder.chapter("05  Review the course description and prerequisites before choosing Create.", async () => {
    const notes = page.getByPlaceholder("Course overview, syllabus, and learning outcomes...");
    await recorder.move(notes);
    await expect(notes).toHaveValue(courseDraft.courseNotes);
    await recorder.hold(3);
    recorder.posterTime = recorder.frames / FPS - 1;
  });
  await recorder.chapter("Draft only: this tutorial does not submit Create or provision a remote agent.", async () => {
    await page.getByRole("region", { name: "Course form", exact: true }).evaluate((element) => element.scrollTop = 0);
    await recorder.hold(3);
  });
  assert.equal(demo.companionRequests, 1);
}

async function main() {
  const { inspect, checkFlow, selected } = parseOptions(process.argv.slice(2));
  const selectedDemos = selected ?? ["learner", "teacher"];
  const paired = selectedDemos.includes("student-teacher");
  assert(!paired || !inspect, "Use --check-flow to inspect the paired workflow");
  await mkdir(here, { recursive: true });
  await mkdir(imageDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-background-networking", "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
  });
  const results = [];
  try {
    for (const kind of selectedDemos.filter((name) => name !== "student-teacher")) {
      const scenario = await scenarioFor(kind);
      const scenarioBaseURL = scenario.project === "admin" ? adminBaseURL : baseURL;
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: "block" });
      const demo = await (scenario.installDemo || installDemo)(context, scenarioBaseURL, scenario.role);
      const page = await context.newPage();
      const folder = await mkdtemp(join(tmpdir(), `shiksha-platform-${kind}-`));
      const recorder = new Recorder(page, folder, scenario.name, scenario.title, checkFlow);
      recorder.startersApplicable = scenario.project !== "admin";
      const ctx = { page, context, demo, recorder, expect, helpers: createHelpers(page, recorder), baseURL: scenarioBaseURL };
      try {
        await scenario.setup?.(ctx);
        await page.goto(new URL(scenario.startPath || "/library", scenarioBaseURL).href);
        if (scenario.ready) await scenario.ready(ctx);
        else await expect(page.getByRole("heading", { name: courseName, exact: true })).toBeVisible({ timeout: 30000 });
        await page.evaluate(() => document.fonts.ready);
        await recorder.installCursor();
        if (inspect) {
          await page.screenshot({ path: assetPath(`platform-inspection-${kind}.png`) });
          console.log(JSON.stringify({ kind, requests: demo.requests, failures: demo.failures, buttons: await page.getByRole("button").allTextContents() }, null, 2));
        } else {
          const verification = await scenario.run(ctx);
          demo.verify();
          if (scenario.role === "student") assert(recorder.starterChecks > 0, "Every learner demo must show four verified starters");
          if (["learner", "documents", "slides", "circuits", "challenges", "memory", "image-generation"].includes(kind)) {
            assert(recorder.assetChecks.length > 0, "Asset demos must verify collapsed navigation before rendering the asset");
          }
          if (checkFlow) {
            console.log(`PASS ${kind}: real UI workflow, ${demo.requests.length} simulated API requests, no page errors or unhandled requests.`);
            continue;
          }
          const result = await recorder.finish();
          results.push(result);
          await writeFile(join(here, `${result.name}.json`), JSON.stringify({
            ...result, projectName: "Agentic Shiksha", demoId: kind, description: scenario.description, verification,
            capture: "Actual unchanged React frontend; scripted interactions, synthetic course data and in-memory API responses.",
            timing: "Captured frames are paced for readability, not a performance benchmark.",
            isolation: "Fresh browser context. External services blocked; all API calls simulated. No remote course creation.",
            source: scenario.source || "Agentic Shiksha Platform/Frontend", recordedOn: "2026-09-30",
          }, null, 2) + "\n");
        }
        demo.verify();
      } catch (error) {
        await page.screenshot({ path: assetPath(`platform-failure-${kind}.png`) });
        console.error(JSON.stringify({ requests: demo.requests, failures: demo.failures, pageErrors: demo.pageErrors, buttons: await page.getByRole("button").allTextContents() }, null, 2));
        throw error;
      } finally {
        await context.close();
        await recorder.clean();
      }
    }
  } finally {
    await browser.close();
  }
  if (paired) {
    const result = spawnSync(process.execPath, [join(here, "record-insights.mjs"), ...(checkFlow ? ["--check-flow"] : [])], {
      stdio: "inherit", windowsHide: true,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "The side-by-side recording failed");
  }
  if (!inspect && !checkFlow) {
    console.log(`Recorded and verified ${results.length + Number(paired)} actual-platform tutorials.`);
  }
}

export { Recorder, createHelpers, encode, timecode, FPS, baseURL, expect, HEADER_COLOR, HEADER_TEXT };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
