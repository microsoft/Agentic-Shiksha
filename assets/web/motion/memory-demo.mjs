import assert from "node:assert/strict";
import { agentId, courseName } from "./platform-demo.mjs";

const sessions = new WeakMap();
const conceptId = "TC-ohms-law";
const misconceptionId = "M-resistance-current";
const instanceId = "memory-diagnostic-03";
const evidenceId = "evidence-ohms-03";
const curriculumId = "electricity-curriculum";
const curriculumVersion = "v1";
const problemId = "P-fixed-voltage";
const nextProblemId = "P-independent-context";
const reason = "I = V/R. At fixed voltage, doubling resistance halves the current.";
const previousTime = "2026-09-29T12:00:00Z";
const committedTime = "2026-09-30T08:30:00Z";
const question = {
  problemId,
  question: "At a fixed voltage, what happens to current when resistance doubles?",
  options: ["It doubles", "It halves", "It stays the same"],
  optionKeys: ["doubles", "halves", "unchanged"],
  multiple: false,
};

function memoryState(session, userId) {
  const after = session.committed;
  const snapshotVersion = after ? 2 : 1;
  const updatedAt = after ? committedTime : previousTime;
  const evidenceIds = after ? ["evidence-ohms-01", "evidence-ohms-02", evidenceId] : ["evidence-ohms-01", "evidence-ohms-02"];
  return {
    mode: "authoritative", snapshot_version: snapshotVersion, as_of: updatedAt, freshness: "current",
    pending_count: session.grade && !after ? 1 : 0,
    processing_receipt: session.grade ? { event_id: instanceId, status: after ? "COMPLETED" : "PENDING" } : null,
    scope: { curriculum_id: curriculumId, curriculum_version: curriculumVersion, course_id: agentId, student_id: userId },
    policy_version: "reviewed-demo-policy-v1",
    concept_states: {
      [conceptId]: { tc_id: conceptId, state: after ? "PROGRESSING" : "STRUGGLING",
        trend: after ? "IMPROVING" : "STABLE", qualifying_evidence_count: evidenceIds.length,
        evidence_ids: evidenceIds, updated_at: updatedAt },
    },
    threshold_states: {
      [conceptId]: { tc_id: conceptId, state: "NOT_CROSSED", required_cleared: 0, required_total: 1,
        transfer_state: "NOT_ATTEMPTED", evidence_ids: evidenceIds,
        reason_codes: ["INDEPENDENT_DIAGNOSTIC_REQUIRED"] },
    },
    misconception_states: {
      [misconceptionId]: { misconception_id: misconceptionId, state: after ? "RESOLVING" : "PRESENT",
        trend: after ? "IMPROVING" : "STABLE", qualifying_evidence_count: evidenceIds.length,
        evidence_ids: evidenceIds, updated_at: updatedAt },
    },
    profile: {
      active_tc: conceptId, strong_tcs: [], weak_tcs: after ? [] : [conceptId],
      candidate_tcs: [], crossed_tcs: [], unresolved_prerequisites: [],
      active_misconceptions: { [misconceptionId]: { state: after ? "RESOLVING" : "PRESENT", trend: after ? "IMPROVING" : "STABLE" } },
      learning_trend: after ? "IMPROVING" : "STABLE",
      next_recommended_probe: {
        tc_id: conceptId, misconception_id: misconceptionId,
        problem_id: after ? nextProblemId : problemId, reason_code: "INDEPENDENT_DIAGNOSTIC_REQUIRED",
      },
      curriculum_id: curriculumId, curriculum_version: curriculumVersion, policy_version: "reviewed-demo-policy-v1",
      snapshot_version: snapshotVersion, updated_at: updatedAt,
    },
  };
}

