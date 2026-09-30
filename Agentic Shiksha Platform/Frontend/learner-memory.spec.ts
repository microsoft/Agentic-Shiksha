import { expect, test, type Page } from "@playwright/test";
import type { ApiMessage, ApiThread, GradedQuizAttempt } from "./src/lib/chatApi";
import type { CurriculumDraft, CurriculumGraph, LearnerSnapshot, MemoryMode, MemoryProcessingReceipt } from "./src/lib/learnerMemoryApi";
import type { QuizContent } from "./src/lib/types";
import { parseQuizContent } from "./src/lib/quizContract";
import { parsePolicy, validateGraph } from "./src/features/memory/curriculumGraphValidation";

const agentId = "course-Example";
const userId = "memory-example-user";
const instanceId = "assessment-example-001";
const now = "2026-09-29T12:00:00Z";
const publicQuiz: QuizContent = {
  quizId: instanceId, assessmentInstanceId: instanceId, curriculumVersion: "v1",
  title: "Current diagnostic", assessmentType: "concept_inventory",
  questions: [{
    problemId: "problem-current", question: "Select the two statements you support.",
    options: ["Current is conserved", "Current is consumed", "Potential difference transfers energy"],
    optionKeys: ["conserved", "consumed", "energy"], multiple: true,
  }],
};
const graph: CurriculumGraph = {
  tenant_id: "example-tenant", institute_ids: ["example-institute"], curriculum_id: "example-curriculum",
  version: "v2", course_name: "Example", course_ids: [agentId], status: "DRAFT",
  nodes: [
    { id: agentId, type: "COURSE", name: "Example" },
    { id: "tc-basic", type: "TC", name: "Potential difference" },
    { id: "tc-applied", type: "TC", name: "Current conservation" },
    { id: "mc-consumed", type: "MISCONCEPTION", name: "Current is consumed" },
    { id: "transfer-current", type: "PROBLEM", name: "Novel circuit", problem_version: "1", family_id: "novel-circuit",
      prompt: "Predict current in a new circuit.", rubric_id: "rubric-current", rubric_version: "1",
      assessment_version: "1", transfer_approved: true, catalog_diagnostic_reliability: 1,
      rubric_dimensions: [{ id: "reasoning", required: true }] },
  ],
  edges: [
    { id: "prerequisite", source_id: "tc-basic", target_id: "tc-applied", relation: "PREREQUISITE_OF" },
    { id: "diagnostic-mapping", source_id: "mc-consumed", target_id: "tc-applied", relation: "ASSOCIATED_WITH", required_for_crossing: true, threshold_relevance: "BLOCKING" },
    { id: "basic-mapping", source_id: "mc-consumed", target_id: "tc-basic", relation: "ASSOCIATED_WITH", required_for_crossing: true, threshold_relevance: "SIGNIFICANT" },
    { id: "transfer", source_id: "tc-applied", target_id: "transfer-current", relation: "HAS_TRANSFER_PROBE", required_for_crossing: true, assessment_version: "1", rubric_version: "1", transfer_condition_id: "novel-context" },
  ],
  policies: { version: "policy-v1", teacher_reviewed: true, reviewed_by: "example-teacher", reviewed_at: now,
    confidence_calibrated: false, min_clearance_independent_probes: 2, min_clearance_contexts: 2,
    min_clearance_families: 2, required_misconception_coverage: 1, require_reasoning_for_clearance: true },
};
const snapshot: LearnerSnapshot = {
  snapshot_version: 7, as_of: now,
  scope: { curriculum_id: "example-curriculum", curriculum_version: "v1", course_id: agentId, student_id: userId },
  concept_states: { "tc-applied": { tc_id: "tc-applied", state: "MASTERED", evidence_ids: ["evidence-example"] } },
  threshold_states: { "tc-applied": { tc_id: "tc-applied", state: "CANDIDATE", required_cleared: 1, required_total: 1,
    transfer_state: "NOT_ATTEMPTED", reason_codes: ["TRANSFER_REQUIRED"], evidence_ids: ["evidence-example"] } },
  misconception_states: { "mc-consumed": { misconception_id: "mc-consumed", state: "CLEARED" } },
  profile: {
    active_tc: "tc-applied", strong_tcs: ["tc-applied"], weak_tcs: [], crossed_tcs: [], candidate_tcs: ["tc-applied"],
    active_misconceptions: {}, unresolved_prerequisites: ["tc-basic"], learning_trend: "IMPROVING",
    next_recommended_probe: { tc_id: "tc-applied", problem_id: "transfer-current", reason_code: "TRANSFER_REQUIRED" },
    curriculum_version: "v1", updated_at: now,
  },
};

