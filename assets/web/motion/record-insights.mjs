import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assetPath, imageDir } from "./asset-paths.mjs";
import { Recorder, createHelpers, baseURL, expect, FPS } from "./record-platform.mjs";
import { installDemo, agentId, courseName, question, quizId } from "./platform-demo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = createRequire(join(resolve(here, "..", "..", ".."), "Agentic Shiksha Platform", "Frontend", "package.json"));
const { chromium } = frontend("@playwright/test");
const checkFlow = process.argv.includes("--check-flow");
assert(process.argv.slice(2).every((value) => value === "--check-flow"), "Usage: node record-insights.mjs [--check-flow]");
const prompt = "At a fixed 12 V, how does doubling resistance affect current? Give me a concept check.";
const now = "2026-09-30T07:30:00Z";
const concepts = [
  { concept: "Current and resistance", description: "Predict current using I = V / R.", misconceptions: [], related_chapters: [] },
  { concept: "Keeping voltage fixed", description: "Identify the condition behind an inverse relationship.", misconceptions: [], related_chapters: [] },
];

function activitySnapshot(learner) {
  const questions = [...learner.messages.values()].filter((message) => message.role === "user" && message.content === prompt);
  const attempt = learner.attempt;
  return {
    learnerId: learner.account.userId,
    learnerName: learner.account.displayName,
    questionCount: questions.length,
    conversationCount: questions.length ? 1 : 0,
    submittedChecks: attempt ? 1 : 0,
    correctAnswers: attempt?.score ?? 0,
    totalQuestions: attempt?.totalQuestions ?? 0,
    question: questions[0]?.content || "",
  };
}

function registerTeacherApi(teacher, learner) {
  const course = { id: agentId, agentId, name: agentId, courseName,
    createdById: teacher.account.userId, courseLevel: "Certificate", courseCode: "ELEC100", courseDuration: "1 Month" };
  const studentSummary = () => ({
    user_id: learner.account.userId, display_name: learner.account.displayName, agent_id: agentId,
    total_topics: 2, learned: 0, in_progress: activitySnapshot(learner).questionCount ? 1 : 0,
    not_started: activitySnapshot(learner).questionCount ? 1 : 2, pct_complete: 0,
    concepts_total: 2, concepts_learned: 0, concepts_in_progress: activitySnapshot(learner).questionCount ? 1 : 0,
    concepts_not_started: 2, concepts_pct_complete: 0, explored: 0, assets: learner.attempt ? 1 : 0,
    recently_active: [], struggle_areas: [], last_updated: now,
  });
  teacher.addApiHandler(async ({ path, method }) => {
    if (method !== "GET") return undefined;
    if (path === "/api/teacher-dashboard/agents") return { json: { agents: [course], count: 1 } };
    if (path === "/api/teacher-dashboard/summary") return { json: {
      teacherId: teacher.account.userId, courseCount: 1, agentIds: [agentId],
      totalStudents: 1, activeStudents: activitySnapshot(learner).questionCount ? 1 : 0,
      avgPctComplete: 0, totalTokens: 0, totalThreads: activitySnapshot(learner).conversationCount,
      activeThreads: activitySnapshot(learner).conversationCount,
      courses: [{ agentId, name: courseName, studentCount: 1, activeStudentCount: 1, avgPctComplete: 0, totalTokens: 0, activeThreads: 1 }],
    } };
    if (path === `/api/teacher-dashboard/agents/${agentId}/overview`) return { json: {
      agent_id: agentId, student_count: 1, avg_pct_complete: 0, total_topics: 2,
      distribution: { "0-25%": 1, "25-50%": 0, "50-75%": 0, "75-100%": 0 },
      top_struggle_topics: [], students: [studentSummary()],
      usage: { agent_id: agentId, total_students: 1, active_students: 1, active_teachers: 1, total_threads: 1, active_threads: 1 },
    } };
    if (path === `/api/teacher-dashboard/agents/${agentId}/curriculum`) return { json: {
      agent_id: agentId, threshold_concepts: concepts, total_concepts: 2, total_topics: 2,
      syllabus: [{ module_id: "fundamentals", title: "Electrical fundamentals",
        topics: ["Ohm's law", "Fixed-voltage reasoning"], learning_objectives: ["Explain how current changes when resistance doubles."],
        prerequisites: [], concepts: concepts.map((concept) => concept.concept) }],
    } };
    if (path === `/api/teacher-dashboard/agents/${agentId}/students/${learner.account.userId}`) return { json: {
      ...studentSummary(), email: "user@example.com",
      topics_by_status: { learned: [], in_progress: [], not_started: [
        { topic: "Ohm's law", status: "not_started", latest_summary: "", last_updated: now, module: "Electrical fundamentals" },
      ] },
      concepts_by_status: { learned: [], in_progress: [], not_started: concepts.map((entry) => ({
        ...entry, status: "not_started", misconceptions_addressed: [], last_updated: now,
      })) },
      total_concepts: 2, syllabus: [], off_plan_topics: [],
    } };
    if (path === `/api/teacher-dashboard/agents/${agentId}/students/${learner.account.userId}/assets`) return { json: { assets: [] } };
    return undefined;
  });
}