export const memoryDemo = {
  id: "memory",
  name: "shiksha-learner-memory-tutorial",
  title: "See how learner memory changes",
  role: "student",
  description: "Inspect the actual Graph Memory UI before and after a reasoned diagnostic, separating pending evidence, committed state, citations and the next probe.",
  async setup({ demo }) {
    const session = { grade: null, committed: false, submissions: [], snapshots: [], contextReads: [], evidenceReads: [], savedAssets: [] };
    sessions.set(demo, session);
    const learnerPath = `/api/agents/${agentId}/learners/${demo.account.userId}/memory`;
    demo.addApiHandler(async ({ path, method, request, url }) => {
      if (path === `/api/agents/${agentId}/memory/config` && method === "GET") {
        return { json: {
          enabled: true, graph_memory_mode: "authoritative", can_manage: false, revision: '"demo-course-1"',
          memory_scope: { tenant_id: "demo-tenant", institute_id: "demo-institute" },
          curriculum_binding: { curriculum_id: curriculumId, curriculum_version: curriculumVersion },
        } };
      }
      if (path === `/api/agents/${agentId}/course-curriculum` && method === "GET") return { json: {
        agent_name: agentId, status: "ready", can_retry: false,
        course_curriculum: {
          course_name: courseName,
          syllabus: [{ title: "Electrical fundamentals", topics: ["Voltage, current and resistance", "Ohm's law"], learning_objectives: ["Explain I = V/R."] }],
          all_threshold_concepts: ["Ohm's law"],
          "Ohm's law": { definition: "At fixed voltage, current is inversely related to resistance." },
        },
      } };
      if (path === `/api/agents/${agentId}/course-curriculum/translations` && method === "GET") return { json: {
        source_hash: "d".repeat(64), translations: [], default_instructions: "Translate the syllabus.",
        max_instructions_length: 2000,
      } };
      if (path === learnerPath && method === "GET") {
        const snapshot = memoryState(session, demo.account.userId);
        session.snapshots.push({ version: snapshot.snapshot_version, pending: snapshot.pending_count,
          concept: snapshot.concept_states[conceptId].state, misconception: snapshot.misconception_states[misconceptionId].state,
          crossing: snapshot.threshold_states[conceptId].state });
        return { json: snapshot };
      }
      if (path === `${learnerPath}/context` && method === "GET") {
        assert.equal(url.searchParams.get("tc_id"), conceptId);
        assert.equal(url.searchParams.get("mode"), "ta");
        session.contextReads.push(path);
        return { json: {
          tc_id: conceptId, snapshot_version: session.committed ? 2 : 1, complete: true,
          nodes: [{ id: conceptId, type: "TC", name: "Ohm's law" },
            { id: misconceptionId, type: "MISCONCEPTION", name: "More resistance means more current" }],
          edges: [{ id: "required-mapping", source_id: misconceptionId, target_id: conceptId,
            relation: "ASSOCIATED_WITH", required_for_crossing: true }],
          evidence: session.committed ? [{ evidence_id: evidenceId, source: "DIAGNOSTIC_RESPONSE",
            excerpt: "Selected: It halves. The linked record contains the learner's own reasoning." }] : [],
        } };
      }
      if (path === `${learnerPath}/evidence/${evidenceId}` && method === "GET") {
        assert(session.committed && session.grade, "Only committed evidence may be opened");
        session.evidenceReads.push(evidenceId);
        return { json: {
          evidence_id: evidenceId, event_id: instanceId, source: "DIAGNOSTIC_RESPONSE",
          problem_id: problemId, occurred_at: committedTime,
          answer: "It halves", reasoning: session.submissions[0].answers[0].reason,
        } };
      }
      if (path === "/api/quiz-assets" && method === "POST") {
        const body = request.postDataJSON();
        assert.equal(body.assessmentInstanceId, instanceId);
        assert.equal(body.curriculumVersion, curriculumVersion);
        assert(body.questions.every((item) => !Object.hasOwn(item, "correct") && !Object.hasOwn(item, "targetsMisconception")));
        session.savedAssets.push(body);
        return { json: { assetId: instanceId, createdAt: committedTime } };
      }
      if (path === `/api/quiz-attempts/${instanceId}/first` && method === "GET") return { json: {
        exists: Boolean(session.grade), assetId: session.grade?.assetId || null,
        submittedAt: session.grade?.submittedAt || null, ...(session.grade || {}),
      } };
      if (path === "/api/quiz-attempts/first" && method === "POST") {
        const body = request.postDataJSON();
        assert.equal(body.userId, demo.account.userId);
        assert.equal(body.agentId, agentId);
        assert.equal(body.assessmentInstanceId, instanceId);
        assert.equal(body.event_id, instanceId);
        assert.equal(body.curriculumVersion, curriculumVersion);
        assert.deepEqual(body.answers, [{ problemId, selected: [1], reason }]);
        assert(!session.grade, "The walkthrough submits one first attempt");
        session.submissions.push(body);
        session.grade = {
          created: true, assetId: instanceId, submittedAt: committedTime, score: 1, totalQuestions: 1,
          answers: [{
            question: question.question, problemId, options: question.options, selected: [1], correct: [1],
            isCorrect: true, reason, explanation: "With voltage fixed, doubling R halves V/R.",
          }],
          receipt: { event_id: instanceId, status: "PENDING" },
        };
        return { json: session.grade };
      }
      return undefined;
    });
  },
  async run({ page, demo, recorder, expect, helpers }) {
    const session = sessions.get(demo);
    assert(session);
    const curriculum = page.getByRole("region", { name: "Course Curriculum", exact: true });
    const memory = page.getByRole("region", { name: "Graph Memory", exact: true });
    async function openMemory() {
      await helpers.collapseNavigation();
      await recorder.click(page.getByRole("button", { name: "TA actions", exact: true }));
      await recorder.click(page.getByRole("menuitem", { name: /^Course Curriculum/ }));
      await expect(curriculum).toBeVisible();
      await recorder.click(curriculum.getByRole("button", { name: "Graph Memory", exact: true }));
      await expect(memory).toBeVisible();
      await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    }

    await recorder.chapter("01  Open Graph Memory: the course keeps a learner-specific, versioned snapshot.", async () => {
      await helpers.openCourse();
      await openMemory();
      await expect(memory.getByText(/Snapshot 1/)).toBeVisible();
      const row = memory.getByRole("row").filter({ has: page.getByRole("button", { name: conceptId, exact: true }) });
      await expect(row).toContainText("Struggling");
      await expect(row).toContainText("Not crossed");
      await recorder.hold(2.2);
    });
    await recorder.chapter("02  Two earlier demo probes support this misconception; one new answer is not clearance.", async () => {
      const evidence = memory.getByRole("region", { name: "Misconception evidence", exact: true });
      await recorder.move(evidence);
      await expect(evidence).toContainText("Present");
      await expect(evidence).toContainText("2 qualifying evidence item(s)");
      await recorder.hold(2.1);
      await recorder.click(curriculum.getByRole("button", { name: "Close", exact: true }));
    });
    let stream;
    await recorder.chapter("03  Answer a fresh diagnostic and explain the fixed-voltage condition.", async () => {
      stream = await helpers.ask("Check my understanding of current when resistance doubles at a fixed voltage.", 2.4);
      await helpers.emit({ type: "context_status", status: "ready" }, stream);
      await helpers.emit({ type: "message_block", content: "Explain your choice. The response becomes evidence to review; a score alone does not establish mastery." }, stream);
      await helpers.emit({ type: "quiz_start" }, stream);
      await recorder.hold(0.5);
      await helpers.emit({
        type: "quiz", quizId: instanceId, assessmentInstanceId: instanceId, curriculumVersion,
        title: "Ohm's law diagnostic", assessmentType: "concept_inventory", questions: [question],
      }, stream);
      await helpers.finishTurn(stream);
      await recorder.click(page.locator(`#asset-anchor-${instanceId}`).getByRole("button", { name: "Start", exact: true }));
      const pane = page.getByRole("region", { name: "Document pane", exact: true });
      await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
      await recorder.click(pane.getByRole("button", { name: /It halves$/ }));
      await recorder.type(pane.getByRole("textbox", { name: /Reason for your choice/ }).first(), reason, 2.4);
      await recorder.click(pane.getByRole("button", { name: "Submit", exact: true }));
      await expect(pane.getByText("You got 1 out of 1 correct", { exact: true })).toBeVisible();
      await expect(pane.getByText(/Memory processing pending/)).toBeVisible();
      await recorder.hold(1.7);
    });
    await recorder.chapter("04  Pending evidence does not replace the last committed memory snapshot.", async () => {
      await recorder.click(page.getByRole("region", { name: "Document pane", exact: true })
        .getByRole("button", { name: "Close document", exact: true }));
      await openMemory();
      await expect(memory.getByText(/Snapshot 1/)).toBeVisible();
      await expect(memory.getByText(/1 event\(s\) pending/)).toBeVisible();
      await recorder.hold(2.1);
    });
    await recorder.chapter("05  After demo processing commits, state improves without declaring mastery or crossing.", async () => {
      session.committed = true;
      await recorder.click(memory.getByRole("button", { name: "Refresh Graph Memory", exact: true }));
      await expect(memory.getByText(/Snapshot 2/)).toBeVisible();
      await expect(memory.getByText("No pending events reported.", { exact: true })).toBeVisible();
      const row = memory.getByRole("row").filter({ has: page.getByRole("button", { name: conceptId, exact: true }) });
      await expect(row).toContainText("Progressing");
      await expect(row).toContainText("Not crossed");
      await recorder.hold(2);
      const evidence = memory.getByRole("region", { name: "Misconception evidence", exact: true });
      await recorder.move(evidence);
      await expect(evidence).toContainText("Resolving");
      await expect(evidence).toContainText("Improving");
      await recorder.hold(2);
    });
    await recorder.chapter("06  Inspect the next probe and open the evidence behind the updated memory.", async () => {
      await recorder.move(memory.getByText(new RegExp(`Next recommended probe: ${nextProblemId}`)));
      await expect(memory.getByText(new RegExp(`Next recommended probe: ${nextProblemId}`))).toBeVisible();
      await recorder.hold(1.6);
      const select = memory.getByLabel("Inspect concept");
      await recorder.move(select);
      await select.selectOption(conceptId);
      await recorder.click(memory.getByRole("button", { name: `Evidence ${evidenceId}`, exact: true }));
      await expect(memory.getByText(reason, { exact: true })).toBeVisible();
      await expect(memory.getByText(/Required for crossing/)).toBeVisible();
      await recorder.hold(3.2);
      recorder.posterTime = recorder.frames / 12 - 1;
    });
    await recorder.chapter("07  The profile recommends another independent probe, not an automatic mastery claim.", async () => {
      await recorder.move(memory.getByText(new RegExp(`Next recommended probe: ${nextProblemId}`)));
      await expect(memory.getByText("No mastery evidence yet", { exact: true })).toBeVisible();
      await expect(memory.getByText("No verified crossings yet", { exact: true })).toBeVisible();
      await recorder.hold(2.8);
    });
    assert.equal(session.submissions.length, 1);
    assert(session.savedAssets.length > 0);
    assert(session.snapshots.some((snapshot) => snapshot.version === 1 && snapshot.pending === 0));
    assert(session.snapshots.some((snapshot) => snapshot.version === 1 && snapshot.pending === 1));
    assert(session.snapshots.some((snapshot) => snapshot.version === 2 && snapshot.pending === 0));
    assert(session.snapshots.every((snapshot) => snapshot.crossing === "NOT_CROSSED"));
    assert(session.contextReads.length > 0);
    assert.deepEqual(session.evidenceReads, [evidenceId]);
    assert.equal(await page.evaluate(() => globalThis.tutorialStreams.length), 1);
    return {
      feature: "custom-learner-memory",
      fixtureMode: "authoritative",
      snapshots: session.snapshots,
      submittedAssessmentId: instanceId,
      evidenceId,
      evidenceQuote: reason,
      nextProblemId,
      noAutomaticMasteryOrCrossing: true,
      provenance: "Synthetic before/pending/after API fixtures exercise the real Graph Memory UI; no live worker, model or state reducer was run.",
    };
  },
};