function typedValue(key: string, value: unknown): Record<string, unknown> {
  if (typeof value === "string") return { key, valueString: value };
  if (typeof value === "number") return { key, valueNumber: value };
  if (typeof value === "boolean") return { key, valueBoolean: value };
  return { key, valueMap: Object.entries(value && typeof value === "object" ? value : {}).map(([name, child]) => typedValue(name, child)) };
}

function quizEvents(agui: boolean, quiz: QuizContent) {
  if (!agui) return [{ type: "thread_id", thread_id: "memory-conversation" }, { type: "quiz_start" }, { type: "quiz", ...quiz }, { type: "done", thread_id: "memory-conversation" }];
  const entries = Object.entries(quiz);
  return [
    { type: "RUN_STARTED", threadId: "memory-conversation", runId: "memory-run" },
    { type: "STEP_STARTED", stepName: "quiz" },
    { type: "CUSTOM", name: "a2ui", value: { updateComponents: { surfaceId: "ephemeral-surface-not-quiz-id", components: [
      { id: "root", component: { Quiz: Object.fromEntries(entries.map(([key]) => [key, { path: `/${key}` }])) } },
    ] } } },
    { type: "CUSTOM", name: "a2ui", value: { updateDataModel: { surfaceId: "ephemeral-surface-not-quiz-id", contents: entries.map(([key, value]) => typedValue(key, value)) } } },
    { type: "CUSTOM", name: "a2ui", value: { createSurface: { surfaceId: "ephemeral-surface-not-quiz-id", root: "root", catalogId: "ekalaiva" } } },
    { type: "STEP_FINISHED", stepName: "quiz" }, { type: "RUN_FINISHED", threadId: "memory-conversation", runId: "memory-run" },
  ];
}

