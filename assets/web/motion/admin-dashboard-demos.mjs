import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const institute = "Demo Technical Institute";
const department = "Applied Science";
const courseId = "tutorial-admin-electricity";
const courseName = "Electricity Basics";
const learnerId = "tutorial-admin-learner";
const learnerName = "Demo Learner";
const existingStudentIds = ["tutorial-admin-classmate", "tutorial-admin-partner"];
const expectedStudentIds = [...existingStudentIds, learnerId];
const fixedTime = new Date("2026-09-23T12:00:00Z");
const noStarters = {
  applicable: false,
  reason: "The native admin dashboard does not have course-chat starters.",
};

export async function installAdminDemo(context, baseURL, role) {
  assert.equal(role, "admin");
  assert.equal(context.pages().length, 0, "Install admin fixtures before creating a page");
  assert.equal(context.serviceWorkers().length, 0, "Admin tutorials require a fresh context");
  const base = new URL(baseURL);
  assert.equal(base.protocol, "http:");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Admin tutorials must use a local frontend");
  assert.equal(base.username + base.password, "", "Tutorial origins must not contain credentials");
  const origin = base.origin;
  const account = {
    userId: "tutorial-admin", displayName: "Demo Administrator", email: "user@example.com",
    role: "admin", status: "active", authProvider: "microsoft", isAuthenticated: true,
  };
  const font = await readFile(join(here, "node_modules", "@fontsource-variable", "sora", "files", "sora-latin-wght-normal.woff2"));
  const students = [
    { user_id: existingStudentIds[0], name: "Demo Classmate", email: "" },
    { user_id: existingStudentIds[1], name: "Demo Partner", email: "" },
    { user_id: learnerId, name: learnerName, email: "user@example.com" },
  ].map(student => ({ ...student, institute, department, status: "active" }));
  const directory = students.map(student => ({
    ...student, id: student.user_id, userId: student.user_id, role: "student",
    affiliations: [{ institute, department, role: "student" }],
  }));
  const courses = [
    { agentId: courseId, course: courseName, activeUsers: 2, totalUsers: 2, conversations: 4, rounds: 24, totalTokens: 48_000 },
    { agentId: "tutorial-admin-mathematics", course: "Applied Mathematics", activeUsers: 1, totalUsers: 1, conversations: 2, rounds: 15, totalTokens: 30_000 },
    { agentId: "tutorial-admin-workshop", course: "Workshop Foundations", activeUsers: 1, totalUsers: 1, conversations: 1, rounds: 6, totalTokens: 12_000 },
  ].map(course => ({ ...course, institute, department, professors: ["Demo Teacher"] }));
  const agents = courses.map(course => ({
    id: course.agentId, agentId: course.agentId, name: course.course, courseName: course.course,
    courseAffiliations: [{ institute, department }],
  }));
  const rosters = new Map([
    [courseId, { student_ids: [...existingStudentIds], revision: "tutorial-v1" }],
    [courses[1].agentId, { student_ids: [existingStudentIds[0]], revision: "tutorial-v1" }],
    [courses[2].agentId, { student_ids: [existingStudentIds[1]], revision: "tutorial-v1" }],
  ]);
  const originalRosters = structuredClone(rosters);
  const requests = [], failures = [], pageErrors = [];
  const rosterReads = [], rosterWrites = [], periodReads = [], tokenReads = [], confirmations = [];
  const blockedSockets = [];
  let scenario = null;

  context.on("page", page => page.on("pageerror", error => pageErrors.push(error.message)));
  context.on("serviceworker", () => failures.push("A service worker started in an isolated admin tutorial"));
  await context.routeWebSocket("**/*", socket => {
    blockedSockets.push(socket.url());
    socket.close();
  });
  await context.addCookies([{
    name: "session", value: "synthetic-admin-tutorial-session", url: origin,
    httpOnly: true, sameSite: "Lax",
  }]);
  // Match the browser tests' persisted session and mocked server profile, not live sign-in.
  await context.addInitScript(({ account, origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({ version: 1, state: account }));
    if ("serviceWorker" in navigator) {
      Object.defineProperty(navigator.serviceWorker, "register", {
        value: () => Promise.reject(new DOMException("Service workers are disabled in this tutorial.", "SecurityError")),
      });
    }
  }, { account, origin });

  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    const reject = detail => {
      failures.push(`${method} ${path}: ${detail}`);
      return json({ detail: `Isolated admin tutorial: ${detail}` }, 501);
    };
    if (url.origin === "https://fonts.googleapis.com" && method === "GET" && path === "/css2"
      && url.searchParams.get("family") === "Sora:wght@300;400;500;600;700"
      && url.searchParams.get("display") === "swap"
      && [...url.searchParams.keys()].length === 2) {
      return route.fulfill({
        contentType: "text/css",
        body: `@font-face{font-family:'Sora';font-style:normal;font-weight:100 900;font-display:swap;src:url('${origin}/__admin-tutorial-sora.woff2') format('woff2')}`,
      });
    }
    if (url.origin !== origin) {
      failures.push(`Blocked external request: ${method} ${url.hostname}${path}`);
      return route.abort("blockedbyclient");
    }
    if (path === "/__admin-tutorial-sora.woff2" && method === "GET" && !url.search) {
      return route.fulfill({ contentType: "font/woff2", body: font });
    }
    const apiRequest = /^\/(?:api|auth|\.auth)(?:\/|$)/.test(path)
      || ["fetch", "xhr"].includes(request.resourceType()) || !["GET", "HEAD"].includes(method);
    if (!apiRequest) return route.continue();
    requests.push(`${method} ${path}${url.search}`);

    if (method === "GET" && path === "/api/dashboard/overview/today") {
      const startDate = url.searchParams.get("start_date");
      const endDate = url.searchParams.get("end_date");
      if ([...url.searchParams.keys()].sort().join(",") !== "end_date,start_date"
        || !/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(endDate ?? "")
        || !Number.isFinite(Date.parse(startDate)) || !Number.isFinite(Date.parse(endDate))
        || startDate > endDate) return reject("Unexpected period filter");
      const stats = startDate === endDate
        ? { activeStudents: 1, tokens: 12_000, rounds: 6, newConversations: 2 }
        : { activeStudents: 2, tokens: 63_000, rounds: 30, newConversations: 5 };
      periodReads.push({ startDate, endDate, ...stats });
      return json({ ...stats, startDate, endDate });
    }
    if (method === "GET" && path === "/api/dashboard/overview/tokens/per-student") {
      if (url.searchParams.size !== 1 || url.searchParams.get("agent_id") !== courseId) {
        return reject("Student usage must be scoped to the synthetic Electricity Basics course");
      }
      tokenReads.push(courseId);
      return json({ students: [
        { userId: existingStudentIds[0], displayName: "Demo Classmate", email: "", totalTokens: 30_000, rounds: 15 },
        { userId: existingStudentIds[1], displayName: "Demo Partner", email: "", totalTokens: 18_000, rounds: 9 },
      ] });
    }
    if (url.search) return reject("Unmocked API query");
    if (path === "/auth/me" && method === "GET") {
      return json({ id: account.userId, displayName: account.displayName, email: account.email, provider: "microsoft" });
    }
    if (path === `/api/user/${account.userId}` && method === "GET") {
      return json({ success: true, profile: { id: account.userId, ...account } });
    }
    if (path === "/api/dashboard/agents" && method === "GET") return json({ agents, count: agents.length });
    if (path === "/api/dashboard/overview/courses" && method === "GET") return json({ courses, uniqueTotalUsers: 3 });
    if (path === "/api/dashboard/image-quota" && method === "GET") {
      return json({
        limits: { medium: 2, low: 5 }, costPerImageUsd: { medium: 0.03, low: 0.01 },
        estimatedWeeklyUsdPerStudent: 0.11, estimatedMonthlyUsdPerStudent: 0.473,
      });
    }
    if (path === "/api/directory" && method === "GET") return json(directory);
    if (path === "/api/dashboard/directory/research/bulk-status" && method === "POST") {
      let body;
      try { body = request.postDataJSON(); }
      catch { return reject("Malformed research-status lookup"); }
      const items = [{ type: "institute", institute }, { type: "department", institute, department }];
      if (!body || Object.keys(body).join(",") !== "items" || JSON.stringify(body.items) !== JSON.stringify(items)) {
        return reject("Research-status lookup must be scoped to the fictional institution and department");
      }
      return json({ statuses: {
        [institute]: { status: "not_started", institute },
        [`${institute}::${department}`]: { status: "not_started", institute, department },
      } });
    }
    const teacherMatch = path.match(/^\/api\/dashboard\/agents\/([^/]+)\/teachers$/);
    if (teacherMatch && method === "GET" && rosters.has(teacherMatch[1])) {
      return json({ agent_id: teacherMatch[1], owner_id: "", teachers: [] });
    }
    const rosterMatch = path.match(/^\/api\/agents\/([^/]+)\/students$/);
    if (rosterMatch && rosters.has(rosterMatch[1])) {
      const id = rosterMatch[1];
      const roster = rosters.get(id);
      const headers = await request.allHeaders();
      const syntheticSession = (headers.cookie ?? "").split(";").some(cookie => cookie.trim() === "session=synthetic-admin-tutorial-session");
      if (!syntheticSession) return reject("Missing synthetic roster session");
      if (method === "GET") {
        rosterReads.push({ agentId: id, revision: roster.revision, studentIds: [...roster.student_ids] });
        return json({ agent_id: id, ...roster, students });
      }
      if (method === "PUT") {
        let body;
        try { body = request.postDataJSON(); }
        catch { return reject("Malformed assignment payload"); }
        if (scenario !== "admin-assignments" || id !== courseId || confirmations.length !== 1 || rosterWrites.length !== 0) {
          return reject("Only the explicitly confirmed synthetic learner assignment may be saved");
        }
        if (!body || Object.keys(body).sort().join(",") !== "revision,student_ids"
          || body.revision !== roster.revision || body.revision !== "tutorial-v1"
          || !Array.isArray(body.student_ids) || body.student_ids.length !== expectedStudentIds.length
          || new Set(body.student_ids).size !== expectedStudentIds.length
          || !expectedStudentIds.every(studentId => body.student_ids.includes(studentId))) {
          return reject("The save must add Demo Learner and preserve every existing student");
        }
        const saved = { student_ids: [...body.student_ids], revision: "tutorial-v2" };
        rosterWrites.push({
          agentId: id, before: [...roster.student_ids], after: [...saved.student_ids],
          submittedRevision: body.revision, savedRevision: saved.revision, syntheticSession,
        });
        rosters.set(id, saved);
        return json({ agent_id: id, ...saved });
      }
    }
    return reject(`Unmocked API route ${method} ${path}`);
  });

  return {
    account, requests, failures, pageErrors, rosterReads, rosterWrites, periodReads, tokenReads, blockedSockets,
    begin(id) {
      assert.equal(scenario, null, "Each recipe requires its own browser context");
      assert(["admin-overview", "admin-assignments"].includes(id));
      scenario = id;
    },
    confirmAssignment() {
      assert.equal(scenario, "admin-assignments");
      assert.equal(confirmations.length, 0);
      assert.equal(rosterWrites.length, 0, "No assignments may be written before explicit confirmation");
      assert(rosterReads.some(read => read.agentId === courseId), "Load the saved roster before confirming");
      confirmations.push({ courseId, learnerId });
    },
    snapshot() {
      return {
        courseId, courseName, learnerId, learnerName,
        roster: structuredClone(rosters.get(courseId)),
        writes: structuredClone(rosterWrites),
        confirmation: structuredClone(confirmations),
      };
    },
    verify() {
      assert.deepEqual(failures, [], "Every API/auth request must be mocked; external requests must stay blocked");
      assert.deepEqual(pageErrors, [], "The unchanged admin frontend must run without page errors");
      assert.equal(context.serviceWorkers().length, 0, "No service worker may intercept tutorial traffic");
      for (const [id, original] of originalRosters) {
        if (id !== courseId) assert.deepEqual(rosters.get(id), original, "Other course rosters must remain unchanged");
      }
      if (scenario === "admin-assignments") {
        assert.equal(confirmations.length, 1, "Require explicit confirmation through the native Save assignments control");
        assert.equal(rosterWrites.length, 1, "Save exactly one scoped synthetic assignment");
        assert.deepEqual([...rosters.get(courseId).student_ids].sort(), [...expectedStudentIds].sort());
        assert.equal(rosters.get(courseId).revision, "tutorial-v2");
        assert(rosterReads.some(read => read.agentId === courseId && read.revision === "tutorial-v2"), "Re-read the persisted synthetic roster");
        assert(requests.includes("GET /auth/me") && requests.includes(`GET /api/user/${account.userId}`), "Exercise the mocked session and active administrator profile");
      } else {
        assert.equal(scenario, "admin-overview");
        assert.equal(rosterWrites.length, 0, "Analytics must be read-only");
        assert.deepEqual(rosters.get(courseId), originalRosters.get(courseId));
        assert(periodReads.some(read => read.startDate === read.endDate));
        assert(periodReads.some(read => read.startDate < read.endDate), "Exercise the native period filter");
        assert(tokenReads.includes(courseId), "Drill into the selected course's student usage");
      }
    },
  };
}

