import assert from "node:assert/strict";
import { agentId, courseName } from "./platform-demo.mjs";

const prefix = "/api/teacher-dashboard";
const learnerId = "tutorial-learner-a";
const secondLearnerId = "tutorial-learner-b";
const learnerPath = `${prefix}/agents/${agentId}/students/${learnerId}`;
const concept = "Current at fixed voltage";
const conceptDescription = "Explain how current changes when resistance changes while voltage stays fixed.";
const moduleTitle = "Circuit fundamentals";
const topicSummary = "Compared two fixed-voltage examples; a fresh explanation is still needed.";
const artifact = {
  id: "tutorial-fixed-voltage-note",
  title: "My fixed-voltage comparison",
  description: "Synthetic learner work for this tutorial; not a mastery assessment.",
  category: "document",
  type: "markdown",
  created_at: "2026-09-23T10:00:00Z",
  content: [
    "# A fixed-voltage comparison",
    "",
    "**Synthetic learner work - tutorial example.**",
    "",
    "| Case | Voltage | Resistance | Current |",
    "|---|---|---|---|",
    "| A | 12 V | 6 ohms | 2 A |",
    "| B | 12 V | 12 ohms | 1 A |",
    "",
    "## My reasoning",
    "",
    "At the same voltage, doubling resistance halves the current because **I = V / R**.",
    "",
    "## Next check",
    "",
    "Try a different numerical example and explain what is held constant. This saved note does not establish mastery.",
    "",
    "These are hypothetical circuit calculations, not physical wiring instructions.",
  ].join("\n"),
};
const tokenEvents = [
  ["2026-09-02", learnerId, 400, 200],
  ["2026-09-05", secondLearnerId, 560, 240],
  ["2026-09-09", learnerId, 720, 280],
  ["2026-09-12", secondLearnerId, 630, 270],
  ["2026-09-16", learnerId, 840, 360],
  ["2026-09-18", secondLearnerId, 910, 390],
  ["2026-09-21", learnerId, 1050, 450],
  ["2026-09-23", learnerId, 980, 420],
  ["2026-09-26", secondLearnerId, 1190, 510],
  ["2026-09-29", learnerId, 1120, 480],
].map(([date, userId, inputTokens, outputTokens]) => ({
  date, userId, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
}));
const states = new WeakMap();

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function groupSeries(dailySeries, granularity, fields) {
  const groups = new Map();
  for (const point of dailySeries) {
    const monday = new Date(`${point.periodStart}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const key = granularity === "month" ? point.periodStart.slice(0, 7)
      : granularity === "week" ? isoDay(monday) : point.periodStart;
    const previous = groups.get(key);
    groups.set(key, {
      ...point,
      periodStart: previous?.periodStart ?? point.periodStart,
      ...Object.fromEntries(fields.map((field) => [field, (previous?.[field] ?? 0) + point[field]])),
    });
  }
  return [...groups.values()];
}

function analyticsResponse(url, metric) {
  assert.equal(url.searchParams.get("agent_id"), agentId, "Analytics must stay scoped to the selected course");
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  const granularity = url.searchParams.get("granularity");
  assert(["day", "week", "month"].includes(granularity));
  for (const value of [startDate, endDate]) {
    assert.match(value ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(isoDay(new Date(`${value}T00:00:00Z`)), value);
  }
  assert(startDate <= endDate && startDate >= "2026-03-30" && endDate <= "2026-09-30");
  assert(["tokens", "assets_created"].includes(metric), "This tutorial does not fabricate threshold crossings");

  const events = (metric === "tokens" ? tokenEvents : [
    { date: artifact.created_at.slice(0, 10), userId: learnerId, count: 1 },
  ]).filter((event) => event.date >= startDate && event.date <= endDate);
  const fields = metric === "tokens" ? ["inputTokens", "outputTokens", "totalTokens"] : ["count"];
  const totals = Object.fromEntries(fields.map((field) => [field, 0]));
  const dailySeries = [];
  for (const day = new Date(`${startDate}T00:00:00Z`); isoDay(day) <= endDate; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = isoDay(day);
    const dailyEvents = events.filter((event) => event.date === date);
    const values = Object.fromEntries(fields.map((field) => [
      field, dailyEvents.reduce((sum, event) => sum + event[field], 0),
    ]));
    for (const field of fields) totals[field] += values[field];
    dailySeries.push({
      periodStart: date, periodEnd: date, ...values,
      ...(metric === "tokens" ? {
        cumulativeInputTokens: totals.inputTokens,
        cumulativeOutputTokens: totals.outputTokens,
        cumulativeTokens: totals.totalTokens,
      } : { cumulativeCount: totals.count }),
    });
  }
  const common = {
    startDate, endDate, granularity, scope: "course",
    activeStudents: new Set(events.map((event) => event.userId)).size,
    series: groupSeries(dailySeries, granularity, fields), dailySeries,
    distribution: [], distributionSuppressed: true, minimumDistributionStudents: 5,
  };
  return metric === "tokens" ? {
    ...common, usageSource: "cosmos", sourceResponses: events.length,
    totalInputTokens: totals.inputTokens, totalOutputTokens: totals.outputTokens,
    totalTokens: totals.totalTokens, trackedResponses: events.length,
    totalResponses: events.length, coveragePct: events.length ? 100 : 0,
  } : {
    ...common, metric, totalEvents: totals.count,
    activeCourses: events.length ? 1 : 0, activeDays: new Set(events.map((event) => event.date)).size,
  };
}

async function setupTeacherDashboard({ page, demo, baseURL }) {
  assert.equal(new URL(baseURL).origin, "http://127.0.0.1:4188", "Use only the isolated tutorial frontend");
  assert.equal(demo.account.role, "teacher");
  await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));

  const students = [
    [learnerId, "Demo Learner A", 2, 1, "2026-09-29T10:00:00Z"],
    [secondLearnerId, "Demo Learner B", 1, 0, "2026-09-26T10:00:00Z"],
    ["tutorial-learner-c", "Demo Learner C", 0, 0, ""],
  ].map(([user_id, display_name, in_progress, assets, last_updated]) => ({
    user_id, display_name, agent_id: agentId, total_topics: 3,
    learned: 0, in_progress, not_started: 3 - in_progress, pct_complete: 0,
    recently_active: in_progress ? [{ topic: "Resistance and Ohm's law", status: "in_progress", last_updated }] : [],
    struggle_areas: [], concepts_total: 2, concepts_learned: 0,
    concepts_in_progress: in_progress ? 1 : 0, concepts_not_started: in_progress ? 1 : 2,
    concepts_pct_complete: 0, explored: 0, assets, last_updated,
  }));
  const topics = [
    { topic: "Voltage and current", status: "in_progress", latest_summary: "Began distinguishing voltage from current." },
    { topic: "Resistance and Ohm's law", status: "in_progress", latest_summary: topicSummary },
    { topic: "Reading circuit diagrams", status: "not_started", latest_summary: "" },
  ];
  const curriculumConcepts = [
    {
      concept, description: conceptDescription,
      why_threshold: "A prediction must say which variable remains unchanged.",
      misconceptions: ["More resistance always means more current."],
      related_chapters: ["Resistance and Ohm's law"],
    },
    {
      concept: "Potential difference and energy transfer",
      description: "Distinguish energy transferred per charge from the flow of charge.",
      why_threshold: "Voltage and current describe different quantities.",
      misconceptions: [], related_chapters: ["Voltage and current"],
    },
  ];
  const syllabus = [{
    module_id: "circuit-fundamentals", title: moduleTitle,
    topics: topics.map((topic) => topic.topic),
    learning_objectives: ["Use I = V / R and state the fixed-voltage assumption."],
    prerequisites: [], concepts: curriculumConcepts.map((entry) => entry.concept),
  }];
  const { content: _content, ...assetMetadata } = artifact;
  const responses = new Map([
    [`${prefix}/agents`, {
      agents: [{
        id: agentId, agentId, name: agentId, courseName,
        courseLevel: "Certificate", courseCode: "ELEC100", courseDuration: "1 Month",
        createdById: demo.account.userId,
      }], count: 1,
    }],
    [`${prefix}/summary`, {
      teacherId: demo.account.userId, courseCount: 1, agentIds: [agentId],
      totalStudents: 3, activeStudents: 2, avgPctComplete: 0,
      totalTokens: 12000, totalThreads: 2, activeThreads: 2,
      courses: [{
        agentId, name: courseName, studentCount: 3, activeStudentCount: 2,
        avgPctComplete: 0, totalTokens: 12000, activeThreads: 2,
      }],
    }],
    [`${prefix}/agents/${agentId}/overview`, {
      agent_id: agentId, student_count: 3, avg_pct_complete: 0, total_topics: 3,
      distribution: { "0-25%": 3, "25-50%": 0, "50-75%": 0, "75-100%": 0 },
      top_struggle_topics: [], students,
      usage: { agent_id: agentId, total_students: 3, active_students: 2, active_teachers: 1, total_threads: 2, active_threads: 2 },
    }],
    [`${prefix}/agents/${agentId}/curriculum`, {
      agent_id: agentId, threshold_concepts: curriculumConcepts, syllabus, total_concepts: 2, total_topics: 3,
    }],
    [learnerPath, {
      user_id: learnerId, display_name: "Demo Learner A", email: "user@example.com",
      agent_id: agentId, total_topics: 3, learned: 0, in_progress: 2, not_started: 1,
      pct_complete: 0, total_concepts: 2, concepts_learned: 0, concepts_in_progress: 1,
      concepts_pct_complete: 0, last_updated: students[0].last_updated,
      topics_by_status: Object.fromEntries(["learned", "in_progress", "not_started"].map((status) => [
        status, topics.filter((topic) => topic.status === status).map((topic) => ({
          ...topic, module: moduleTitle, last_updated: topic.status === "not_started" ? "" : students[0].last_updated,
        })),
      ])),
      concepts_by_status: {
        learned: [],
        in_progress: [{
          ...curriculumConcepts[0], status: "in_progress", misconceptions_addressed: [],
          misconceptions: [{
            misconception: "More resistance always means more current.",
            why_wrong: "At a fixed voltage, I = V / R decreases when resistance increases.",
          }], last_updated: students[0].last_updated,
        }],
        not_started: [{ ...curriculumConcepts[1], status: "not_started", misconceptions_addressed: [], last_updated: "" }],
      },
      syllabus: [{
        ...syllabus[0], topics, learned: 0,
        concepts: curriculumConcepts.map((entry, index) => ({ concept: entry.concept, status: index ? "not_started" : "in_progress" })),
      }],
      off_plan_topics: [],
    }],
    [`${learnerPath}/assets`, { assets: [{
      ...assetMetadata, tags: [`course:${courseName}`, "synthetic"],
      thread_id: "tutorial-electricity-practice", preview_image_url: "", updated_at: artifact.created_at,
    }] }],
    [`${learnerPath}/assets/${artifact.id}`, artifact],
  ]);
  const state = { reads: new Set(), analytics: [] };
  states.set(demo, state);
  demo.addApiHandler(async ({ path, method, url }) => {
    if (method !== "GET") return undefined;
    if (path === `${prefix}/usage/analytics` || path === `${prefix}/activity/analytics`) {
      const metric = path === `${prefix}/usage/analytics` ? "tokens" : url.searchParams.get("metric");
      const json = analyticsResponse(url, metric);
      state.reads.add(path);
      state.analytics.push({ metric, query: url.search, response: json });
      return { json, status: 200 };
    }
    if (!responses.has(path)) return undefined;
    state.reads.add(path);
    return { json: responses.get(path), status: 200 };
  });
}

async function openDashboard({ page, recorder, expect, helpers }) {
  await recorder.click(page.getByRole("complementary").first().getByRole("button", { name: "Dashboard", exact: true }));
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Select course", exact: true })).toHaveValue(agentId);
  await expect(page.getByRole("heading", { name: "Completion distribution", exact: true })).toBeVisible();
  await helpers.collapseNavigation();
}

function verification(demo) {
  const state = states.get(demo);
  assert(state, "The teacher fixture must be installed before recording");
  assert(!demo.requests.some((request) => request.startsWith(`POST ${prefix}/`)), "Dashboard tutorials are read-only");
  assert(!demo.requests.some((request) => request.includes("/logging-agent/")), "Insights is covered by the separate tutorial");
  return {
    synthetic: true, courseId: agentId, enrolledLearners: 3, conceptsCrossed: 0,
    readOnly: true, endpoints: [...state.reads].sort(),
  };
}

export const teacherDemos = [
  {
    id: "teacher-roster",
    name: "shiksha-teacher-roster-tutorial",
    title: "Review learners and their work",
    role: "teacher",
    description: "Open the real course dashboard, inspect a synthetic learner's concepts and syllabus topics, and review one saved document without claiming mastery.",
    async setup(ctx) {
      await setupTeacherDashboard(ctx);
    },
    async run(ctx) {
      const { page, demo, recorder, expect, helpers } = ctx;
      await recorder.chapter("01  Open Dashboard and confirm the course before reviewing its learners.", async () => {
        await recorder.hold(1.2);
        await openDashboard(ctx);
        await recorder.move(page.getByRole("combobox", { name: "Select course", exact: true }));
        await recorder.hold(3.2);
      });
      await recorder.chapter("02  My Students shows the roster and the course plan side by side.", async () => {
        await recorder.click(page.getByRole("button", { name: "My Students", exact: true }));
        await expect(page.getByRole("heading", { name: "Course roster", exact: true })).toBeVisible();
        await expect(page.getByText("3 enrolled", { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Course plan", exact: true })).toBeVisible();
        await recorder.hold(3);
      });
      await recorder.chapter("03  Select a learner and expand a concept. In progress is not a mastery claim.", async () => {
        await recorder.click(page.getByRole("button", { name: /Demo Learner A/ }));
        await expect(page.getByRole("heading", { name: "Demo Learner A", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: /^Threshold concepts 0\/2$/ })).toBeVisible();
        await recorder.hold(1.2);
        const conceptButton = page.getByRole("button", { name: concept, exact: true });
        await recorder.click(conceptButton);
        await expect(conceptButton).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByText(conceptDescription, { exact: true })).toBeVisible();
        await expect(page.getByText("In progress", { exact: true })).toBeVisible();
        await recorder.hold(3.2);
      });
      await recorder.chapter("04  Switch to Topics to read the learner's recorded work against the syllabus.", async () => {
        await recorder.click(page.getByRole("button", { name: /^Topics 0\/3$/ }));
        const moduleButton = page.getByRole("button", { name: new RegExp(moduleTitle) });
        await recorder.click(moduleButton);
        await expect(moduleButton).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByText(topicSummary, { exact: true })).toBeVisible();
        await expect(page.getByText("Reading circuit diagrams", { exact: true })).toBeVisible();
        await recorder.hold(4);
      });
      await recorder.chapter("05  Open Assets to read the saved example, with navigation already collapsed.", async () => {
        await helpers.collapseNavigation();
        await recorder.click(page.getByRole("button", { name: "Assets 1", exact: true }));
        const cardTitle = page.getByRole("heading", { name: artifact.title, exact: true });
        await expect(cardTitle).toHaveCount(1);
        await recorder.hold(1.6);
        await helpers.collapseNavigation();
        recorder.assetChecks.push({ event: "teacher-document-preview", atSeconds: recorder.frames / 12, navigationCollapsed: true });
        await recorder.click(cardTitle);
        const preview = page.getByRole("dialog", { name: artifact.title, exact: true });
        await expect(preview).toBeVisible();
        await expect(preview.getByRole("heading", { name: "My reasoning", exact: true })).toBeVisible();
        await expect(preview.getByText("Synthetic learner work - tutorial example.", { exact: true })).toBeVisible();
        await expect(preview.getByText(/This saved note does not establish mastery/)).toBeVisible();
        await recorder.hold(4.3);
        recorder.posterTime = recorder.frames / 12 - 1;
      });
      await recorder.chapter("06  Close the preview to return to the same learner and their course work.", async () => {
        await recorder.click(page.getByRole("dialog", { name: artifact.title, exact: true }).getByRole("button", { name: "Close", exact: true }));
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Demo Learner A", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Assets 1", exact: true })).toHaveAttribute("aria-pressed", "true");
        await recorder.hold(3);
      });
      for (const path of [learnerPath, `${learnerPath}/assets`, `${learnerPath}/assets/${artifact.id}`]) {
        assert(states.get(demo).reads.has(path), `The actual learner view must request ${path}`);
      }
      return { ...verification(demo), learnerId, openedAssetId: artifact.id, navigationCollapsedBeforeAsset: true };
    },
  },
  {
    id: "teacher-usage",
    name: "shiksha-teacher-usage-tutorial",
    title: "Explore course usage and activity",
    role: "teacher",
    description: "Use the real Dashboard Learning activity controls to filter dates, group tracked token usage, and compare saved-asset activity with small-cohort privacy suppression.",
    async setup(ctx) {
      await setupTeacherDashboard(ctx);
    },
    async run(ctx) {
      const { page, demo, recorder, expect } = ctx;
      const activity = page.getByRole("region", { name: "Learning activity", exact: true });
      const grouping = activity.getByRole("group", { name: "Usage grouping", exact: true });
      const totalTokens = activity.locator("dl > div").filter({ hasText: "Total tokens" }).locator("dd");
      await recorder.chapter("01  Open Dashboard, then find Learning activity for the selected course.", async () => {
        await recorder.hold(1.2);
        await openDashboard(ctx);
        await recorder.hold(1.2);
        await recorder.move(activity);
        await expect(activity.getByRole("radiogroup", { name: "Usage metric", exact: true })).toBeVisible();
        await expect(totalTokens).toHaveText("12k");
        await recorder.hold(2.2);
      });
      await recorder.chapter("02  Review tracked tokens and responses; the calendar spans the rolling six months.", async () => {
        await expect(activity.getByRole("radio", { name: "Tokens", exact: true })).toHaveAttribute("aria-checked", "true");
        await expect(activity.getByRole("heading", { name: "Token consumption calendar", exact: true })).toBeVisible();
        await expect(activity.getByRole("heading", { name: "Cumulative tracked usage", exact: true })).toBeVisible();
        await expect(activity.locator("dl > div").filter({ hasText: "Responses" }).locator("dd")).toHaveText("10");
        await recorder.hold(4);
      });
      await recorder.chapter("03  Set From and To to focus on a two-week window of course activity.", async () => {
        for (const [label, value] of [["From", "2026-09-15"], ["To", "2026-09-28"]]) {
          const field = activity.getByLabel(label, { exact: true });
          await recorder.move(field);
          await field.fill(value);
          await field.press("Tab");
          await expect(field).toHaveValue(value);
          await recorder.hold(1.2);
        }
        await expect(totalTokens).toHaveText("7,100");
        await expect(activity.locator("dl > div").filter({ hasText: "Responses" }).locator("dd")).toHaveText("5");
        await recorder.hold(2.3);
      });
      await recorder.chapter("04  Group by week to compare periods without changing the selected course or dates.", async () => {
        await recorder.click(grouping.getByRole("button", { name: "week", exact: true }));
        await expect(grouping.getByRole("button", { name: "week", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(totalTokens).toHaveText("7,100");
        await expect(activity.getByRole("img", { name: "Cumulative input, output, and total tracked token usage over the selected date range", exact: true })).toBeVisible();
        await recorder.hold(3.5);
      });
      await recorder.chapter("05  Switch to Assets and daily grouping to inspect when saved work was created.", async () => {
        await recorder.click(activity.getByRole("radio", { name: "Assets", exact: true }));
        await expect(activity.getByRole("radio", { name: "Assets", exact: true })).toHaveAttribute("aria-checked", "true");
        await expect(activity.getByRole("heading", { name: "Cumulative assets created", exact: true })).toBeVisible();
        await recorder.hold(1.2);
        await recorder.click(grouping.getByRole("button", { name: "day", exact: true }));
        await expect(grouping.getByRole("button", { name: "day", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(activity.locator("dl > div").filter({ hasText: "Assets created" }).locator("dd")).toHaveText("1");
        await expect(activity.getByRole("heading", { name: "Asset creation calendar", exact: true })).toBeVisible();
        await expect(activity.getByRole("img", { name: "Cumulative assets over the selected date range", exact: true })).toBeVisible();
        await recorder.hold(3.6);
        recorder.posterTime = recorder.frames / 12 - 1;
      });
      await recorder.chapter("06  Small-cohort distributions stay hidden. Activity counts do not prove mastery.", async () => {
        const privacyNote = activity.getByText("Available once at least 5 students have activity in this range.", { exact: true });
        await recorder.move(privacyNote);
        await expect(privacyNote).toBeVisible();
        await expect(activity.getByLabel("Student activity distribution", { exact: true })).toHaveCount(0);
        await recorder.hold(3.8);
      });
      const analytics = states.get(demo).analytics;
      const selectedRange = (entry) => entry.response.startDate === "2026-09-15" && entry.response.endDate === "2026-09-28";
      const weekly = analytics.find((entry) => selectedRange(entry) && entry.metric === "tokens" && entry.response.granularity === "week");
      assert(weekly, "Weekly grouping must reach the scoped usage endpoint");
      assert.equal(weekly.response.totalTokens, 7100);
      assert.deepEqual(weekly.response.series.map((point) => [point.periodStart, point.periodEnd, point.totalTokens]), [
        ["2026-09-15", "2026-09-20", 2500], ["2026-09-21", "2026-09-27", 4600], ["2026-09-28", "2026-09-28", 0],
      ]);
      const assets = analytics.find((entry) => selectedRange(entry) && entry.metric === "assets_created" && entry.response.granularity === "day");
      assert(assets, "The Assets metric must reach the scoped activity endpoint");
      assert.equal(assets.response.totalEvents, 1);
      assert.equal(assets.response.activeStudents, 1);
      assert(assets.response.distributionSuppressed);
      assert.deepEqual(assets.response.dailySeries.filter((point) => point.count).map((point) => point.periodStart), ["2026-09-23"]);
      return {
        ...verification(demo), selectedRange: { from: "2026-09-15", to: "2026-09-28" },
        groupedTokens: 7100, assetEvents: 1, distributionSuppressed: true,
        analyticsQueries: analytics.map(({ metric, query }) => ({ metric, query })),
      };
    },
  },
];