async function mockMemory(page: Page, role: "student" | "teacher" | "admin" = "student", mode: MemoryMode = "authoritative") {
  const messages = new Map<string, ApiMessage>();
  const threads = new Map<string, ApiThread>();
  const state = {
    mode, quiz: structuredClone(publicQuiz), grade: null as GradedQuizAttempt | null,
    gradeBarrier: null as Promise<void> | null, gradeStatus: 200, memoryStatus: 200, pending: 1,
    freshness: "current", snapshot: structuredClone(snapshot),
    draft: { id: "draft-example", revision: '"draft-1"', graph: structuredClone(graph) } as CurriculumDraft,
    rejectDraft: false, submissions: [] as Record<string, unknown>[], chats: [] as Record<string, unknown>[],
    savedAssets: [] as Record<string, unknown>[], draftWrites: [] as Record<string, unknown>[],
    publications: [] as Record<string, unknown>[], scopeReads: [] as string[],
    configRevision: '"course-1"', messages,
    processingReceipt: null as MemoryProcessingReceipt | null,
  };
  await page.addInitScript(({ agentId, userId, role }) => {
    if (sessionStorage.getItem("memory-test-seeded")) return;
    sessionStorage.setItem("memory-test-seeded", "true");
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({ version: 1, state: {
      userId, displayName: "Example Learner", email: "user@example.com", role, authProvider: "microsoft", isAuthenticated: true,
    } }));
    localStorage.setItem("ekalaiva.chat.v1", JSON.stringify({ version: 2, state: {
      onboardingCompleted: true, userStatus: "active", userName: "Example Learner",
      projects: { memory: { id: "memory", name: "Example", agentId, agentName: agentId, createdAt: 1, updatedAt: 1 } },
      threads: {}, messagesByThreadId: {}, activeThreadId: null,
    } }));
  }, { agentId, userId, role });
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (/\/api\/agents\/[^/]+\/chat\/(stream|agui)$/.test(path)) {
      state.chats.push(request.postDataJSON());
      const events = quizEvents(path.endsWith("/agui"), state.quiz);
      return route.fulfill({ contentType: "text/event-stream", body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") });
    }
    if (path.endsWith("/memory/config")) return route.fulfill({ json: {
      enabled: state.mode !== "off", graph_memory_mode: state.mode, can_manage: role === "admin",
      memory_scope: { tenant_id: "example-tenant", institute_id: "example-institute" },
      curriculum_binding: { curriculum_id: "example-curriculum", curriculum_version: "v1" }, revision: state.configRevision,
    } });
    if (path.endsWith("/course-curriculum/graph")) {
      if (request.method() === "PUT") {
        const body: { graph: CurriculumGraph; expected_revision: string | null } = request.postDataJSON();
        state.draftWrites.push(body);
        if (state.rejectDraft) return route.fulfill({ status: 409, json: { detail: "Draft changed" } });
        state.draft = { ...state.draft, graph: body.graph, revision: '"draft-2"' };
      }
      return route.fulfill({ json: state.draft });
    }
    if (path.endsWith("/course-curriculum/publish")) {
      state.publications.push(request.postDataJSON());
      return route.fulfill({ json: { ...state.draft, revision: null, graph: { ...state.draft.graph, status: "PUBLISHED", published_ready: true } } });
    }
    if (path.includes("/memory/cohorts/")) {
      state.scopeReads.push(path + url.search);
      return route.fulfill({ json: { student_count: 1, total_students: 2, complete: false, unassessed_students: 1,
        offset: Number(url.searchParams.get("offset") || 0),
        next_offset: Number(url.searchParams.get("offset") || 0) === 0 ? 1 : null,
        threshold_counts: { "tc-applied": { CANDIDATE: 1, NOT_CROSSED: 0 } },
        concept_counts: { "tc-applied": { MASTERED: 1, NOT_ATTEMPTED: 0 } },
        misconception_counts: { "mc-consumed": { CLEARED: 1, NOT_ASSESSED: 0 } } } });
    }
    if (path.includes("/learners/") && path.endsWith("/memory")) {
      state.scopeReads.push(path);
      const studentId = decodeURIComponent(path.split("/")[5]);
      return route.fulfill({ status: state.memoryStatus, json: state.memoryStatus !== 200 ? { detail: "Unavailable" } : {
        ...state.snapshot, scope: { ...state.snapshot.scope, student_id: studentId },
        mode: state.mode, pending_count: state.pending, freshness: state.freshness, processing_receipt: state.processingReceipt,
      } });
    }
    if (path.endsWith("/memory/context")) {
      state.scopeReads.push(path + url.search);
      return route.fulfill({ json: { tc_id: "tc-applied", snapshot_version: 7, complete: true,
        edges: graph.edges.slice(0, 2), evidence: [{ evidence_id: "evidence-example", source: "DIAGNOSTIC_RESPONSE", quote: "The measured current is conserved." }] } });
    }
    if (path.includes("/memory/evidence/")) return route.fulfill({ json: {
      evidence_id: "evidence-example", event_id: "event-example", source: "DIAGNOSTIC_RESPONSE", occurred_at: now,
      reasoning: "Two independent circuit probes supported this observation.", answer: "Current is conserved.",
    } });
    if (path === "/api/quiz-attempts/first") {
      const body: Record<string, unknown> = request.postDataJSON();
      state.submissions.push(body);
      if (state.gradeBarrier) await state.gradeBarrier;
      if (state.gradeStatus !== 200) return route.fulfill({ status: state.gradeStatus, json: { detail: "Retry grading" } });
      const answers = body.answers as Array<{ selected: number[]; reason: string }>;
      state.grade ||= {
        created: true, assetId: "asset-example", submittedAt: now, score: 0, totalQuestions: 1,
        answers: [{ question: publicQuiz.questions[0].question, selected: answers[0].selected, reason: answers[0].reason,
          correct: [0, 2], isCorrect: false, explanation: "Current is conserved; potential difference transfers energy." }],
        receipt: { event_id: instanceId, status: "PENDING" },
      };
      return route.fulfill({ json: state.grade });
    }
    if (/\/quiz-attempts\/[^/]+\/first$/.test(path)) return route.fulfill({ json: {
      exists: Boolean(state.grade), assetId: state.grade?.assetId || null, submittedAt: state.grade?.submittedAt || null,
      ...(state.grade || {}),
    } });
    if (path === "/api/quiz-assets") {
      state.savedAssets.push(request.postDataJSON());
      return route.fulfill({ json: { assetId: "asset-example", createdAt: now } });
    }
    if (path.endsWith("/course-curriculum")) return route.fulfill({ json: {
      status: "ready", curriculum: { course_name: "Example", syllabus: [{ title: "Fundamentals", topics: ["Current"] }], all_threshold_concepts: ["Current conservation"], "Current conservation": { definition: "Current is conserved." } },
    } });
    if (path === "/api/chat/sync") {
      const batch: { threads: ApiThread[]; messages: ApiMessage[] } = request.postDataJSON();
      for (const thread of batch.threads) threads.set(thread.id, thread);
      for (const message of batch.messages) messages.set(message.id, message);
      return route.fulfill({ json: { success: true, threadsUpserted: batch.threads.length, messagesUpserted: batch.messages.length } });
    }
    if (path.startsWith("/api/chat/load/")) return route.fulfill({ json: { threads: [...threads.values()], messages: [...messages.values()] } });
    if (path.endsWith("/messages")) return route.fulfill({ json: { messages: [...messages.values()], total: messages.size, hasMore: false } });
    if (path === "/auth/me") return route.fulfill({ json: { id: userId, role, displayName: "Example Learner", email: "user@example.com" } });
    if (path.startsWith("/api/user/")) return route.fulfill({ json: { success: true, profile: { id: userId, role, status: "active", onboardingCompleted: true, displayName: "Example Learner", email: "user@example.com" } } });
    if (path === "/api/azure/agents/list") return route.fulfill({ json: [{ id: agentId, name: agentId, created_by_id: role === "student" ? "example-teacher" : userId }] });
    if (path === "/api/config") return route.fulfill({ json: { default_model: "example-model", agent_model: "example-model", allowed_models: ["example-model"], version: "test" } });
    if (path.startsWith("/api/agents/setup/")) return route.fulfill({ json: { courseName: "Example", createdById: role === "student" ? "example-teacher" : userId, conversationStarters: [] } });
    if (path === "/api/learner-profile") return route.fulfill({ json: { customInstructions: "", updatedAt: now } });
    if (path === "/api/teacher-dashboard/agents") return route.fulfill({ json: { agents: [{ id: agentId, agentId, name: agentId, courseName: "Example" }], count: 1 } });
    if (/\/teacher-dashboard\/agents\/[^/]+\/overview$/.test(path)) return route.fulfill({ json: { agent_id: agentId, student_count: 1, total_topics: 0, students: [
      { user_id: "learner-a", display_name: "Example Student", agent_id: agentId, total_topics: 0, learned: 0, in_progress: 0, not_started: 0, pct_complete: 0, recently_active: [], struggle_areas: [], last_updated: now },
    ] } });
    if (path === "/api/teacher-dashboard/summary") return route.fulfill({ json: { teacherId: userId, courseCount: 1, agentIds: [agentId], totalStudents: 1, avgPctComplete: 0, totalTokens: 0, totalThreads: 0, activeThreads: 0, courses: [] } });
    if (path.startsWith("/api/")) return route.fulfill({ json: { success: true, status: "not_available", progress: null, threads: [...threads.values()], messages: [], assets: [], versions: [], starters: [], total: 0, hasMore: false } });
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.goto("/course/Example");
  await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible({ timeout: 30000 });
  return state;
}

async function openCurriculum(page: Page, tab: "Graph Memory" | "Graph editor" = "Graph Memory") {
  await page.getByRole("button", { name: "TA actions", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Course Curriculum/ }).click();
  const panel = page.getByRole("region", { name: "Course Curriculum", exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: tab, exact: true }).click();
  return panel;
}
async function sendDiagnostic(page: Page) {
  await page.getByRole("textbox", { name: "Ask anything about the course..." }).fill("Check my understanding.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const card = page.locator(`[id="asset-anchor-${instanceId}"]`).last();
  await expect(card).toBeVisible();
  await card.getByRole("button").click();
  await expect(page.getByLabel(/Reason for your choice/)).toBeVisible();
}

test("public diagnostic contracts retain stable identity without keys or mappings", () => {
  const quiz = parseQuizContent({ ...publicQuiz, questions: [{ ...publicQuiz.questions[0], correct: [0, 2], explanation: "private", targetsMisconception: "private" }] }, "temporary-surface");
  expect(quiz?.quizId).toBe(instanceId);
  expect(quiz?.curriculumVersion).toBe("v1");
  expect(quiz?.questions[0]).not.toHaveProperty("correct");
  expect(quiz?.questions[0]).not.toHaveProperty("targetsMisconception");
  expect(quiz?.questions[0]).not.toHaveProperty("explanation");
  expect(quiz?.questions[0].multiple).toBe(true);
  expect(parseQuizContent({ ...publicQuiz, assessmentInstanceId: undefined, quizId: "legacy", questions: [{ ...publicQuiz.questions[0], correct: [0, 2] }] })?.questions[0].correct).toEqual([0, 2]);
});

for (const transport of ["stream", "agui"] as const) {
  test(`${transport} preserves the server assessment identity and public questions`, async ({ page }) => {
    await mockMemory(page);
    const quizzes = await page.evaluate(async ({ agentId, userId, transport }) => {
      const apiPath = "/src/lib/api.ts";
      const adapterPath = "/src/lib/aguiAdapter.ts";
      const stream = transport === "stream" ? (await import(apiPath)).streamAgentChat : (await import(adapterPath)).streamAgentChatViaAGUI;
      const results: QuizContent[] = [];
      await stream(agentId, "A synthetic diagnostic request.", null, () => {}, {
        user_id: userId, event_id: `event-${transport}`, onQuiz: (quiz: QuizContent) => results.push(quiz),
      });
      return results;
    }, { agentId, userId, transport });
    expect(quizzes).toHaveLength(1);
    expect(quizzes[0]).toMatchObject({ quizId: instanceId, assessmentInstanceId: instanceId, curriculumVersion: "v1" });
    expect(quizzes[0].questions[0].multiple).toBe(true);
    expect(quizzes[0].questions[0]).not.toHaveProperty("correct");
    expect(quizzes[0].questions[0]).not.toHaveProperty("targetsMisconception");
  });
}

test("graph validators reject cycles, dangling mappings and unsafe policy JSON", () => {
  expect(validateGraph(graph, true)).toEqual([]);
  const invalid = structuredClone(graph);
  invalid.edges.push({ source_id: "tc-applied", target_id: "tc-basic", relation: "PREREQUISITE_OF" });
  expect(validateGraph(invalid).join(" ")).toContain("Prerequisite cycle:");
  invalid.edges[0].source_id = "missing";
  expect(validateGraph(invalid).join(" ")).toContain("Invalid PREREQUISITE_OF endpoints");
  expect(() => parsePolicy('{"version":"policy-v2","required_misconception_coverage":0.5}')).toThrow(/coverage must remain 1/);
  expect(() => parsePolicy("{bad json")).toThrow();
});

test("diagnostic waits for server grading and restores first attempt after reload", async ({ page }) => {
  const state = await mockMemory(page);
  let release = () => {};
  state.gradeBarrier = new Promise<void>(resolve => { release = resolve; });
  await sendDiagnostic(page);
  await page.getByRole("button", { name: /Current is conserved/ }).click();
  await page.getByRole("button", { name: /Current is consumed/ }).click();
  await page.getByLabel(/Reason for your choice/).fill("I compared the current at both points.");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect.poll(() => state.submissions.length).toBe(1);
  expect(state.submissions[0]).toMatchObject({ assessmentInstanceId: instanceId, quizId: instanceId, curriculumVersion: "v1", event_id: instanceId });
  expect(state.submissions[0].answers).toEqual([{ problemId: "problem-current", selected: [0, 1], reason: "I compared the current at both points." }]);
  await expect(page.getByText(/You got/)).toHaveCount(0);
  release();
  await expect(page.getByText("You got 0 out of 1 correct")).toBeVisible();
  await expect(page.getByText(/Memory processing pending/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retake Quiz" })).toHaveCount(0);
  await expect.poll(() => state.savedAssets.length).toBeGreaterThan(0);
  expect(state.savedAssets[0]).toMatchObject({ assessmentInstanceId: instanceId, curriculumVersion: "v1", quizId: instanceId });
  expect(JSON.stringify(state.savedAssets[0])).not.toContain('"correct"');
  await expect.poll(() => [...state.messages.values()].some(message => message.role === "assistant" && message.metadata?.contentBlocks)).toBe(true);
  await page.reload();
  const card = page.locator(`[id="asset-anchor-${instanceId}"]`).last();
  await expect(card).toBeVisible();
  await card.getByRole("button").click();
  await expect(page.getByText("You got 0 out of 1 correct")).toBeVisible();
  expect(state.submissions).toHaveLength(1);
  await page.getByRole("button", { name: "View Answers", exact: true }).click();
  await expect(page.getByText("Current is conserved; potential difference transfers energy.", { exact: true })).toBeVisible();
});

test("failed grading never reveals keys and retry reuses the submission event", async ({ page }) => {
  const state = await mockMemory(page);
  state.gradeStatus = 503;
  await sendDiagnostic(page);
  await page.getByRole("button", { name: /Current is conserved/ }).click();
  await page.getByLabel(/Reason for your choice/).fill("The current is the same at both points.");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /API Error 503/ })).toBeVisible();
  await expect(page.getByText(/You got/)).toHaveCount(0);
  state.gradeStatus = 200;
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText(/You got 0 out of 1 correct/)).toBeVisible();
  expect(state.submissions[0]).toEqual(state.submissions[1]);
});