async function collapseAdminNavigation({ page, recorder, expect }) {
  const navigation = page.locator("aside").first();
  if (await navigation.getByText("Dashboard", { exact: true }).isVisible()) {
    // The native collapse control is the first sidebar button; it has no accessible label.
    await recorder.click(navigation.locator("button").first());
  }
  await expect(navigation.getByText("Dashboard", { exact: true })).toHaveCount(0);
  await expect(navigation).toHaveCSS("width", "56px");
}

async function choose(ctx, scope, label, option) {
  await ctx.recorder.click(scope.getByRole("combobox", { name: label, exact: true }));
  await ctx.recorder.click(ctx.page.getByRole("option", { name: option, exact: true }));
  await ctx.expect(scope.getByRole("combobox", { name: label, exact: true })).toHaveText(option);
}

function verification(ctx, details) {
  const durationSeconds = ctx.recorder.frames / 12;
  assert(durationSeconds >= 25 && durationSeconds <= 45, "Admin tutorials must be paced between 25 and 45 seconds");
  return {
    source: "Admin-Dashboard/frontend", nativeUI: true, syntheticData: true,
    liveSignIn: false, productionSecurity: "Not assessed; authentication and APIs are local browser-test fixtures.",
    courseChatStarters: noStarters, navigationCollapsedBeforeDialogs: true,
    durationSeconds, ...details,
  };
}

