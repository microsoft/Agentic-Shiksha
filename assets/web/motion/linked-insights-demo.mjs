import assert from "node:assert/strict";
import { agentId, courseName, question, quizId } from "./platform-demo.mjs";

const concept = "Current at fixed voltage";

export async function linkTeacherInsights(studentDemo, teacherDemo, teacherContext, origin) {
  const state = { quiz: null, submission: null, snapshots: [] };
  function snapshot() {
    return {
      learnerId: studentDemo.account.userId,
      courseId: agentId,
      savedLearnerTurns: [...studentDemo.messages.values()].filter((message) => message.role === "user").length,
      savedMessages: studentDemo.messages.size,
      quizCreated: Boolean(state.quiz),
      submitted: Boolean(studentDemo.attempt?.exists),
      score: studentDemo.attempt?.score ?? null,
      totalQuestions: studentDemo.attempt?.totalQuestions ?? null,
      reason: studentDemo.attempt?.exists ? state.submission.answers[0].reason : null,
    };
  }
  studentDemo.addApiHandler(async ({ path, method, request }) => {
    if (path === "/api/quiz-assets" && method === "POST") {
      const data = request.postDataJSON();
      assert.equal(data.quizId, quizId);
      state.quiz = structuredClone(data);
    }
    if (path === "/api/quiz-attempts/first" && method === "POST") {
      const data = request.postDataJSON();
      assert.equal(data.userId, studentDemo.account.userId);
      assert.equal(data.agentId, agentId);
      assert.equal(data.quizId, quizId);
      state.submission = structuredClone(data);
    }
    return undefined;
  });
  function studentSummary() {
    const current = snapshot();
    return {
      user_id: current.learnerId, display_name: "Demo Learner", agent_id: agentId,
      total_topics: 2, learned: 0, in_progress: 0, not_started: 2, pct_complete: 0,
      recently_active: [], struggle_areas: [],
      concepts_total: 1, concepts_learned: 0, concepts_in_progress: 0,
      concepts_not_started: 1, concepts_pct_complete: 0, explored: 0,
      assets: current.quizCreated ? 1 : 0,
      last_updated: current.savedLearnerTurns ? new Date().toISOString() : "",
    };
  }
  teacherDemo.addApiHandler(async ({ path, method, url }) => {
    if (method !== "GET") return undefined;
    const current = snapshot();
    const prefix = "/api/teacher-dashboard";
    if (path === `${prefix}/agents`) return { json: {
      agents: [{ id: agentId, agentId, name: agentId, courseName, courseLevel: "Certificate", courseCode: "ELEC100",
        courseDuration: "1 Month", createdById: teacherDemo.account.userId }],
      count: 1,
    } };
    if (path === `${prefix}/summary`) return { json: {
      teacherId: teacherDemo.account.userId, courseCount: 1, agentIds: [agentId],
      totalStudents: 1, activeStudents: current.savedLearnerTurns ? 1 : 0, avgPctComplete: 0,
      totalTokens: 0, totalThreads: studentDemo.threads.size, activeThreads: current.savedLearnerTurns ? 1 : 0,
      courses: [{ agentId, name: courseName, studentCount: 1, activeStudentCount: current.savedLearnerTurns ? 1 : 0,
        avgPctComplete: 0, totalTokens: 0, activeThreads: current.savedLearnerTurns ? 1 : 0 }],
    } };
    if (path === `${prefix}/usage/analytics`) return { json: {
      startDate: url.searchParams.get("start_date") || "2026-09-01",
      endDate: url.searchParams.get("end_date") || "2026-09-30",
      granularity: url.searchParams.get("granularity") || "day", scope: "course",
      usageSource: "cosmos", sourceResponses: 0, totalInputTokens: 0, totalOutputTokens: 0,
      totalTokens: 0, activeStudents: current.savedLearnerTurns ? 1 : 0,
      trackedResponses: 0, totalResponses: 0, coveragePct: 0,
      series: [], dailySeries: [], distribution: [],
      distributionSuppressed: true, minimumDistributionStudents: 5,
    } };
    if (path === `${prefix}/agents/${agentId}/overview`) return { json: {
      agent_id: agentId, student_count: 1, avg_pct_complete: 0, total_topics: 2,
      distribution: { "0-25%": 1, "25-50%": 0, "50-75%": 0, "75-100%": 0 },
      top_struggle_topics: [], students: [studentSummary()],
      usage: { agent_id: agentId, total_students: 1, active_students: current.savedLearnerTurns ? 1 : 0,
        active_teachers: 1, total_threads: studentDemo.threads.size, active_threads: current.savedLearnerTurns ? 1 : 0 },
    } };
    if (path === `${prefix}/agents/${agentId}/curriculum`) return { json: {
      agent_id: agentId, total_topics: 2, total_concepts: 1,
      threshold_concepts: [{ concept, description: "Explain the inverse relationship while holding voltage fixed.",
        why_threshold: "A prediction must state which variable is unchanged.", misconceptions: ["Voltage and current are interchangeable."], related_chapters: ["Ohm's law"] }],
      syllabus: [{ module_id: "fundamentals", title: "Circuit fundamentals", topics: ["Voltage and current", "Ohm's law"],
        learning_objectives: ["Use I = V / R with explicit assumptions."], prerequisites: [], concepts: [concept] }],
    } };
    const learnerPath = `${prefix}/agents/${agentId}/students/${studentDemo.account.userId}`;
    if (path === learnerPath) return { json: {
      ...studentSummary(), total_concepts: 1,
      topics_by_status: { learned: [], in_progress: [], not_started: ["Voltage and current", "Ohm's law"].map((topic) => ({
        topic, status: "not_started", latest_summary: "", last_updated: "", module: "Circuit fundamentals",
      })) },
      concepts_by_status: { learned: [], in_progress: [], not_started: [{
        concept, status: "not_started", misconceptions_addressed: [], last_updated: "", description: "No mastery claim from usage alone.",
      }] },
      syllabus: [], off_plan_topics: [],
    } };
    if (path === `${learnerPath}/assets`) return { json: { assets: current.quizCreated ? [{
      id: quizId, title: state.quiz.title, description: "Synthetic concept check from the linked student session.",
      category: "quiz", type: "quiz", tags: [], thread_id: "tutorial-conversation", preview_image_url: "",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }] : [] } };
    if (path === `${learnerPath}/assets/${quizId}` && current.quizCreated) return { json: {
      id: quizId, title: state.quiz.title, description: "Linked synthetic concept check", category: "quiz", type: "quiz",
      content: JSON.stringify({ quizId, title: state.quiz.title, assessmentType: "concept_inventory", questions: [question] }),
      created_at: new Date().toISOString(),
    } };
    return undefined;
  });
  await teacherContext.addInitScript(({ origin }) => {
    if (location.origin !== origin) return;
    const original = window.fetch.bind(window);
    globalThis.insightStreams = [];
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin !== origin || url.pathname !== "/api/teacher-dashboard/logging-agent/chat/stream") return original(input, init);
      const request = JSON.parse(String(init.body));
      let closed = false, emit;
      const stream = new ReadableStream({
        start(controller) {
          emit = (event) => {
            if (closed) throw new Error("Insights stream is closed");
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            if (event.type === "done") { closed = true; controller.close(); }
          };
          init.signal?.addEventListener("abort", () => {
            if (!closed) { closed = true; controller.error(new DOMException("Aborted", "AbortError")); }
          }, { once: true });
          emit({ type: "thread_id", thread_id: "linked-teacher-insights" });
        },
      });
      globalThis.insightStreams.push({ request, emit });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    };
  }, { origin });
  return {
    state, snapshot,
    async answer(page, index) {
      const request = await page.evaluate((i) => globalThis.insightStreams[i].request, index);
      assert.equal(request.agent_id, agentId);
      assert.deepEqual(request.student_ids, [studentDemo.account.userId], "Insights must be scoped to the same student");
      const current = snapshot();
      assert(current.savedLearnerTurns >= 1 && current.quizCreated, "Teacher must see activity actually created in the student session");
      state.snapshots.push({ request, ...current });
      return current.submitted
        ? [
          "### Submission received",
          `**Demo Learner** has ${current.savedLearnerTurns} saved learner turns and **${current.totalQuestions} submitted concept check**. Result: **${current.score}/${current.totalQuestions} correct**.`,
          `**Their reasoning:** "${current.reason}"`,
          "**Suggested next teaching move:** ask what happens if both voltage and resistance double. The ratio stays unchanged.",
          "**Do not infer mastery** from one correct answer. These facts come from the linked local simulation, not a live analytics service.",
        ].join("\n\n")
        : [
          "### Activity so far",
          `**Demo Learner** has ${current.savedLearnerTurns} saved learner turn and **one generated concept check** on current and resistance.`,
          "**No assessment has been submitted yet.** A draft answer is not saved evidence, so I cannot grade or quote it.",
          "**Teaching focus:** check whether the learner states that voltage is fixed. This is a snapshot of the linked simulation, not a mastery judgement.",
        ].join("\n\n");
    },
    verify() {
      assert.equal(state.snapshots.length, 2, "Two teacher queries must observe the same learner at different stages");
      assert.equal(state.snapshots[0].submitted, false);
      assert.equal(state.snapshots[0].reason, null, "An unsent learner draft must not be exposed");
      assert.equal(state.snapshots[1].submitted, true);
      assert.equal(state.snapshots[1].score, 1);
      assert(state.snapshots[1].reason.includes("voltage fixed"));
      assert(state.snapshots[1].savedMessages > state.snapshots[0].savedMessages);
      studentDemo.verify();
      teacherDemo.verify();
    },
  };
}