test("saved diagnostic assets preserve curriculum version and frozen graded option text", async ({ page }) => {
  await mockMemory(page);
  const content = JSON.stringify({
    quiz: publicQuiz,
    firstAttempt: {
      assessmentInstanceId: instanceId, curriculumVersion: "v1", submittedAt: now, score: 0, totalQuestions: 1,
      answers: [{ question: publicQuiz.questions[0].question, options: publicQuiz.questions[0].options,
        selected: [0, 1], correct: [0, 2], isCorrect: false, reason: "A saved first attempt.", explanation: "Conservation applies." }],
    },
  });
  await page.evaluate(async content => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const rootPath = "/node_modules/.vite/deps/react-dom_client.js";
    const assetPath = "/src/components/assets/AssetContent.tsx";
    const reactModule = await import(reactPath);
    const React = reactModule.default || reactModule;
    const rootModule = await import(rootPath);
    const createRoot = rootModule.createRoot || rootModule.default?.createRoot;
    const { AssetContent } = await import(assetPath);
    const container = document.createElement("section");
    container.setAttribute("aria-label", "Saved diagnostic preview");
    document.body.append(container);
    createRoot(container).render(React.createElement(AssetContent, { content }));
  }, content);
  const preview = page.getByRole("region", { name: "Saved diagnostic preview" });
  await expect(preview.getByText("Current is conserved, Current is consumed", { exact: true })).toBeVisible();
  await expect(preview.getByText("Current is conserved, Potential difference transfers energy", { exact: true })).toBeVisible();
  await expect(preview.getByText(/Curriculum v1.*not a threshold crossing/)).toBeVisible();
});