export const adminDemos = [
  {
    id: "admin-overview", name: "shiksha-admin-overview-tutorial",
    title: "Explore platform and course analytics", role: "admin", project: "admin",
    source: "Admin-Dashboard/frontend", installDemo: installAdminDemo, startPath: "/overview",
    description: "Explore the native admin overview with synthetic institution data: change the reporting period, filter course token usage, and inspect per-student tokens and rounds. Read-only; no live sign-in or model calls.",
    async setup({ page, demo }) {
      demo.begin("admin-overview");
      await page.clock.setFixedTime(fixedTime);
    },
    async ready({ page, expect }) {
      await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "View total tokens", exact: true })).toContainText("90.0K");
      await expect(page.getByRole("row").filter({ hasText: courseName })).toContainText(institute);
      await expect(page.getByRole("row")).toHaveCount(4);
    },
    async run(ctx) {
      const { page, recorder, expect, demo } = ctx;
      const usage = page.getByRole("dialog", { name: "Token Usage by Course", exact: true });
      const row = page.getByRole("row").filter({ hasText: courseName });
      let originalShare;
      await recorder.chapter("01  Explore synthetic platform usage across three courses.", async () => {
        await collapseAdminNavigation(ctx);
        await expect(row).toContainText(institute);
        await recorder.hold(3.5);
      });
      await recorder.chapter("02  Change Today to This Week to compare the reporting period.", async () => {
        await recorder.click(page.getByRole("button", { name: "Today", exact: true }));
        await recorder.click(page.getByRole("button", { name: "This Week", exact: true }));
        await expect(page.getByText("63.0K", { exact: true })).toBeVisible();
        assert(demo.periodReads.some(read => read.startDate < read.endDate && read.tokens === 63_000));
        await recorder.hold(4.5);
      });
      await recorder.chapter("03  Open Total Tokens to compare each course's share.", async () => {
        await collapseAdminNavigation(ctx);
        await recorder.click(page.getByRole("button", { name: "View total tokens", exact: true }));
        await expect(usage).toBeVisible();
        await expect(usage.getByRole("list", { name: "Course token usage" }).getByRole("listitem")).toHaveCount(3);
        const target = usage.getByRole("listitem").filter({ hasText: courseName });
        await expect(target).toContainText("53.3%");
        originalShare = await target.locator(".bg-purple-400").getAttribute("style");
        await recorder.hold(4);
      });
      await recorder.chapter("04  Search for Electricity Basics; overall totals stay unchanged.", async () => {
        await recorder.type(usage.getByRole("searchbox", { name: "Search courses", exact: true }), "Electricity", 2);
        await expect(usage.getByRole("listitem")).toHaveCount(1);
        await expect(usage.getByText("1 of 3 courses", { exact: true })).toBeVisible();
        await expect(usage.getByText("90,000 tokens total", { exact: true })).toBeVisible();
        await expect(usage.getByRole("listitem").locator(".bg-purple-400")).toHaveAttribute("style", originalShare);
        await recorder.hold(3.5);
      });
      await recorder.chapter("05  Inspect per-student token usage from the course row.", async () => {
        await recorder.click(usage.getByRole("button", { name: "Close", exact: true }));
        await expect(usage).toBeHidden();
        await collapseAdminNavigation(ctx);
        await recorder.click(row.getByTitle("Click to see student breakdown", { exact: true }));
        const detail = page.getByRole("dialog", { name: `Student Token Usage — ${courseName}`, exact: true });
        await expect(detail).toBeVisible();
        await expect(detail.getByText("Total: 48.0K tokens", { exact: true })).toBeVisible();
        await expect(detail.getByText("2 students", { exact: true })).toBeVisible();
        await expect(detail.locator("svg circle title")).toHaveCount(2);
        await recorder.hold(5);
      });
      await recorder.chapter("06  Compare rounds per student without changing course settings.", async () => {
        const detail = page.getByRole("dialog", { name: `Student Token Usage — ${courseName}`, exact: true });
        await recorder.click(detail.getByRole("button", { name: "Close", exact: true }));
        await expect(detail).toBeHidden();
        await collapseAdminNavigation(ctx);
        await recorder.click(row.getByTitle("Click to see rounds breakdown", { exact: true }));
        const rounds = page.getByRole("dialog", { name: `Rounds per Student — ${courseName}`, exact: true });
        await expect(rounds.getByText("Total: 24 rounds", { exact: true })).toBeVisible();
        await expect(rounds.locator("svg circle title").first()).toContainText("15 rounds");
        await recorder.hold(5);
        recorder.posterTime = recorder.frames / 12 - 1;
      });
      demo.verify();
      return verification(ctx, {
        readOnly: true, institution: institute, courseId, courseName,
        reportingPeriods: structuredClone(demo.periodReads),
        search: { query: "Electricity", matchingCourses: 1, allCourses: 3, totalTokens: 90_000, shareUnchanged: true },
        studentUsage: { students: 2, tokens: 48_000, rounds: 24 },
      });
    },
  },
  {
    id: "admin-assignments", name: "shiksha-admin-assignments-tutorial",
    title: "Manage student course access", role: "admin", project: "admin",
    source: "Admin-Dashboard/frontend", installDemo: installAdminDemo, startPath: "/user-directory",
    description: "Use the actual User Directory and Assign Students dialog to find a synthetic learner, review a course-specific selection, explicitly save it, and verify the directory and reopened roster. Other course assignments are preserved; no production access is changed.",
    async setup({ page, demo }) {
      demo.begin("admin-assignments");
      await page.clock.setFixedTime(fixedTime);
    },
    async ready({ page, expect }) {
      await expect(page.getByRole("heading", { name: "User Directory", exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Assign Students", exact: true })).toBeEnabled();
      await expect(page.getByRole("region", { name: "Unassigned to a course", exact: true })
        .getByText(learnerName, { exact: true })).toBeVisible();
    },
    async run(ctx) {
      const { page, recorder, expect, demo } = ctx;
      const dialog = page.getByRole("dialog", { name: "Assign Students", exact: true });
      const learner = dialog.getByRole("checkbox", { name: `${learnerName} (user@example.com)`, exact: true });
      const save = dialog.getByRole("button", { name: "Save assignments", exact: true });
      await recorder.chapter("01  Find Demo Learner in the isolated, synthetic directory.", async () => {
        await collapseAdminNavigation(ctx);
        await recorder.type(page.getByRole("textbox", { name: "Search directory", exact: true }), learnerName, 2);
        await expect(page.getByRole("region", { name: "Unassigned to a course", exact: true })
          .getByText(learnerName, { exact: true })).toBeInViewport();
        await recorder.hold(2.5);
      });
      await recorder.chapter("02  Open Assign Students and choose Electricity Basics.", async () => {
        await collapseAdminNavigation(ctx);
        await recorder.click(page.getByRole("button", { name: "Assign Students", exact: true }));
        await expect(dialog).toBeVisible();
        await choose(ctx, dialog, "Course / Teaching Assistant (TA)", courseName);
        await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(2);
        await expect(learner).not.toBeChecked();
        await expect(save).toBeDisabled();
        await recorder.hold(2);
      });
      await recorder.chapter("03  Filter the roster; filters alone do not change assignments.", async () => {
        await choose(ctx, dialog, "Institution", institute);
        await choose(ctx, dialog, "Department", department);
        await recorder.type(dialog.getByRole("searchbox", { name: "Search students", exact: true }), learnerName, 2);
        await expect(dialog.getByRole("checkbox")).toHaveCount(1);
        await expect(dialog.getByText("2 selected · 1 of 3 students shown", { exact: true })).toBeVisible();
        await expect(save).toBeDisabled();
        assert.equal(demo.rosterWrites.length, 0);
        await recorder.hold(2);
      });
      await recorder.chapter("04  Select this learner and review the unsaved, course-specific change.", async () => {
        await recorder.click(learner);
        await expect(learner).toBeChecked();
        await expect(dialog.getByText("3 selected · 1 of 3 students shown", { exact: true })).toBeVisible();
        await expect(dialog.getByText("Unsaved assignment changes.", { exact: true })).toBeVisible();
        await expect(save).toBeEnabled();
        assert.deepEqual(demo.snapshot().roster.student_ids, existingStudentIds);
        await recorder.hold(3.3);
      });
      await recorder.chapter("05  Confirm with Save assignments and read the saved result.", async () => {
        await expect(dialog.getByRole("combobox", { name: "Course / Teaching Assistant (TA)", exact: true })).toHaveText(courseName);
        await expect(learner).toBeChecked();
        await recorder.move(save);
        await recorder.hold(2);
        demo.confirmAssignment();
        await recorder.click(save);
        await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
        await expect(save).toBeDisabled();
        assert.equal(demo.rosterWrites.length, 1);
        await recorder.hold(3);
      });
      await recorder.chapter("06  Verify the directory result, then reopen the persisted roster.", async () => {
        await recorder.click(dialog.getByRole("button", { name: "Done", exact: true }));
        await expect(dialog).toBeHidden();
        await expect(page.getByRole("region", { name: courseName, exact: true })
          .getByText(learnerName, { exact: true })).toBeInViewport();
        await expect(page.getByRole("region", { name: "Unassigned to a course", exact: true })).toHaveCount(0);
        await recorder.hold(1.5);
        await collapseAdminNavigation(ctx);
        await recorder.click(page.getByRole("button", { name: "Assign Students", exact: true }));
        await choose(ctx, dialog, "Course / Teaching Assistant (TA)", courseName);
        await expect(learner).toBeChecked();
        await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(3);
        await expect(dialog.getByText("Showing saved assignments.", { exact: true })).toBeVisible();
        await expect(save).toBeDisabled();
        await recorder.move(learner);
        await expect(learner).toBeInViewport();
        await recorder.hold(4);
        recorder.posterTime = recorder.frames / 12 - 1;
      });
      demo.verify();
      return verification(ctx, {
        ...demo.snapshot(), confirmationControl: "Save assignments",
        directoryMembershipVisible: true, reopenedRosterVerified: true,
        preservedExistingStudents: [...existingStudentIds], otherCoursesUnchanged: true,
        syntheticWrites: 1, realWrites: 0,
      });
    },
  },
];