async function installInsightsStream(context) {
  await context.addInitScript(() => {
    if (location.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(location.hostname)) return;
    const original = window.fetch.bind(window);
    globalThis.tutorialInsights = [];
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== "/api/teacher-dashboard/logging-agent/chat/stream") return original(input, init);
      const request = JSON.parse(String(init.body));
      let emit;
      const body = new ReadableStream({
        start(controller) {
          let closed = false;
          emit = (event) => {
            if (closed) throw new Error("The tutorial Insights stream is closed");
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            if (event.type === "done") { closed = true; controller.close(); }
          };
          init.signal?.addEventListener("abort", () => {
            if (!closed) { closed = true; controller.error(new DOMException("Aborted", "AbortError")); }
          }, { once: true });
          emit({ type: "thread_id", thread_id: "tutorial-insights-conversation" });
        },
      });
      globalThis.tutorialInsights.push({ request, emit });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    };
  });
}

await mkdir(here, { recursive: true });
await mkdir(imageDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-background-networking", "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
});
const contexts = [];
let recorder;
try {
  for (let index = 0; index < 2; index++) {
    contexts.push(await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: "block" }));
  }
  const learner = await installDemo(contexts[0], baseURL, "student");
  const teacher = await installDemo(contexts[1], baseURL, "teacher");
  registerTeacherApi(teacher, learner);
  await installInsightsStream(contexts[1]);
  const studentPage = await contexts[0].newPage();
  const teacherPage = await contexts[1].newPage();
  await Promise.all([
    studentPage.goto(new URL("/library", baseURL).href),
    teacherPage.goto(new URL("/dashboard/students", baseURL).href),
  ]);
  await expect(studentPage.getByRole("heading", { name: courseName, exact: true })).toBeVisible();
  await expect(teacherPage.getByRole("heading", { name: "My Students", exact: true })).toBeVisible();
  await expect(teacherPage.getByRole("button", { name: "Insights", exact: true })).toBeVisible();
  await expect(teacherPage.getByText(learner.account.displayName, { exact: true }).first()).toBeVisible();
  await teacherPage.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await Promise.all([studentPage.evaluate(() => document.fonts.ready), teacherPage.evaluate(() => document.fonts.ready)]);
  const folder = await mkdtemp(join(tmpdir(), "agentic-shiksha-paired-"));
  recorder = new Recorder(studentPage, folder, "shiksha-student-teacher-tutorial",
    "Learning and teaching, side by side", checkFlow, teacherPage);
  await recorder.installCursor(studentPage);
  await recorder.installCursor(teacherPage);
  await recorder.activate(studentPage);
  const helpers = createHelpers(studentPage, recorder);
  const snapshots = [];
  const insightPanel = teacherPage.getByRole("complementary", { name: "Insights agent", exact: true });
  let studentStream;

  async function askInsights(text) {
    await recorder.activate(teacherPage);
    const index = await teacherPage.evaluate(() => globalThis.tutorialInsights.length);
    const input = insightPanel.getByRole("textbox");
    await recorder.type(input, text, 2.1);
    await recorder.click(insightPanel.getByRole("button", { name: "Send", exact: true }));
    await teacherPage.waitForFunction((count) => globalThis.tutorialInsights.length === count, index + 1);
    const request = await teacherPage.evaluate((value) => globalThis.tutorialInsights[value].request, index);
    assert.equal(request.agent_id, agentId);
    assert.deepEqual(request.student_ids, [learner.account.userId]);
    return index;
  }
  async function respondInsights(index, text) {
    for (const paragraph of text.split("\n\n")) {
      await teacherPage.evaluate(({ index, paragraph }) => globalThis.tutorialInsights[index].emit({
        type: "delta", content: `${paragraph}\n\n`,
      }), { index, paragraph });
      await recorder.hold(0.4);
    }
    await teacherPage.evaluate((value) => globalThis.tutorialInsights[value].emit({ type: "done" }), index);
  }

  await recorder.chapter("01  Two separate accounts: the learner opens a course while the teacher views the class.", async () => {
    await recorder.hold(1.2);
    await helpers.openCourse();
    await recorder.hold(1.8);
  });
  await recorder.chapter("02  The learner asks a question; the teacher opens Insights and scopes it to that learner.", async () => {
    studentStream = await helpers.ask(prompt, 2.8);
    await helpers.emit({ type: "context_status", status: "ready" }, studentStream);
    await helpers.emit({ type: "tool_status", tool: "search_knowledge_base" }, studentStream);
    await recorder.activate(teacherPage);
    await recorder.click(teacherPage.getByRole("button", { name: "Insights", exact: true }));
    await expect(insightPanel).toBeVisible();
    await recorder.click(insightPanel.getByRole("button", { name: "Choose students for insights", exact: true }));
    await recorder.click(insightPanel.getByRole("checkbox", { name: new RegExp(learner.account.displayName) }));
    await recorder.click(insightPanel.getByRole("button", { name: "Close insight scope picker", exact: true }));
    await recorder.hold(1.4);
  });
  await recorder.chapter("03  While the course answer arrives, the teacher asks about the learner's current activity.", async () => {
    const index = await askInsights("What is Demo Learner working on, and has the concept check been submitted?");
    await recorder.activate(studentPage);
    await helpers.emit({ type: "message_block", content:
      "### Same voltage, different resistance\n\nAt a fixed **12 V**, **I = V / R**.\n\n- **6 ohms** gives **2 A**.\n- **12 ohms** gives **1 A**.\n\nDoubling resistance halves current. Try the concept check and explain why." }, studentStream);
    await helpers.emit({ type: "quiz_start" }, studentStream);
    await helpers.emit({ type: "quiz", quizId, title: "Current and resistance", assessmentType: "concept_inventory", questions: [question] }, studentStream);
    await helpers.finishTurn(studentStream);
    await expect.poll(() => activitySnapshot(learner).questionCount).toBe(1);
    const snapshot = activitySnapshot(learner);
    assert.equal(snapshot.submittedChecks, 0);
    snapshots.push(snapshot);
    await recorder.activate(teacherPage);
    await respondInsights(index, `### Current activity\n\n**Demo Learner** has **${snapshot.questionCount} learner question** in **${snapshot.conversationCount} course conversation**.\n\nThe question concerns **current when resistance doubles at fixed voltage**. A concept check is available, but **no answer has been submitted yet**.\n\nReview the learner's reasoning after submission; activity alone does not establish understanding.`);
    await expect(insightPanel.getByText("no answer has been submitted yet", { exact: false })).toBeVisible();
    await recorder.hold(2);
  });
  await recorder.chapter("04  The learner opens the check, chooses an answer and explains the reasoning.", async () => {
    await recorder.activate(studentPage);
    await recorder.click(studentPage.locator(`#asset-anchor-${quizId}`).getByRole("button", { name: "Start", exact: true }));
    await expect(studentPage.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    const pane = studentPage.getByRole("region", { name: "Document pane", exact: true });
    await recorder.click(pane.getByRole("button", { name: /It halves$/ }));
    await recorder.type(pane.getByRole("textbox", { name: /Reason for your choice/ }).first(),
      "At fixed V, I = V/R. Doubling R halves the current.", 2.1);
    await recorder.hold(0.9);
    await recorder.click(pane.getByRole("button", { name: "Submit", exact: true }));
    await expect.poll(() => learner.attempt?.score).toBe(1);
    await recorder.hold(1);
  });
  await recorder.chapter("05  The teacher asks what changed; the response uses the submitted demo attempt.", async () => {
    const index = await askInsights("What changed after the concept check, and what should I ask next?");
    const snapshot = activitySnapshot(learner);
    assert.equal(snapshot.submittedChecks, 1);
    assert.equal(snapshot.correctAnswers, 1);
    snapshots.push(snapshot);
    await studentPage.waitForFunction(() => globalThis.tutorialStreams.length === 2);
    await helpers.emit({ type: "context_status", status: "ready" }, 1);
    await helpers.emit({ type: "message_block", content: "**Correct reasoning.** You kept voltage fixed and applied I = V/R. Next, predict what happens when both voltage and resistance double." }, 1);
    await helpers.finishTurn(1);
    await respondInsights(index, `### New activity recorded\n\n**${snapshot.submittedChecks} concept check submitted**; **${snapshot.correctAnswers} / ${snapshot.totalQuestions} correct**.\n\nThe learner explained the inverse relationship using **I = V/R with voltage fixed**.\n\n**Suggested next step:** ask what happens if **both voltage and resistance double**.\n\nThis is one successful response, not a mastery determination.`);
    await expect(insightPanel.getByText("1 concept check submitted", { exact: false })).toBeVisible();
    await expect(insightPanel.getByText("1 / 1 correct", { exact: false })).toBeVisible();
    await recorder.hold(2.2);
  });
  await recorder.chapter("06  Both views remain visible: learner feedback and a scoped teaching next step.", async () => {
    await recorder.hold(3.2);
    recorder.posterTime = recorder.frames / FPS - 1;
  });
  learner.verify();
  teacher.verify();
  assert.equal(recorder.starterChecks, 1);
  assert(recorder.assetChecks.every((check) => check.navigationCollapsed));
  assert.deepEqual(snapshots.map((snapshot) => snapshot.submittedChecks), [0, 1]);
  assert(snapshots.every((snapshot) => snapshot.learnerId === learner.account.userId));
  if (checkFlow) {
    console.log(`PASS side-by-side: two real browser contexts; Insights scope verified; submitted checks ${snapshots.map((snapshot) => snapshot.submittedChecks).join(" -> ")}; no external requests or page errors.`);
  } else {
    const result = await recorder.finish();
    await writeFile(join(here, `${result.name}.json`), JSON.stringify({
      ...result, projectName: "Agentic Shiksha", demoId: "student-teacher",
      description: "Two simultaneous actual UI views: a learner completes a concept check while a teacher queries the Insights agent about that same demo activity.",
      capture: "Separate student and teacher browser contexts captured together at every frame; both use the real React frontend.",
      timing: "Frames are paced for clarity, not a performance or real-time telemetry benchmark.",
      isolation: "Synthetic accounts and local shared fixtures only. Teacher replies are composed from the learner's actual intercepted demo messages and submitted quiz receipt, not live cloud inference.",
      linkedUsage: snapshots, source: "Agentic Shiksha Platform/Frontend", recordedOn: "2026-09-30",
    }, null, 2) + "\n");
  }
} catch (error) {
  if (recorder) {
    await Promise.all([
      recorder.primaryPage.screenshot({ path: assetPath("platform-failure-paired-student.png") }),
      recorder.pairedPage.screenshot({ path: assetPath("platform-failure-paired-teacher.png") }),
    ]);
  }
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await recorder?.clean();
  await browser.close();
}