test("server profile separates mastery, crossing, diagnostic gaps and stale evidence", async ({ page }) => {
  const state = await mockMemory(page);
  const panel = await openCurriculum(page);
  await expect(panel.getByRole("columnheader", { name: "Concept mastery" })).toBeVisible();
  await expect(panel.getByRole("columnheader", { name: "Threshold crossing" })).toBeVisible();
  const applied = panel.getByRole("row").filter({ has: page.getByRole("button", { name: "tc-applied", exact: true }) });
  await expect(applied).toContainText("Mastered");
  await expect(applied).toContainText("Candidate");
  await expect(panel.getByText(/1 event\(s\) pending/)).toBeVisible();
  await expect(panel.getByText("No assessed struggles recorded")).toBeVisible();
  await expect(panel.getByText(/Unassessed prerequisites are diagnostic gaps/)).toBeVisible();
  await panel.getByLabel("Inspect concept").selectOption("tc-applied");
  await panel.getByRole("button", { name: "Evidence evidence-example" }).click();
  await expect(panel.getByText("Two independent circuit probes supported this observation.")).toBeVisible();
  state.freshness = "stale";
  await panel.getByRole("button", { name: "Refresh Graph Memory" }).click();
  await expect(panel.getByText(/Revalidation required —/)).toBeVisible();
  state.freshness = "current";
  state.pending = 0;
  state.snapshot = { ...snapshot, snapshot_version: 0, as_of: null, concept_states: {}, threshold_states: {}, misconception_states: {},
    profile: { ...snapshot.profile!, active_tc: null, strong_tcs: [], weak_tcs: [], crossed_tcs: [], candidate_tcs: [],
      active_misconceptions: {}, unresolved_prerequisites: [], next_recommended_probe: null, updated_at: null } };
  await panel.getByRole("button", { name: "Refresh Graph Memory" }).click();
  await expect(panel.getByText("No evidence yet. Not assessed does not mean struggling.")).toBeVisible();
  state.memoryStatus = 503;
  await panel.getByRole("button", { name: "Refresh Graph Memory" }).click();
  await expect(panel.getByRole("alert").filter({ hasText: /No mastery or crossing can be inferred/ })).toBeVisible();
  await expect(panel.getByText("Mastered", { exact: true })).toHaveCount(0);
});

