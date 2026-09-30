import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assetPath, imageDir } from "./asset-paths.mjs";
import { Recorder, createHelpers, encode, timecode, FPS, baseURL, expect } from "./record-platform.mjs";
import { installDemo, question, quizId, courseName } from "./platform-demo.mjs";
import { linkTeacherInsights } from "./linked-insights-demo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRequire = createRequire(join(resolve(here, "..", "..", ".."), "Agentic Shiksha Platform", "Frontend", "package.json"));
const { chromium } = frontendRequire("@playwright/test");
const args = process.argv.slice(2);
assert(args.every((arg) => arg === "--check-flow"), "Usage: node record-dual.mjs [--check-flow]");
const dryRun = args.includes("--check-flow");
const name = "shiksha-student-teacher-tutorial";
const title = "Student learning and teacher Insights";
const width = 2320, height = 960;

class PairedRecorder {
  constructor(studentPage, teacherPage, folder) {
    this.pages = [studentPage, teacherPage]; this.folder = folder;
    this.frames = 0; this.created = []; this.chapters = []; this.posterTime = 0; this.overlapFrames = 0;
    this.actors = this.pages.map((page) => new Recorder(page, folder, name, title, dryRun));
    this.actors.forEach((actor) => { actor.hold = (seconds) => this.hold(seconds); });
  }
  async hold(seconds) {
    const count = Math.max(1, Math.round(seconds * FPS));
    if (dryRun) {
      this.frames += count;
      this.actors.forEach((actor) => { actor.frames = this.frames; });
      await this.pages[0].waitForTimeout(Math.min(200, count * 12));
      return;
    }
    for (let index = 0; index < count; index++) {
      const paths = this.pages.map((_, side) => join(this.folder, `${side}-${String(this.frames).padStart(5, "0")}.png`));
      await Promise.all(this.pages.map((page, side) => page.screenshot({ path: paths[side], animations: "allow" })));
      this.created.push(...paths);
      this.frames++;
      this.actors.forEach((actor) => { actor.frames = this.frames; });
    }
  }
  async chapter(caption, action) {
    const start = this.frames / FPS;
    await action();
    this.chapters.push({ start, end: this.frames / FPS, caption });
    console.log(`${name}: ${caption} (${(this.frames / FPS).toFixed(1)}s)`);
  }
  async typeTogether(left, leftText, right, rightText, seconds) {
    await this.actors[0].click(left);
    await this.actors[1].click(right);
    const count = Math.round(seconds * FPS);
    const previous = [0, 0];
    for (let index = 1; index <= count; index++) {
      for (const [side, target, value] of [[0, left, leftText], [1, right, rightText]]) {
        const next = Math.round(value.length * index / count);
        if (next > previous[side]) await target.pressSequentially(value.slice(previous[side], next));
        previous[side] = next;
      }
      this.overlapFrames++;
      await this.hold(1 / FPS);
    }
    await expect(left).toHaveValue(leftText);
    await expect(right).toHaveValue(rightText);
  }
  async finish(linked) {
    const duration = this.frames / FPS;
    const captions = this.chapters.map((chapter, index) => `${index + 1}\n${timecode(chapter.start)} --> ${timecode(chapter.end)}\n${chapter.caption}\n`).join("\n");
    const srt = join(this.folder, "captions.srt");
    await writeFile(srt, captions); this.created.push(srt);
    const filterPath = (path) => path.replace(/\\/g, "/").replace(/:/g, "\\:");
    const font = filterPath(join(process.env.WINDIR || "C:\\Windows", "Fonts", "segoeui.ttf"));
    const filter = [
      "[0:v]pad=1136:800:0:0:color=0x0c111b[left];[left][1:v]hstack=inputs=2",
      `pad=${width}:${height}:32:104:color=0x0c111b`,
      `drawtext=fontfile='${font}':text='Agentic Shiksha  /  ${title}':x=32:y=18:fontsize=28:fontcolor=white`,
      `drawtext=fontfile='${font}':text='LINKED SIMULATION  |  NO LIVE LEARNER DATA':x=w-tw-32:y=26:fontsize=16:fontcolor=0xb4b1ce`,
      `drawtext=fontfile='${font}':text='STUDENT  /  Demo Learner':x=32:y=69:fontsize=21:fontcolor=0xbab3ff`,
      `drawtext=fontfile='${font}':text='TEACHER  /  Insights agent':x=1168:y=69:fontsize=21:fontcolor=0x8fe0c8`,
      "drawbox=x=32:y=96:w=1120:h=2:color=0x8272de:t=fill",
      "drawbox=x=1168:y=96:w=1120:h=2:color=0x53bfa0:t=fill",
      `subtitles=filename='${filterPath(srt)}':force_style='FontName=Segoe UI,FontSize=11,PrimaryColour=&H00FFFFFF,Outline=0,Shadow=0,MarginV=5'`,
    ].join(",");
    const out = (extension) => assetPath(`${name}.${extension}`);
    encode(["-framerate", String(FPS), "-i", join(this.folder, "0-%05d.png"), "-framerate", String(FPS), "-i", join(this.folder, "1-%05d.png"),
      "-filter_complex_threads", "1", "-filter_complex", filter, "-frames:v", String(this.frames), "-an",
      "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out("mp4")]);
    const palette = join(this.folder, "palette.png");
    encode(["-i", out("mp4"), "-vf", "fps=10,palettegen=max_colors=192:stats_mode=diff", "-frames:v", "1", palette]);
    this.created.push(palette);
    encode(["-i", out("mp4"), "-i", palette, "-filter_complex_threads", "1", "-lavfi",
      "fps=10[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle", "-loop", "0", "-gifflags", "+transdiff", out("gif")]);
    encode(["-ss", String(this.posterTime), "-i", out("mp4"), "-frames:v", "1", out("png")]);
    const gif = await readFile(out("gif"));
    assert.equal(gif.readUInt16LE(6), width); assert.equal(gif.readUInt16LE(8), height);
    const loop = gif.indexOf(Buffer.from("NETSCAPE2.0"));
    assert(loop > 0 && gif.readUInt16LE(loop + 13) === 0);
    for (const [extension, expected] of [["mp4", this.frames], ["gif", Math.round(duration * 10)]]) {
      const data = encode(["-i", out(extension), "-an", "-vsync", "0", "-f", "framemd5", "-"]);
      assert(data.includes(`${width}x${height}`));
      const hashes = data.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => line.split(",").at(-1));
      assert(Math.abs(hashes.length - expected) <= (extension === "gif" ? 1 : 0));
      assert(new Set(hashes).size > 100);
    }
    assert(gif.length < 24 * 1024 * 1024, "Wide GIF exceeds 24 MiB");
    await writeFile(out("vtt"), `WEBVTT\n\n${captions.replace(/(\d{2}:\d{2}:\d{2}),/g, "$1.")}`);
    const metadata = {
      name, title, demoId: "student-teacher", projectName: "Agentic Shiksha",
      width, height, duration, frames: this.frames, gifFrames: Math.round(duration * 10), gifBytes: gif.length,
      chapters: this.chapters, recordedOn: "2026-09-30",
      capture: "Two actual frontend sessions on a paired timeline; separate student/teacher browser contexts and a shared synthetic activity ledger.",
      isolation: "All API responses are local fixtures. Teacher summaries are derived from the student's recorded chat and accepted assessment submission, not from unsent drafts.",
      timing: "Scripted paired capture, not a live ingestion or latency benchmark.",
      presentation: { configuredCourseStarters: 4, verifiedWelcomeScreens: this.actors[0].starterChecks,
        assetChecks: this.actors[0].assetChecks, simultaneousTypingFrames: this.overlapFrames },
      sharedActivity: linked.state.snapshots,
    };
    await writeFile(out("json"), JSON.stringify(metadata, null, 2) + "\n");
    console.log(`PASS paired media: ${duration.toFixed(2)}s, ${this.frames} synchronized frames, ${(gif.length / 1048576).toFixed(2)} MiB GIF.`);
  }
  async clean() {
    for (const path of this.created) await unlink(path);
    assert.equal((await readdir(this.folder)).length, 0);
    await rmdir(this.folder);
  }
}

async function emitInsights(page, index, content) {
  await page.evaluate(({ index, content }) => globalThis.insightStreams[index].emit({ type: "delta", content }), { index, content });
}
async function finishInsights(page, index) {
  await page.evaluate((i) => globalThis.insightStreams[i].emit({ type: "done" }), index);
}

const browser = await chromium.launch({ headless: true,
  args: ["--disable-background-networking", "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost, EXCLUDE 127.0.0.1"] });
const contexts = [];
await mkdir(imageDir, { recursive: true });
const work = await mkdtemp(join(tmpdir(), "shiksha-linked-demo-"));
let recorder;
try {
  for (let index = 0; index < 2; index++) contexts.push(await browser.newContext({
    viewport: { width: 1120, height: 800 }, deviceScaleFactor: 1, serviceWorkers: "block",
  }));
  const studentDemo = await installDemo(contexts[0], baseURL, "student");
  const teacherDemo = await installDemo(contexts[1], baseURL, "teacher");
  const linked = await linkTeacherInsights(studentDemo, teacherDemo, contexts[1], new URL(baseURL).origin);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [studentPage, teacherPage] = pages;
  recorder = new PairedRecorder(studentPage, teacherPage, work);
  const [student, teacher] = recorder.actors;
  const studentHelpers = createHelpers(studentPage, student);
  const teacherHelpers = createHelpers(teacherPage, teacher);
  await Promise.all(pages.map((page) => page.goto(new URL("/library", baseURL).href)));
  for (const page of pages) {
    await expect(page.getByRole("heading", { name: courseName, exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
  }
  await Promise.all(recorder.actors.map((actor) => actor.installCursor()));
  let studentStream;
  const insights = teacherPage.getByRole("complementary", { name: "Insights agent", exact: true });
  const quizPane = studentPage.getByRole("region", { name: "Document pane", exact: true });

  await recorder.chapter("01  Two separate accounts, one course: the student begins while the teacher prepares.", async () => {
    await studentHelpers.openCourse();
    await recorder.hold(1.6);
    studentStream = await studentHelpers.ask("Why does current halve when resistance doubles at fixed voltage?", 2.8);
    await recorder.hold(0.7);
  });
  await recorder.chapter("02  The student receives a concept check; the teacher opens the current course roster.", async () => {
    await studentHelpers.emit({ type: "context_status", status: "ready" }, studentStream);
    await studentHelpers.emit({ type: "message_block", content: "**Keep voltage fixed.** From I = V / R, doubling resistance halves the current.\n\nTry the concept check and explain the assumption you used." }, studentStream);
    await studentHelpers.emit({ type: "quiz_start" }, studentStream);
    await recorder.hold(0.5);
    await studentHelpers.emit({ type: "quiz", quizId, title: "Current and resistance", assessmentType: "concept_inventory", questions: [question] }, studentStream);
    await studentHelpers.finishTurn(studentStream);
    await expect.poll(() => linked.snapshot().quizCreated).toBe(true);
    await teacher.click(teacherPage.getByRole("complementary").first().getByRole("button", { name: "Dashboard", exact: true }));
    await expect(teacherPage.getByRole("button", { name: "My Students", exact: true })).toBeVisible();
    await teacher.click(teacherPage.getByRole("button", { name: "My Students", exact: true }));
    await expect(teacherPage.getByText("Demo Learner", { exact: true }).first()).toBeVisible();
    await teacherHelpers.collapseNavigation();
    await recorder.hold(1.5);
  });
  await recorder.chapter("03  Open the student's activity and scope the Insights agent to that same learner.", async () => {
    await student.click(studentPage.locator(`#asset-anchor-${quizId}`).getByRole("button", { name: "Start", exact: true }));
    await expect(quizPane).toBeVisible();
    await expect(studentPage.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    await teacher.click(teacherPage.getByRole("button", { name: "Insights", exact: true }));
    await expect(insights).toBeVisible();
    await teacher.click(insights.getByRole("button", { name: "Choose students for insights", exact: true }));
    await teacher.click(insights.getByRole("checkbox", { name: /Demo Learner/ }));
    await teacher.click(insights.getByRole("button", { name: "Close insight scope picker", exact: true }));
    await expect(insights.getByPlaceholder(/^Ask about 1 selected student/)).toBeVisible();
    await recorder.hold(1.8);
  });
  await recorder.chapter("04  Both work at once: the student explains an answer while the teacher asks about usage.", async () => {
    await student.click(quizPane.getByRole("button", { name: /It halves$/ }));
    await recorder.typeTogether(
      quizPane.getByRole("textbox", { name: /Reason for your choice/ }).first(),
      "With voltage fixed, doubling resistance halves current because I = V/R.",
      insights.getByPlaceholder(/^Ask about 1 selected student/),
      "How has Demo Learner used this course so far?", 4,
    );
    await teacher.click(insights.getByRole("button", { name: "Send", exact: true }));
    await teacherPage.waitForFunction(() => globalThis.insightStreams.length === 1);
    const reply = await linked.answer(teacherPage, 0);
    assert.equal(linked.snapshot().submitted, false);
    for (const paragraph of reply.split("\n\n")) {
      await emitInsights(teacherPage, 0, `${paragraph}\n\n`);
      await recorder.hold(0.35);
    }
    await finishInsights(teacherPage, 0);
    await expect(insights.getByText("No assessment has been submitted yet.", { exact: true })).toBeVisible();
    await recorder.hold(2);
  });
  await recorder.chapter("05  The student submits. Only the accepted attempt becomes available to the teacher.", async () => {
    await student.click(quizPane.getByRole("button", { name: "Submit", exact: true }));
    await expect.poll(() => studentDemo.attempt?.score).toBe(1);
    await studentPage.waitForFunction(() => globalThis.tutorialStreams.length === 2);
    await studentHelpers.emit({ type: "context_status", status: "ready" }, 1);
    await studentHelpers.emit({ type: "message_block", content: "**Correct reasoning.** You held voltage fixed and used I = V/R. Next, consider what happens if voltage changes too." }, 1);
    await studentHelpers.finishTurn(1);
    await recorder.hold(1.5);
    await teacher.type(insights.getByPlaceholder(/^Ask about 1 selected student/),
      "Has the attempt been submitted, and what should I teach next?", 3);
    await teacher.click(insights.getByRole("button", { name: "Send", exact: true }));
    await teacherPage.waitForFunction(() => globalThis.insightStreams.length === 2);
  });
  await recorder.chapter("06  Insights uses the newly saved result and suggests a next probe, not a mastery claim.", async () => {
    const reply = await linked.answer(teacherPage, 1);
    for (const paragraph of reply.split("\n\n")) {
      await emitInsights(teacherPage, 1, `${paragraph}\n\n`);
      await recorder.hold(0.4);
    }
    await finishInsights(teacherPage, 1);
    await expect(insights.getByRole("heading", { name: "Submission received", exact: true })).toBeVisible();
    await expect(insights.getByText("1/1 correct", { exact: true })).toBeVisible();
    await recorder.hold(4);
    recorder.posterTime = recorder.frames / FPS - 1;
  });
  linked.verify();
  assert(recorder.overlapFrames >= 48, "Both native input fields must be edited on a shared timeline");
  assert.equal(student.starterChecks, 1);
  assert(student.assetChecks.every((check) => check.navigationCollapsed));
  if (dryRun) console.log(`PASS linked workflow: ${recorder.overlapFrames} simultaneous typing frames; two scoped teacher snapshots; unsent draft withheld; saved result shared.`);
  else await recorder.finish(linked);
} catch (error) {
  if (recorder) {
    await Promise.all(recorder.pages.map((page, i) => page.screenshot({ path: assetPath(`dual-failure-${i}.png`) })));
    console.error(JSON.stringify(await Promise.all(recorder.pages.map((page) => page.getByRole("button").allTextContents())), null, 2));
  }
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  if (recorder) await recorder.clean();
  else await rmdir(work);
}