test("teacher edits graph and policy, saves with revision, and publishes without implicit activation", async ({ page }) => {
  const state = await mockMemory(page, "teacher");
  const panel = await openCurriculum(page, "Graph editor");
  const editor = panel.getByRole("region", { name: "Curriculum graph editor" });
  await expect(editor.getByText("Administrator course configuration", { exact: true })).toHaveCount(0);
  await expect(editor.getByLabel("Target graph version")).toHaveValue("v2");
  await editor.getByLabel("Crossing policy JSON").fill("{invalid");
  await editor.getByRole("button", { name: "Save graph draft" }).click();
  await expect(editor.getByRole("alert")).toBeVisible();
  expect(state.draftWrites).toHaveLength(0);
  await editor.getByLabel("Crossing policy JSON").fill(JSON.stringify(graph.policies));
  await editor.getByLabel("Name", { exact: true }).nth(2).fill("Current conservation — reviewed");
  await editor.getByRole("button", { name: "Save graph draft" }).click();
  await expect(editor.getByText(/Draft revision.*saved/)).toBeVisible();
  expect(state.draftWrites[0].expected_revision).toBe('"draft-1"');
  await editor.getByRole("button", { name: "Publish reviewed graph" }).click();
  await expect(editor.getByText(/A scoped administrator must activate this binding separately/)).toBeVisible();
  expect(state.publications[0]).toMatchObject({ curriculum_version: "v2", expected_revision: '"draft-2"', expected_course_revision: '"course-1"', reviewed: true });
  expect(state.publications[0].event_id).toEqual(expect.any(String));
  state.rejectDraft = true;
  await editor.getByLabel("Name", { exact: true }).nth(2).fill("Another local edit");
  await editor.getByRole("button", { name: "Save graph draft" }).click();
  await expect(editor.getByRole("alert")).toContainText("Reload it before saving or publishing");
  await expect(editor.getByLabel("Name", { exact: true }).nth(2)).toHaveValue("Another local edit");
});

test("teacher dashboard offers partial cohort breadth and course-scoped individual depth", async ({ page }) => {
  const state = await mockMemory(page, "teacher");
  await page.goto("/dashboard/students");
  const panel = page.getByRole("region", { name: "Teacher Graph Memory" });
  await expect(panel.getByText(/1 of 2 students.*Partial cohort/)).toBeVisible();
  await panel.getByLabel("Stable concept filter").fill("tc-applied");
  await panel.getByRole("button", { name: "Apply course filter" }).click();
  await panel.getByLabel("Individual evidence depth").selectOption("learner-a");
  await expect(panel.getByRole("region", { name: "Graph Memory", exact: true })).toBeVisible();
  await panel.getByLabel("Inspect concept").selectOption("tc-applied");
  await expect(panel.getByRole("button", { name: "Evidence evidence-example" })).toBeVisible();
  expect(state.scopeReads.some(path => path.includes(`/cohorts/${agentId}?tc_id=tc-applied`))).toBe(true);
  expect(state.scopeReads.some(path => path.includes("/learners/learner-a/memory/context") && path.includes("mode=individual"))).toBe(true);
  expect(state.scopeReads.every(path => path.includes(agentId))).toBe(true);
});

test("off mode preserves legacy quiz grading and hides all graph interfaces", async ({ page }) => {
  const state = await mockMemory(page, "teacher", "off");
  state.quiz = { ...publicQuiz, assessmentInstanceId: undefined, curriculumVersion: undefined, questions: [{ ...publicQuiz.questions[0], correct: [0, 2], explanation: "Legacy practice feedback" }] };
  await sendDiagnostic(page);
  await page.getByRole("button", { name: /Current is conserved/ }).click();
  await page.getByRole("button", { name: /Potential difference transfers energy/ }).click();
  await page.getByLabel(/Reason for your choice/).fill("Practice uses the existing workflow.");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("You got 1 out of 1 correct")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retake Quiz", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "TA actions", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Course Curriculum/ }).click();
  const panel = page.getByRole("region", { name: "Course Curriculum", exact: true });
  await expect(panel.getByRole("button", { name: "Graph Memory", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Graph editor", exact: true })).toHaveCount(0);
});

test("learner event identity survives regeneration and explicit edits supersede it", async ({ page }) => {
  const state = await mockMemory(page);
  await page.getByRole("textbox", { name: "Ask anything about the course..." }).fill("A stable learner input.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => state.chats.length).toBe(1);
  await page.getByRole("button", { name: "Retry generation", exact: true }).last().click();
  await expect.poll(() => state.chats.length).toBe(2);
  expect(state.chats[0].event_id).toEqual(expect.any(String));
  expect(state.chats[1].event_id).toBe(state.chats[0].event_id);
  await expect.poll(() => [...state.messages.values()].some(message => message.role === "user" && message.metadata?.eventId)).toBe(true);
  await page.getByRole("button", { name: "Edit message", exact: true }).last().click();
  await page.getByRole("textbox", { name: "", exact: true }).fill("An explicitly corrected learner input.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => state.chats.length).toBe(3);
  expect(state.chats[2].event_id).not.toBe(state.chats[0].event_id);
  expect(state.chats[2].supersedes_event_id).toBe(state.chats[0].event_id);
  await expect.poll(() => [...state.messages.values()].some(message => message.metadata?.supersedesEventId === state.chats[0].event_id)).toBe(true);
});

test("a failed evidence receipt is visible instead of an endless success-shaped pending state", async ({ page }) => {
  const state = await mockMemory(page);
  state.processingReceipt = { event_id: "failed-evidence", status: "FAILED", error_code: "ObservationValidationError", attempts: 5 };
  await openCurriculum(page);
  await expect(page.getByTestId("graph-memory-panel").getByRole("alert")).toContainText("Evidence processing failed");
  await expect(page.getByTestId("graph-memory-panel").getByRole("alert")).toContainText("Ask your teacher");
  await expect(page.getByRole("button", { name: "Retry evidence processing", exact: true })).toHaveCount(0);
});

test("teacher cohort pagination keeps each page explicitly partial", async ({ page }) => {
  const state = await mockMemory(page, "teacher");
  await page.goto("/dashboard/students");
  const panel = page.getByRole("region", { name: "Teacher Graph Memory", exact: true });
  await expect(panel.getByRole("button", { name: "Next cohort page", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Next cohort page", exact: true }).click();
  await expect(panel).toContainText("roster offset 1");
  await expect(panel).toContainText("Partial cohort");
  expect(state.scopeReads.some(path => path.includes("/memory/cohorts/") && path.includes("offset=1"))).toBe(true);
  await expect(panel.getByRole("button", { name: "Next cohort page", exact: true })).toHaveCount(0);
});
