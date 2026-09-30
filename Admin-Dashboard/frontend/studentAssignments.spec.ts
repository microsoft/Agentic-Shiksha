import { expect, test, type Locator, type Page } from "@playwright/test";
import type { DirectoryUser, DirectoryUserAffiliation } from "./src/lib/api";

const alpha = "ta alpha+?";
const beta = "ta-beta";
const agents = [
  { id: alpha, agentId: alpha, name: "Algebra", courseName: "Algebra",
    courseAffiliations: [{ institute: "Example North", department: "Mathematics" }] },
  { id: beta, agentId: beta, name: "Biology", courseName: "Biology",
    courseAffiliations: [{ institute: "Example North", department: "Mathematics" }] },
];
const candidates = [
  { user_id: "alice", name: "Alice Example", email: "alice@example.com", institute: "Example North", department: "Mathematics", status: "active" },
  { user_id: "ben", name: "Ben Example", email: "ben@example.com", institute: "Example North", department: "Engineering", status: "invited" },
  { user_id: "cara", name: "Cara Example", email: "cara@example.com", institute: "Example South", department: "Mathematics", status: "active" },
  { user_id: "drew", name: "Drew Example", email: "drew@example.com", institute: "Example South", department: "Engineering", status: "active" },
];
const unavailable = {
  user_id: "former-student", name: "Former Student", email: "",
  institute: "", department: "", status: "unavailable",
};
const cors = {
  "access-control-allow-origin": "http://127.0.0.1:4184",
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "content-type",
};

async function mockAssignments(page: Page, options: { role?: string; status?: string; authenticated?: boolean } = {}) {
  const state = {
    agents: agents.map(agent => ({ ...agent, courseAffiliations: agent.courseAffiliations.map(affiliation => ({ ...affiliation })) })),
    candidates: [...candidates],
    directoryAffiliations: new Map<string, DirectoryUserAffiliation[]>(),
    extraDirectoryUsers: [] as DirectoryUser[],
    directoryError: false,
    teachers: [] as { user_id: string; name: string; email: string; institute: string; department: string }[],
    agentsError: false,
    rosters: new Map([
      [alpha, { student_ids: ["alice", "cara", "former-student"], revision: "v1" }],
      [beta, { student_ids: ["ben"], revision: "v1" }],
    ]),
    reads: [] as { agentId: string; url: string; cookie: string }[],
    writes: [] as { agentId: string; student_ids: string[]; revision: string; url: string; cookie: string }[],
    getError: null as { status: number; detail: string } | null,
    putError: null as { status: number; detail: string } | null,
    permissionError: false,
    malformedRoster: false,
    holdGet: null as { agentId: string; until: Promise<void> } | null,
    holdPut: null as Promise<void> | null,
    invites: [] as { name: string; email: string; role: string; institute: string; department: string }[],
    inviteError: false,
    inviteResponseId: null as string | null,
    memberWrites: [] as { agentId: string; user_id: string; member_type: string; url: string; cookie: string }[],
    memberError: null as { status: number; detail: string } | null,
    malformedMemberResponse: false,
    holdMember: null as Promise<void> | null,
    placements: new Map(agents.map(agent => [agent.id, {
      agent_id: agent.id, institute: "Example North", department: "Mathematics", revision: "p1",
    }])),
    placementWrites: [] as { agentId: string; institute: string; department: string; revision: string; url: string }[],
    placementError: null as { status: number; detail: string } | null,
  };
  await page.context().addCookies([{
    name: "session", value: "synthetic-session", url: "http://127.0.0.1:4185",
    httpOnly: true, sameSite: "Lax",
  }]);
  // A persisted admin role must not override the authenticated server profile.
  await page.addInitScript(() => {
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({
      version: 1,
      state: {
        userId: "admin-user", displayName: "Example Admin", email: "admin@example.com",
        authProvider: "microsoft", role: "admin", isAuthenticated: true,
      },
    }));
  });
  await page.route("**/auth/**", route => route.fulfill({
    headers: cors,
    status: options.authenticated === false ? 401 : 200,
    json: options.authenticated === false ? { detail: "Not authenticated" } : {
      id: "admin-user", displayName: "Example Admin", email: "admin@example.com",
    },
  }));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path === "/api/user/admin-user") {
      if (state.permissionError) return route.fulfill({ status: 503, headers: cors, json: { detail: "Profile unavailable" } });
      return route.fulfill({ headers: cors, json: { success: true, profile: {
        id: "admin-user", userId: "admin-user", email: "admin@example.com",
        role: options.role ?? "admin", status: options.status ?? "active",
      } } });
    }
    if (path === "/api/dashboard/agents") return route.fulfill(state.agentsError
      ? { status: 503, json: { detail: "Courses unavailable" } }
      : { json: { agents: state.agents, count: state.agents.length } });
    if (path === "/api/directory") {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as typeof state.invites[number];
        state.invites.push(body);
        if (state.inviteError) return route.fulfill({ status: 503, json: { detail: "Invitation unavailable" } });
        const student = state.candidates.find(candidate => candidate.email.toLowerCase() === body.email.toLowerCase());
        const teacher = state.teachers.find(candidate => candidate.email.toLowerCase() === body.email.toLowerCase());
        const existing = student || teacher;
        const userId = existing?.user_id || `invited-${state.invites.length}`;
        const savedRole = student ? "student" : teacher ? "teacher" : body.role;
        const affiliations = state.directoryAffiliations.get(userId) ?? [{
          institute: existing?.institute ?? body.institute,
          department: existing?.department ?? body.department,
          role: savedRole,
        }];
        const affiliationAdded = !!existing && !affiliations.some(affiliation =>
          affiliation.institute === body.institute && affiliation.department === body.department);
        if (affiliationAdded) {
          affiliations.push({ institute: body.institute, department: body.department, role: body.role });
        }
        state.directoryAffiliations.set(userId, affiliations);
        if (!existing) {
          const candidate = { ...body, user_id: userId, status: "invited" };
          if (body.role === "student") state.candidates.push(candidate);
          if (body.role === "teacher") state.teachers.push(candidate);
        }
        return route.fulfill({ status: existing ? 200 : 201, json: {
          ...body, id: state.inviteResponseId || userId, userId: state.inviteResponseId || userId,
          institute: existing?.institute ?? body.institute,
          department: existing?.department ?? body.department,
          role: savedRole, affiliations, affiliationAdded,
          status: student?.status ?? (existing ? "active" : "invited"),
          alreadyExists: !!existing && !affiliationAdded,
        } });
      }
      if (state.directoryError) return route.fulfill({ status: 503, json: { detail: "Directory unavailable" } });
      return route.fulfill({
        json: [...state.candidates.map(student => ({
          ...student, id: student.user_id, userId: student.user_id, role: "student",
          affiliations: state.directoryAffiliations.get(student.user_id),
        })), ...state.teachers.map(teacher => ({ ...teacher, id: teacher.user_id, userId: teacher.user_id, role: "teacher", status: "active",
          affiliations: state.directoryAffiliations.get(teacher.user_id) })),
        ...state.extraDirectoryUsers],
      });
    }
    const placementMatch = path.match(/^\/api\/agents\/([^/]+)\/placement$/);
    if (placementMatch) {
      const agentId = decodeURIComponent(placementMatch[1]);
      const placement = state.placements.get(agentId);
      if (!placement) return route.fulfill({ status: 404, headers: cors, json: { detail: "Teaching assistant not found" } });
      if (request.method() === "GET") return route.fulfill({ headers: cors, json: placement });
      const body = request.postDataJSON() as { institute: string; department: string; revision: string };
      state.placementWrites.push({ agentId, ...body, url: url.toString() });
      if (state.placementError) return route.fulfill({ status: state.placementError.status, headers: cors, json: { detail: state.placementError.detail } });
      if (placement.revision !== body.revision) return route.fulfill({ status: 409, headers: cors, json: { detail: "TA placement changed. Reload before saving." } });
      const saved = { agent_id: agentId, institute: body.institute, department: body.department, revision: `p${Number(placement.revision.slice(1)) + 1}` };
      state.placements.set(agentId, saved);
      state.agents = state.agents.map(agent => agent.id === agentId
        ? { ...agent, courseAffiliations: body.institute ? [{ institute: body.institute, department: body.department }] : [] }
        : agent);
      return route.fulfill({ headers: cors, json: saved });
    }
    const memberMatch = path.match(/^\/api\/agents\/([^/]+)\/members$/);
    if (memberMatch && request.method() === "POST") {
      const agentId = decodeURIComponent(memberMatch[1]);
      const body = request.postDataJSON() as { user_id: string; member_type: string };
      state.memberWrites.push({ agentId, ...body, url: url.toString(), cookie: (await request.allHeaders()).cookie || "" });
      if (state.holdMember) await state.holdMember;
      if (state.memberError) return route.fulfill({
        status: state.memberError.status, headers: cors, json: { detail: state.memberError.detail },
      });
      if (body.member_type === "student") {
        const roster = state.rosters.get(agentId) ?? { student_ids: [], revision: "v1" };
        if (!state.rosters.has(agentId)) state.rosters.set(agentId, roster);
        if (!roster.student_ids.includes(body.user_id)) roster.student_ids.push(body.user_id);
      }
      return route.fulfill({ headers: cors, json: state.malformedMemberResponse ? { status: "ok" } : {
        status: "ok", agent_id: agentId, added: body.user_id, as: body.member_type,
      } });
    }
    if (/^\/api\/dashboard\/agents\/[^/]+\/teachers$/.test(path)) {
      return route.fulfill({ json: { agent_id: decodeURIComponent(path.split("/")[4]), owner_id: "", teachers: state.teachers.map(teacher => ({ ...teacher, is_owner: false })) } });
    }
    if (/^\/api\/dashboard\/agents\/[^/]+\/overview$/.test(path)) {
      return route.fulfill({ json: {
        agent_id: beta, student_count: 0, avg_pct_complete: 0, total_topics: 0,
        distribution: { "0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0 },
        top_struggle_topics: [], students: [],
        usage: { agent_id: beta, active_students: 0, active_teachers: 1, total_threads: 0, active_threads: 0 },
      } });
    }
    const match = path.match(/^\/api\/agents\/([^/]+)\/students$/);
    if (match) {
      const agentId = decodeURIComponent(match[1]);
      const roster = state.rosters.get(agentId)!;
      const cookie = (await request.allHeaders()).cookie || "";
      if (request.method() === "GET") {
        state.reads.push({ agentId, url: url.toString(), cookie });
        if (state.getError) {
          const error = state.getError;
          return route.fulfill({ status: error.status, headers: cors, json: { detail: error.detail } });
        }
        const response = {
          agent_id: agentId, ...roster,
          students: [...state.candidates, ...(roster.student_ids.includes(unavailable.user_id) ? [unavailable] : [])],
        };
        if (state.holdGet?.agentId === agentId) {
          const until = state.holdGet.until;
          await until;
        }
        return route.fulfill({
          headers: cors,
          json: state.malformedRoster ? { ...response, revision: undefined } : response,
        });
      }
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { student_ids: string[]; revision: string };
        state.writes.push({ agentId, ...body, url: url.toString(), cookie });
        if (state.holdPut) await state.holdPut;
        if (state.putError) {
          const error = state.putError;
          state.putError = null;
          return route.fulfill({ status: error.status, headers: cors, json: { detail: error.detail } });
        }
        if (body.revision !== roster.revision) {
          return route.fulfill({ status: 409, headers: cors, json: { detail: "Student assignments changed. Reload and try again." } });
        }
        if (body.student_ids.some(id => !state.candidates.some(student =>
          student.user_id === id && (student.status === "active" || student.status === "invited")))) {
          return route.fulfill({ status: 422, headers: cors, json: { detail: "Remove unavailable students before saving." } });
        }
        const updated = { student_ids: body.student_ids, revision: `v${Number(roster.revision.slice(1)) + 1}` };
        state.rosters.set(agentId, updated);
        return route.fulfill({ headers: cors, json: { agent_id: agentId, ...updated } });
      }
    }
    return route.fulfill({ status: 404, headers: cors, json: { detail: "Unmocked synthetic request" } });
  });
  return state;
}

async function choose(page: Page, dialog: Locator, label: string, option: string) {
  await dialog.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openAssignments(page: Page, course = "Algebra") {
  await page.goto("/user-directory");
  if (page.viewportSize()!.width < 640) {
    await page.locator("aside").first().locator("button").first().click();
  }
  await page.getByRole("button", { name: "Assign Students", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assign Students", exact: true });
  await choose(page, dialog, "Course / Teaching Assistant (TA)", course);
  return dialog;
}

test("directory course groups use memberships and retain unassigned users", async ({ page }) => {
  await mockAssignments(page);
  await page.goto("/user-directory");
  const groups = await page.evaluate(async () => {
    const modulePath = "/src/lib/userDirectory.ts";
    const { groupByCourse } = await import(modulePath);
    const users = [
      { id: "directory-alice", userId: "canonical-alice", name: "Alice Example", email: "alice@example.com", role: "student", institute: "Example North", department: "Mathematics" },
      { id: "invitation-ben", name: "Ben Example", email: "BEN@example.com", role: "student", institute: "Example North", department: "Mathematics", status: "invited" },
      { id: "teacher", name: "Example Teacher", email: "teacher@example.com", role: "teacher", institute: "Example North", department: "Mathematics" },
      { id: "unassigned", name: "Unassigned Example", email: "unassigned@example.com", role: "student", institute: "Example North", department: "Mathematics" },
    ];
    return groupByCourse(users, [
      { id: "algebra", name: "Algebra", teachers: [{ userId: "teacher", email: "teacher@example.com" }], students: [{ userId: "canonical-alice", email: "" }, { userId: "canonical-ben", email: "ben@example.com" }] },
      { id: "biology", name: "Biology", teachers: [], students: [{ userId: "canonical-alice", email: "" }] },
    ]).map((course: { id: string | null; name: string; users: { id: string }[] }) => ({
      id: course.id, name: course.name, users: course.users.map(user => user.id),
    }));
  });
  expect(groups).toEqual([
    { id: "algebra", name: "Algebra", users: ["directory-alice", "invitation-ben", "teacher"] },
    { id: "biology", name: "Biology", users: ["directory-alice"] },
    { id: null, name: "Unassigned to a course", users: ["unassigned"] },
  ]);
});

for (const width of [1440, 390]) {
  test(`directory TA placement does not follow a teacher into other departments at ${width}px`, async ({ page }, testInfo) => {
    const state = await mockAssignments(page);
    await page.setViewportSize({ width, height: 900 });
    state.teachers.push({
      user_id: "multi-department-teacher", name: "Shared Teacher", email: "shared-teacher@example.com",
      institute: "Example North", department: "Mathematics",
    });
    state.directoryAffiliations.set("multi-department-teacher", [
      { institute: "Example North", department: "Mathematics", role: "teacher" },
      { institute: "Example North", department: "Engineering", role: "teacher" },
      { institute: "Example South", department: "Engineering", role: "teacher" },
    ]);
    state.agents[1].courseAffiliations = [{ institute: "Example North", department: "Engineering" }];
    const beforeRosters = [...state.rosters.entries()].map(([id, roster]) => [id, [...roster.student_ids]]);
    await page.goto("/user-directory");
    if (width < 640) await page.locator("aside").first().locator("button").first().click();
    const north = page.getByTestId("directory-institute").filter({
      has: page.getByRole("button", { name: /^Example North \(/ }),
    });
    const south = page.getByTestId("directory-institute").filter({
      has: page.getByRole("button", { name: /^Example South \(/ }),
    });
    const maths = north.getByTestId("directory-department").filter({
      has: page.getByRole("button", { name: /^Mathematics \(/ }),
    });
    const engineering = north.getByTestId("directory-department").filter({
      has: page.getByRole("button", { name: /^Engineering \(/ }),
    });
    await expect(maths.getByRole("region", { name: "Algebra", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Algebra", exact: true })).toHaveCount(1);
    await expect(engineering.getByRole("region", { name: "Algebra", exact: true })).toHaveCount(0);
    await expect(engineering.getByRole("region", { name: "Biology", exact: true })).toBeVisible();
    await expect(south.getByRole("region", { name: "Algebra", exact: true })).toHaveCount(0);
    await expect(south.getByText("Shared Teacher", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "User Directory", level: 3 }).locator("..")).toContainText("(5)");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`directory-placement-${width}.png`), animations: "disabled", fullPage: true });

    await page.getByRole("button", { name: "Assign TA to department", exact: true }).click();
    const placement = page.getByRole("dialog", { name: "Assign TA to department", exact: true });
    await choose(page, placement, "Teaching Assistant (TA)", "Algebra");
    await expect(placement.getByRole("combobox", { name: "TA college", exact: true })).toHaveValue("Example North");
    await placement.getByRole("combobox", { name: "TA college", exact: true }).fill("Example South");
    await placement.getByRole("combobox", { name: "TA department", exact: true }).fill("Engineering");
    await placement.getByRole("button", { name: "Save TA department", exact: true }).click();
    await expect(placement.getByRole("status")).toContainText("TA department saved");
    await placement.getByRole("button", { name: "Done", exact: true }).click();
    await expect(south.getByRole("region", { name: "Algebra", exact: true })).toBeVisible();
    await expect(north.getByRole("region", { name: "Algebra", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Algebra", exact: true })).toHaveCount(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(south.getByRole("region", { name: "Algebra", exact: true })).toBeVisible();
    await expect(north.getByRole("region", { name: "Algebra", exact: true })).toHaveCount(0);
    expect([...state.rosters.entries()].map(([id, roster]) => [id, [...roster.student_ids]])).toEqual(beforeRosters);
    expect(state.writes).toEqual([]);
    expect(state.memberWrites).toEqual([]);
    expect(state.invites).toEqual([]);
  });
}

test("unplaced TAs never become department groups through their teacher's affiliations", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agents.forEach(agent => { agent.courseAffiliations = []; });
  state.teachers.push({
    user_id: "unplaced-teacher", name: "Unplaced Teacher", email: "unplaced-teacher@example.com",
    institute: "Example North", department: "Mathematics",
  });
  await page.goto("/user-directory");
  await expect(page.getByRole("region", { name: "Unassigned to a course", exact: true })
    .getByText("Unplaced Teacher", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Algebra", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Biology", exact: true })).toHaveCount(0);
  expect(state.placementWrites).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.memberWrites).toEqual([]);
});

for (const status of ["invited", "active"]) {
  test(`directory shows ${status} students under every saved college affiliation without duplicate counts`, async ({ page }) => {
    const state = await mockAssignments(page);
    state.candidates = state.candidates.map(student => student.user_id === "alice"
      ? { ...student, institute: "Original College", department: "Original Department", status }
      : student);
    state.directoryAffiliations.set("alice", [
      { institute: "Original College", department: "Original Department", role: "student" },
      { institute: "Example North", department: "Mathematics", role: "student" },
      { institute: "Example North", department: "Mathematics", role: "student" },
    ]);
    state.rosters.set(beta, { student_ids: ["alice", "ben"], revision: "v1" });
    await page.goto("/user-directory");
    const college = page.getByTestId("directory-institute").filter({ has: page.getByRole("button", { name: "Example North (2)", exact: true }) });
    const department = college.getByTestId("directory-department").filter({ has: page.getByRole("button", { name: "Mathematics (1)", exact: true }) });
    const course = department.getByRole("region", { name: "Biology", exact: true });
    await expect(course.getByRole("button", { name: "Students (1)", exact: true })).toBeVisible();
    await expect(course.getByText("Alice Example", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Original College (1)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "User Directory", level: 3 }).locator("..")).toContainText("(4)");
    expect(state.invites).toHaveLength(0);
    expect(state.memberWrites).toHaveLength(0);
    expect(state.writes).toHaveLength(0);
  });
}

test("all sixty saved students appear under the TA without importing or changing memberships", async ({ page }) => {
  const state = await mockAssignments(page);
  state.candidates = Array.from({ length: 60 }, (_, index) => ({
    user_id: `saved-student-${index}`, name: `Example Student ${index}`, email: `student${index}@example.com`,
    institute: "Original College", department: "Original Department", status: "invited",
  }));
  for (const student of state.candidates) {
    state.directoryAffiliations.set(student.user_id, [
      { institute: "Original College", department: "Original Department", role: "student" },
      { institute: "Example North", department: "Mathematics", role: "student" },
    ]);
  }
  state.rosters.set(alpha, { student_ids: [], revision: "v1" });
  state.rosters.set(beta, { student_ids: state.candidates.map(student => student.user_id), revision: "v1" });
  await page.goto("/user-directory");
  const college = page.getByTestId("directory-institute").filter({ has: page.getByRole("button", { name: "Example North (60)", exact: true }) });
  const course = college.getByRole("region", { name: "Biology", exact: true });
  await expect(course.getByRole("button", { name: "Students (60)", exact: true })).toBeVisible();
  await expect(course.getByRole("row")).toHaveCount(60);
  await expect(page.getByRole("heading", { name: "User Directory", level: 3 }).locator("..")).toContainText("(60)");
  expect(state.invites).toHaveLength(0);
  expect(state.memberWrites).toHaveLength(0);
  expect(state.writes).toHaveLength(0);
});

test("directory filters and counts use saved affiliation pairs rather than just primary fields", async ({ page }) => {
  const state = await mockAssignments(page);
  state.directoryAffiliations.set("alice", [
    { institute: "Example North", department: "Mathematics", role: "student" },
    { institute: "Secondary College", department: "Physics", role: "student" },
    { institute: "Secondary College", department: "Computing", role: "student" },
    { institute: "Secondary College", department: "Physics", role: "student" },
  ]);
  await page.goto("/user-directory");
  await expect(page.getByRole("button", { name: "Secondary College (1)", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "User Directory", level: 3 }).locator("..")).toContainText("(4)");
  await page.getByRole("combobox", { name: "Directory institution", exact: true }).click();
  await page.getByRole("option", { name: "Secondary College", exact: true }).click();
  await page.getByRole("combobox", { name: "Directory department", exact: true }).click();
  await expect(page.getByRole("option", { name: "Mathematics", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Physics", exact: true }).click();
  await page.getByRole("combobox", { name: "Directory role", exact: true }).click();
  await page.getByRole("option", { name: "Student", exact: true }).click();
  await expect(page.getByTestId("directory-institute")).toHaveCount(1);
  await expect(page.getByTestId("directory-department")).toHaveCount(1);
  await expect(page.getByText("Alice Example", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "User Directory", level: 3 }).locator("..")).toContainText("(1)");
  await page.getByRole("textbox", { name: "Search directory", exact: true }).fill("Physics");
  await expect(page.getByText("Alice Example", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search directory", exact: true }).fill("Mathematics");
  await expect(page.getByText("No users match your filters.", { exact: true })).toBeVisible();
  expect(state.memberWrites).toHaveLength(0);
});

test("affiliation grouping keeps canonical identities and edits preserve additional affiliations", async ({ page }) => {
  const state = await mockAssignments(page);
  state.directoryAffiliations.set("alice", [
    { institute: "Example North", department: "Mathematics", role: "student" },
    { institute: "Secondary College", department: "Physics", role: "student" },
  ]);
  await page.route("**/api/directory/alice", route => route.fulfill({ json: {
    id: "alice", userId: "alice", name: "Updated Example", email: "alice@example.com", role: "student",
    institute: "Example North", department: "Updated Department", status: "active",
  } }));
  await page.goto("/user-directory");
  await expect(page.getByRole("button", { name: "Secondary College (1)", exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const path = "/src/lib/userDirectory.ts";
    const { USER_DIRECTORY, groupByInstituteDept, updateUser } = await import(path);
    const original = USER_DIRECTORY.find((user: { id: string }) => user.id === "alice");
    const secondary = groupByInstituteDept([original])["Secondary College"].Physics[0];
    const sameRecord = secondary === original;
    const primaryBefore = secondary.institute;
    const updated = await updateUser("alice", { name: "Updated Example", department: "Updated Department" });
    return { sameRecord, primaryBefore, id: updated.id, role: updated.role, affiliations: updated.affiliations };
  });
  expect(result).toEqual({
    sameRecord: true, primaryBefore: "Example North", id: "alice", role: "student",
    affiliations: [
      { institute: "Example North", department: "Updated Department", role: "student" },
      { institute: "Secondary College", department: "Physics", role: "student" },
    ],
  });
});

test("CSV import of an existing student displays the new affiliation and survives reload", async ({ page }) => {
  const state = await mockAssignments(page);
  state.candidates = state.candidates.map(student => student.user_id === "alice"
    ? { ...student, institute: "Original College", department: "Original Department", status: "invited" }
    : student);
  const dialog = await openAddUserDialog(page);
  await selectCsvScope(page, dialog);
  await importUsers(dialog, ",email,role\nAlice Example,alice@example.com,Student\n,,Student");
  await expect(dialog.getByText("1 course assignments confirmed", { exact: true })).toBeVisible();
  await expect(dialog.getByText("2 skipped", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const college = page.getByTestId("directory-institute").filter({ has: page.getByRole("button", { name: "Example North (2)", exact: true }) });
  await expect(college.getByRole("region", { name: "Biology", exact: true }).getByText("Alice Example", { exact: true })).toBeVisible();
  await page.reload();
  await expect(college.getByRole("region", { name: "Biology", exact: true }).getByText("Alice Example", { exact: true })).toBeVisible();
  expect(state.candidates.filter(student => student.email === "alice@example.com")).toHaveLength(1);
  expect(state.candidates[0].institute).toBe("Original College");
  expect(state.memberWrites).toHaveLength(1);
  expect(state.memberWrites[0].user_id).toBe("alice");
  expect(state.rosters.get(beta)!.student_ids).toEqual(["ben", "alice"]);
});

test("roster filters find secondary-affiliation students without changing their saved IDs or selection", async ({ page }) => {
  const state = await mockAssignments(page);
  state.directoryAffiliations.set("alice", [
    { institute: "Example North", department: "Mathematics", role: "student" },
    { institute: "Secondary College", department: "Physics", role: "student" },
  ]);
  const dialog = await openAssignments(page);
  await choose(page, dialog, "Institution", "Secondary College");
  await choose(page, dialog, "Department", "Physics");
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Showing saved assignments.", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  expect(state.memberWrites).toHaveLength(0);
});

for (const width of [1440, 390]) {
  test(`directory nests courses between departments and roles at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await mockAssignments(page);
    state.teachers.push({ user_id: "teacher", name: "Example Teacher", email: "teacher@example.com", institute: "Example North", department: "Mathematics" });
    state.rosters.set(beta, { student_ids: ["alice", "ben"], revision: "v1" });
    await page.goto("/user-directory");
    if (width < 640) await page.locator("aside").first().locator("button").first().click();
    const institute = page.getByTestId("directory-institute").filter({ has: page.getByRole("button", { name: "Example North (3)", exact: true }) });
    const department = institute.getByTestId("directory-department").filter({ has: page.getByRole("button", { name: "Mathematics (2)", exact: true }) });
    const algebra = department.getByRole("region", { name: "Algebra", exact: true });
    const biology = department.getByRole("region", { name: "Biology", exact: true });
    for (const course of [algebra, biology]) {
      await expect(course.getByRole("button", { name: "Teachers (1)", exact: true })).toBeVisible();
      await expect(course.getByRole("button", { name: "Students (1)", exact: true })).toBeVisible();
      await expect(course.getByText("Example Teacher", { exact: true })).toBeVisible();
      await expect(course.getByText("Alice Example", { exact: true })).toBeVisible();
    }
    const unassigned = page.getByRole("region", { name: "Unassigned to a course", exact: true });
    await expect(unassigned.getByText("Drew Example", { exact: true })).toBeVisible();
    await algebra.getByRole("button", { name: "Algebra (2)", exact: true }).click();
    await expect(algebra.getByText("Alice Example", { exact: true })).not.toBeVisible();
    await expect(biology.getByText("Alice Example", { exact: true })).toBeVisible();
    await algebra.getByRole("button", { name: "Algebra (2)", exact: true }).click();
    expect(state.writes).toHaveLength(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`directory-course-hierarchy-${width}.png`), animations: "disabled" });
  });
}

test("directory refreshes course membership after saving assignments", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agents[1].courseAffiliations = [{ institute: "Example South", department: "Engineering" }];
  await page.goto("/user-directory");
  await expect(page.getByRole("region", { name: "Unassigned to a course", exact: true })
    .getByText("Drew Example", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Assign Students", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assign Students", exact: true });
  await choose(page, dialog, "Course / Teaching Assistant (TA)", "Biology");
  await dialog.getByRole("checkbox", { name: /Drew Example/ }).check();
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const institute = page.getByTestId("directory-institute").filter({ has: page.getByRole("button", { name: "Example South (2)", exact: true }) });
  const department = institute.getByTestId("directory-department").filter({ has: page.getByRole("button", { name: "Engineering (1)", exact: true }) });
  await expect(department.getByRole("region", { name: "Biology", exact: true })
    .getByText("Drew Example", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Unassigned to a course", exact: true })
    .getByText("Drew Example", { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].student_ids).toEqual(["ben", "drew"]);
});

test("directory failed membership loads never mark users unassigned and can retry", async ({ page }) => {
  const state = await mockAssignments(page);
  state.getError = { status: 503, detail: "Assignments unavailable" };
  await page.goto("/user-directory");
  await expect(page.getByRole("alert")).toContainText("Course assignments could not be loaded.");
  await expect(page.getByRole("region", { name: "Unassigned to a course", exact: true })).toHaveCount(0);
  await expect(page.getByText("Alice Example", { exact: true })).toBeVisible();
  state.getError = null;
  await page.getByRole("button", { name: "Retry course assignments", exact: true }).click();
  await expect(page.getByRole("region", { name: "Algebra", exact: true })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Unassigned to a course", exact: true })
    .getByText("Drew Example", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});

test("saved rosters are per TA, preserve members, include invitations, and persist on reopen", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openAssignments(page);
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Cara Example/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Former Student/ })).toBeChecked();
  await expect(dialog.getByRole("listitem").filter({ hasText: "Ben Example" })).toContainText("Invited");
  await expect(dialog.getByRole("listitem").filter({ hasText: "Alice Example" })).toContainText("Active");
  await expect(dialog.getByRole("listitem").filter({ hasText: "Former Student" })).toContainText("Unavailable");
  await dialog.getByRole("checkbox", { name: /Former Student/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /Ben Example/ }).check();
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(state.writes[0].student_ids.sort()).toEqual(["alice", "ben", "cara"]);
  expect(state.writes[0].revision).toBe("v1");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Assign Students", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await choose(page, dialog, "Course / Teaching Assistant (TA)", "Algebra");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Former Student/ })).toHaveCount(0);
  await choose(page, dialog, "Course / Teaching Assistant (TA)", "Biology");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: /Drew Example/ }).check();
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(state.rosters.get(alpha)?.student_ids.sort()).toEqual(["alice", "ben", "cara"]);
  expect(state.rosters.get(beta)?.student_ids.sort()).toEqual(["ben", "drew"]);
  for (const request of [...state.reads, ...state.writes]) {
    expect(new URL(request.url).origin).toBe("http://127.0.0.1:4185");
    expect(request.cookie).toContain("session=synthetic-session");
    expect(request.url).toContain(`/api/agents/${encodeURIComponent(request.agentId)}/students`);
  }
});

test("filters do not edit assignments and bulk selection preserves offscreen members", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openAssignments(page);
  const save = dialog.getByRole("button", { name: "Save assignments", exact: true });
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).toBeChecked();
  const initialReadCount = state.reads.length;
  await choose(page, dialog, "Institution", "Example North");
  await dialog.getByRole("searchbox", { name: "Search students" }).fill("BEN");
  await choose(page, dialog, "Department", "Engineering");
  await expect(dialog.getByRole("checkbox")).toHaveCount(1);
  await expect(save).toBeDisabled();
  await dialog.getByRole("button", { name: "Select matching", exact: true }).click();
  await expect(dialog.getByText("4 selected · 1 of 5 students shown", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Remove unavailable students before saving");
  await expect(save).toBeDisabled();
  await dialog.getByRole("button", { name: "Clear matching", exact: true }).click();
  await expect(dialog.getByText("Showing saved assignments.", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await dialog.getByRole("button", { name: "Select matching", exact: true }).click();
  await choose(page, dialog, "Institution", "Example South");
  await expect(dialog.getByRole("combobox", { name: "Department", exact: true })).toHaveText("All departments");
  await expect(dialog.getByText("No students match these filters. Selections outside the filters are unchanged.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Clear matching", exact: true })).toBeDisabled();
  await dialog.getByRole("searchbox", { name: "Search students" }).fill("");
  await dialog.getByRole("button", { name: "Clear matching", exact: true }).click();
  await dialog.getByRole("button", { name: "Clear filters to review students", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Former Student/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Cara Example/ })).not.toBeChecked();
  await expect(save).toBeDisabled();
  expect(state.writes).toHaveLength(0);
  await dialog.getByRole("checkbox", { name: /Former Student/ }).uncheck();
  await save.click();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(state.writes[0].student_ids.sort()).toEqual(["alice", "ben"]);
  expect(state.reads).toHaveLength(initialReadCount);
});

test("assignment institution filters include the full directory and course affiliations", async ({ page }) => {
  const state = await mockAssignments(page);
  state.teachers.push({
    user_id: "teacher-only", name: "Teacher Example", email: "teacher@example.com",
    institute: "Teacher Only Institute", department: "Music",
  });
  state.extraDirectoryUsers.push({
    id: "admin-only", userId: "admin-only", name: "Admin Example", email: "staff@example.com",
    role: "admin", status: "active", institute: "Admin Only Institute", department: "Administration",
    affiliations: [{ institute: "Partner Institute", department: "Languages", role: "admin" }],
  });
  state.agents[0].courseAffiliations.push({ institute: "Course Only Institute", department: "Physics" });
  const dialog = await openAssignments(page, "Biology");
  await dialog.getByRole("combobox", { name: "Institution", exact: true }).click();
  await expect(page.getByRole("option")).toHaveText([
    "All institutions", "Admin Only Institute", "Course Only Institute", "Example North",
    "Example South", "Partner Institute", "Teacher Only Institute",
  ]);
  await page.getByRole("option", { name: "Teacher Only Institute", exact: true }).click();
  await choose(page, dialog, "Department", "Music");
  await expect(dialog.getByText("No students match these filters. Selections outside the filters are unchanged.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Select matching", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  await choose(page, dialog, "Institution", "All institutions");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  expect(state.writes).toHaveLength(0);
});

test("assignment filters load all institutions when opened directly from analytics", async ({ page }) => {
  const state = await mockAssignments(page);
  state.extraDirectoryUsers.push({
    id: "staff-west", userId: "staff-west", name: "West Staff", email: "west@example.com",
    role: "admin", status: "active", institute: "West Institute", department: "Arts",
  });
  state.agents.push({
    id: "other-course", agentId: "other-course", name: "Other Course", courseName: "Other Course",
    courseAffiliations: [{ institute: "Course Elsewhere Institute", department: "Design" }],
  });
  await page.goto("/analytics");
  await page.getByRole("combobox", { name: "Analytics institution", exact: true }).click();
  await page.getByRole("option", { name: "Example North", exact: true }).click();
  await page.getByRole("combobox", { name: "Analytics department", exact: true }).click();
  await page.getByRole("option", { name: "Mathematics", exact: true }).click();
  await page.getByRole("combobox", { name: "Analytics course", exact: true }).click();
  await page.getByRole("option", { name: "Biology", exact: true }).click();
  await page.getByRole("button", { name: "Assign Students", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assign Students", exact: true });
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  await dialog.getByRole("combobox", { name: "Institution", exact: true }).click();
  await expect(page.getByRole("option", { name: "West Institute", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Course Elsewhere Institute", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(state.writes).toHaveLength(0);
});

test("assignment filters retain known institutions and departments with no users", async ({ page }) => {
  const state = await mockAssignments(page);
  await page.goto("/user-directory");
  await expect(page.getByRole("button", { name: "Assign Students", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/lib/userDirectory.ts";
    const directory = await import(path);
    directory.addInstitute("New Institute");
    directory.addDepartment("New Institute", "New Department");
  });
  await page.getByRole("button", { name: "Assign Students", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assign Students", exact: true });
  await choose(page, dialog, "Course / Teaching Assistant (TA)", "Biology");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  await choose(page, dialog, "Institution", "New Institute");
  await choose(page, dialog, "Department", "New Department");
  await expect(dialog.getByText("No students match these filters. Selections outside the filters are unchanged.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  await choose(page, dialog, "Institution", "Example North");
  await expect(dialog.getByRole("combobox", { name: "Department", exact: true })).toHaveText("All departments");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  expect(state.writes).toHaveLength(0);
});

test("assignment directory failures cannot silently show incomplete institution choices", async ({ page }) => {
  const state = await mockAssignments(page);
  state.directoryError = true;
  const dialog = await openAssignments(page, "Biology");
  await expect(dialog.getByRole("alert")).toContainText("Failed to fetch directory");
  await expect(dialog.getByRole("combobox", { name: "Institution", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  state.directoryError = false;
  state.teachers.push({
    user_id: "new-teacher", name: "New Teacher", email: "teacher@example.com",
    institute: "Additional Institute", department: "Additional Department",
  });
  await dialog.getByRole("button", { name: "Retry loading roster", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  await choose(page, dialog, "Institution", "Additional Institute");
  await choose(page, dialog, "Department", "Additional Department");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 700 }]) {
  test(`assignment institution menu keeps every option reachable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await mockAssignments(page);
    state.extraDirectoryUsers = Array.from({ length: 26 }, (_unused, index) => ({
      id: `staff-${index}`, userId: `staff-${index}`, name: `Staff ${index}`,
      email: `staff-${index}@example.com`, role: "teacher", status: "active",
      institute: `Institute ${String(index + 1).padStart(2, "0")}`, department: "Engineering",
    }));
    const dialog = await openAssignments(page, "Biology");
    await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
    await dialog.getByRole("combobox", { name: "Institution", exact: true }).click();
    await expect(page.getByRole("option")).toHaveCount(29);
    await page.keyboard.press("End");
    const last = page.getByRole("option", { name: "Institute 26", exact: true });
    await expect(last).toBeInViewport();
    const menu = page.getByRole("listbox");
    const bounds = (await menu.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`assignment-institutions-${viewport.width}.png`), animations: "disabled" });
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("combobox", { name: "Institution", exact: true })).toHaveText("Institute 26");
    await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
    expect(state.writes).toHaveLength(0);
  });
}

test("promoted invitations retain the canonical IDs from the roster instead of directory IDs", async ({ page }) => {
  const state = await mockAssignments(page);
  state.candidates[1] = { ...state.candidates[1], user_id: "ben-promoted", status: "active" };
  state.rosters.set(beta, { student_ids: ["ben-promoted"], revision: "v1" });
  const dialog = await openAssignments(page, "Biology");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  await expect(dialog.getByRole("listitem").filter({ hasText: "Ben Example" })).toContainText("Active");
  await dialog.getByRole("checkbox", { name: /Alice Example/ }).check();
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(state.writes[0].student_ids.sort()).toEqual(["alice", "ben-promoted"]);
});

test("an explicitly empty roster revokes all students and remains empty on reopen", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openAssignments(page, "Biology");
  await dialog.getByRole("button", { name: "Clear matching", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Saving an empty roster revokes all student access");
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(state.writes[0].student_ids).toEqual([]);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Assign Students", exact: true }).click();
  await choose(page, dialog, "Course / Teaching Assistant (TA)", "Biology");
  await expect(dialog.getByText("0 selected · 4 of 4 students shown", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  expect(state.rosters.get(alpha)?.student_ids).toEqual(["alice", "cara", "former-student"]);
});

test("failed or malformed loads cannot overwrite assignments and can be retried", async ({ page }) => {
  const state = await mockAssignments(page);
  state.getError = { status: 503, detail: "Roster temporarily unavailable." };
  const dialog = await openAssignments(page);
  await expect(dialog.getByRole("alert")).toContainText("Roster temporarily unavailable.");
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  state.getError = null;
  state.malformedRoster = true;
  await dialog.getByRole("button", { name: "Retry loading roster", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("response is incomplete");
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  state.malformedRoster = false;
  await dialog.getByRole("button", { name: "Retry loading roster", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Former Student/ })).toBeChecked();
  expect(state.writes).toHaveLength(0);
});

test("empty candidate directories explain the lack of students without an actionable save", async ({ page }) => {
  const state = await mockAssignments(page);
  state.candidates = [];
  state.rosters.set(alpha, { student_ids: [], revision: "v1" });
  const dialog = await openAssignments(page);
  await expect(dialog.getByText("No student candidates are available.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("No students selected.");
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Select matching", exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});

test("failed course loading can be retried without attempting to save a roster", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agentsError = true;
  await page.goto("/user-directory");
  await page.getByRole("button", { name: "Assign Students", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assign Students", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Courses could not be loaded.");
  await expect(dialog.getByRole("combobox", { name: "Course / Teaching Assistant (TA)", exact: true })).toBeDisabled();
  state.agentsError = false;
  await dialog.getByRole("button", { name: "Retry loading courses", exact: true }).click();
  await choose(page, dialog, "Course / Teaching Assistant (TA)", "Algebra");
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).toBeChecked();
  expect(state.writes).toHaveLength(0);
});

test("failed saves preserve selections for explicit retry and block changes while saving", async ({ page }) => {
  const state = await mockAssignments(page);
  state.putError = { status: 503, detail: "Unable to save student assignments." };
  const dialog = await openAssignments(page);
  await dialog.getByRole("checkbox", { name: /Former Student/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /Ben Example/ }).check();
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Unable to save student assignments.");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  expect(state.rosters.get(alpha)?.student_ids).not.toContain("ben");
  let release!: () => void;
  state.holdPut = new Promise<void>(resolve => { release = resolve; });
  await dialog.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Course / Teaching Assistant (TA)", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1].student_ids).toContain("ben");
});

test("stale revisions cannot overwrite another administrator's saved roster", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openAssignments(page);
  await dialog.getByRole("checkbox", { name: /Former Student/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /Ben Example/ }).check();
  state.rosters.set(alpha, { student_ids: ["cara"], revision: "v2" });
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Student assignments changed.");
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  expect(state.rosters.get(alpha)?.student_ids).toEqual(["cara"]);
  await dialog.getByRole("button", { name: "Reload saved roster", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: /Cara Example/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: /Drew Example/ }).check();
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(state.writes[1].revision).toBe("v2");
  expect(state.rosters.get(alpha)?.student_ids.sort()).toEqual(["cara", "drew"]);
});

test("a student becoming unavailable after load surfaces the server validation error without losing the draft", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openAssignments(page);
  await dialog.getByRole("checkbox", { name: /Former Student/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /Ben Example/ }).check();
  state.candidates = state.candidates.filter(student => student.user_id !== "ben");
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Remove unavailable students before saving.");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  expect(state.rosters.get(alpha)?.student_ids).toEqual(["alice", "cara", "former-student"]);
  await dialog.getByRole("checkbox", { name: /Ben Example/ }).uncheck();
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(state.rosters.get(alpha)?.student_ids.sort()).toEqual(["alice", "cara"]);
});

test("late GET responses cannot replace the current TA's roster, even when abort is ignored", async ({ page }) => {
  const state = await mockAssignments(page);
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (typeof input === "string" && /\/api\/agents\/[^/]+\/students$/.test(input) && !init?.method) {
        return original(input, { ...init, signal: undefined });
      }
      return original(input, init);
    };
  });
  let release!: () => void;
  state.holdGet = { agentId: alpha, until: new Promise<void>(resolve => { release = resolve; }) };
  const dialog = await openAssignments(page);
  await expect(dialog.getByText("Loading saved student assignments…", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  await choose(page, dialog, "Course / Teaching Assistant (TA)", "Biology");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  state.holdGet = null;
  state.rosters.set(alpha, { student_ids: ["drew"], revision: "v2" });
  await choose(page, dialog, "Course / Teaching Assistant (TA)", "Algebra");
  await expect(dialog.getByRole("checkbox", { name: /Drew Example/ })).toBeChecked();
  const lateResponse = page.waitForResponse(response => response.url().includes(encodeURIComponent(alpha)));
  release();
  await (await lateResponse).finished();
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Drew Example/ })).toBeChecked();
  await dialog.getByRole("checkbox", { name: /Ben Example/ }).check();
  await dialog.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(dialog.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(state.writes[0].revision).toBe("v2");
  expect(state.writes[0].student_ids.sort()).toEqual(["ben", "drew"]);
});

test("analytics opens the selected TA and unsaved changes require an explicit discard", async ({ page }) => {
  await mockAssignments(page);
  await page.goto("/analytics");
  await page.getByRole("combobox", { name: "Analytics institution", exact: true }).click();
  await page.getByRole("option", { name: "Example North", exact: true }).click();
  await page.getByRole("combobox", { name: "Analytics department", exact: true }).click();
  await page.getByRole("option", { name: "Mathematics", exact: true }).click();
  await page.getByRole("combobox", { name: "Analytics course", exact: true }).click();
  await page.getByRole("option", { name: "Biology", exact: true }).click();
  await expect(page.getByRole("button", { name: "Teachers", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Assign Students", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assign Students", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Course / Teaching Assistant (TA)", exact: true })).toHaveText("Biology");
  await expect(dialog.getByRole("checkbox", { name: /Ben Example/ })).toBeChecked();
  await dialog.getByRole("checkbox", { name: /Alice Example/ }).check();
  await choose(page, dialog, "Course / Teaching Assistant (TA)", "Algebra");
  const confirmation = page.getByRole("dialog", { name: "Discard unsaved assignments?", exact: true });
  await confirmation.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await confirmation.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(dialog).toBeHidden();
});

for (const options of [
  { role: "student", status: "active" },
  { role: "teacher", status: "active" },
  { role: "admin", status: "invited" },
  { role: "admin", status: "inactive" },
  { role: "admin", status: "active", authenticated: false },
]) {
  test(`assignment controls are hidden for ${JSON.stringify(options)} despite a cached admin role`, async ({ page }) => {
    const state = await mockAssignments(page, options);
    await page.goto("/user-directory");
    await expect(page.getByText("Checking assignment permissions…", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Assign Students", exact: true })).toHaveCount(0);
    expect(state.reads).toHaveLength(0);
  });
}

test("active superadmins are allowed and a failed permission check can be retried", async ({ page }) => {
  const state = await mockAssignments(page, { role: "superadmin" });
  state.permissionError = true;
  await page.goto("/user-directory");
  await expect(page.getByText("Could not verify student-assignment permissions.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign Students", exact: true })).toHaveCount(0);
  state.permissionError = false;
  await page.getByRole("button", { name: "Retry permissions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Assign Students", exact: true })).toBeVisible();
});

test("the roster dialog and save controls fit on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockAssignments(page);
  const dialog = await openAssignments(page);
  await expect(dialog.getByRole("checkbox", { name: /Alice Example/ })).toBeChecked();
  const bounds = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: window.innerWidth, height: window.innerHeight,
      overflows: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(8);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width - 8);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
  expect(bounds.overflows).toBe(false);
  await expect(dialog.getByRole("button", { name: "Save assignments", exact: true })).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
});

async function openAddUserDialog(page: Page) {
  await page.goto("/user-directory");
  await expect(page.getByRole("button", { name: "Assign Students", exact: true })).toBeVisible();
  if (page.viewportSize()!.width < 640) {
    await page.locator("aside").first().locator("button").first().click();
  }
  await page.getByRole("button", { name: "Add User", exact: true }).click();
  return page.getByRole("dialog", { name: "Add New User", exact: true });
}

async function openNewUser(page: Page, email = "new-student@example.com", role = "Student") {
  const dialog = await openAddUserDialog(page);
  await dialog.getByLabel("Name", { exact: true }).fill("New Example");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  if (role !== "Student") await choose(page, dialog, "Role", role);
  await choose(page, dialog, "Institute", "Example North");
  await choose(page, dialog, "Department", "Mathematics");
  return dialog;
}

async function importUsers(dialog: Locator, csv: string) {
  await dialog.getByLabel("Import users CSV").setInputFiles({
    name: "users.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
  });
}

async function selectCsvScope(page: Page, dialog: Locator, course = `Biology (${beta})`, college = "Example North", department = "Mathematics") {
  const csv = dialog.getByRole("region", { name: "Import from CSV", exact: true });
  await choose(page, csv, "CSV college", college);
  await choose(page, csv, "CSV department", department);
  await choose(page, csv, "CSV TA", course);
  return csv;
}

for (const width of [1440, 390]) {
  test(`TA department placement moves a course and unblocks student import at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await mockAssignments(page);
    const originalRoster = [...state.rosters.get(alpha)!.student_ids];
    await page.goto("/user-directory");
    await page.getByRole("button", { name: "Assign TA to department", exact: true }).click();
    const placement = page.getByRole("dialog", { name: "Assign TA to department", exact: true });
    await choose(page, placement, "Teaching Assistant (TA)", "Algebra");
    const college = placement.getByRole("combobox", { name: "TA college", exact: true });
    const department = placement.getByRole("combobox", { name: "TA department", exact: true });
    await expect(college).toHaveValue("Example North");
    await college.fill("Example South");
    await expect(department).toHaveValue("");
    await expect(placement.getByRole("button", { name: "Save TA department", exact: true })).toBeDisabled();
    await department.fill("Engineering");
    await placement.getByRole("button", { name: "Save TA department", exact: true }).click();
    await expect(placement.getByRole("status")).toContainText("TA department saved");
    expect(state.placementWrites).toHaveLength(1);
    expect(state.placementWrites[0]).toMatchObject({ agentId: alpha, institute: "Example South", department: "Engineering", revision: "p1" });
    expect(new URL(state.placementWrites[0].url).origin).toBe("http://127.0.0.1:4185");
    expect(state.rosters.get(alpha)!.student_ids).toEqual(originalRoster);
    expect(state.writes).toEqual([]);
    expect(state.memberWrites).toEqual([]);
    expect(await placement.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await placement.screenshot({ path: testInfo.outputPath(`ta-placement-${width}.png`) });
    await placement.getByRole("button", { name: "Done", exact: true }).click();
    const dialog = await openAddUserDialog(page);
    const csv = await selectCsvScope(page, dialog, `Algebra (${alpha})`, "Example South", "Engineering");
    await importUsers(csv, "name,email,role\nNew Learner,placement@example.com,student");
    await expect(csv.getByText("1 course assignments confirmed", { exact: true })).toBeVisible();
    expect(state.invites.at(-1)).toMatchObject({ institute: "Example South", department: "Engineering" });
    expect(state.memberWrites.at(-1)?.agentId).toBe(alpha);
  });
}

test("TA department placement handles stale saves and clearing without changing rosters", async ({ page }) => {
  const state = await mockAssignments(page);
  const originalRoster = [...state.rosters.get(alpha)!.student_ids];
  await page.goto("/user-directory");
  await page.getByRole("button", { name: "Assign TA to department", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assign TA to department", exact: true });
  await choose(page, dialog, "Teaching Assistant (TA)", "Algebra");
  await expect(dialog.getByRole("combobox", { name: "TA college", exact: true })).toHaveValue("Example North");
  await dialog.getByRole("combobox", { name: "TA department", exact: true }).fill("Physics");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "Discard department changes?", exact: true });
  await discard.getByRole("button", { name: "Keep editing", exact: true }).click();
  state.placements.set(alpha, { agent_id: alpha, institute: "Example South", department: "Mathematics", revision: "p2" });
  await dialog.getByRole("button", { name: "Save TA department", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Reload before saving");
  await dialog.getByRole("button", { name: "Reload saved assignment", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "TA college", exact: true })).toHaveValue("Example South");
  await dialog.getByRole("button", { name: "Clear department placement", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("student and teacher assignments stay unchanged");
  await dialog.getByRole("button", { name: "Save TA department", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("TA department saved");
  expect(state.placementWrites.at(-1)).toMatchObject({ institute: "", department: "", revision: "p2" });
  expect(state.rosters.get(alpha)!.student_ids).toEqual(originalRoster);
  expect(state.memberWrites).toEqual([]);
  expect(state.writes).toEqual([]);
});

test("TA department placement controls require verified administrator permission", async ({ page }) => {
  const state = await mockAssignments(page, { role: "teacher" });
  await page.goto("/user-directory");
  await expect(page.getByRole("button", { name: "Assign TA to department", exact: true })).toHaveCount(0);
  expect(state.placementWrites).toEqual([]);
});

for (const unavailableCourses of [false, true]) {
  test(`CSV permits directory-only users without a TA when courses are ${unavailableCourses ? "unavailable" : "unassigned"}`, async ({ page }) => {
    const state = await mockAssignments(page);
    state.agentsError = unavailableCourses;
    state.agents.forEach(agent => { agent.courseAffiliations = []; });
    const dialog = await openAddUserDialog(page);
    const csv = dialog.getByRole("region", { name: "Import from CSV", exact: true });
    await choose(page, csv, "CSV college", "Example South");
    await choose(page, csv, "CSV department", "Engineering");
    await expect(csv.getByRole("combobox", { name: "CSV TA", exact: true })).toBeDisabled();
    await expect(csv.getByLabel("Import users CSV")).toBeEnabled();
    await importUsers(csv, "name,email,role\nNew Student,no-ta@example.com,student\nNew Teacher,no-ta-teacher@example.com,teacher");
    await expect(csv.getByText("2 directory-only users", { exact: true })).toBeVisible();
    expect(state.invites).toHaveLength(2);
    expect(state.invites.every(user => user.institute === "Example South" && user.department === "Engineering")).toBe(true);
    expect(state.memberWrites).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.placementWrites).toEqual([]);
  });
}

test("CSV import has its own college, department and TA dropdowns above upload", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openAddUserDialog(page);
  const csv = dialog.getByRole("region", { name: "Import from CSV", exact: true });
  await expect(csv).toBeVisible();
  await expect(csv.getByRole("combobox", { name: "CSV college", exact: true })).toBeEnabled();
  await expect(csv.getByRole("combobox", { name: "CSV department", exact: true })).toBeDisabled();
  await expect(csv.getByRole("combobox", { name: "CSV TA", exact: true })).toBeDisabled();
  await expect(csv.getByLabel("Import users CSV")).toBeDisabled();
  await selectCsvScope(page, dialog);
  await expect(csv.getByLabel("Import users CSV")).toBeEnabled();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue("");
  await expect(dialog.getByRole("combobox", { name: "Institute", exact: true })).toContainText("Select institute");
  await expect(dialog.getByRole("combobox", { name: "Course / TA", exact: true })).toContainText("Select course");
  await importUsers(csv, "name,email,role\nCSV Student,csv-only@example.com,student");
  await expect(csv.getByText("1 course assignments confirmed", { exact: true })).toBeVisible();
  expect(state.invites).toEqual([{
    name: "CSV Student", email: "csv-only@example.com", role: "student",
    institute: "Example North", department: "Mathematics",
  }]);
  expect(state.memberWrites[0]).toMatchObject({ agentId: beta, member_type: "student" });
});

for (const role of ["Student", "Teacher"]) {
  test(`new user form adds one ${role.toLowerCase()} membership without replacing existing rosters`, async ({ page }) => {
    const state = await mockAssignments(page);
    const before = [...state.rosters.get(alpha)!.student_ids];
    const email = `new-${role.toLowerCase()}@example.com`;
    const dialog = await openNewUser(page, email, role);
    await choose(page, dialog, "Course / TA", `Algebra (${alpha})`);
    await dialog.getByRole("button", { name: "Add User", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(state.invites).toHaveLength(1);
    expect(state.memberWrites).toHaveLength(1);
    expect(state.memberWrites[0]).toMatchObject({
      agentId: alpha, user_id: "invited-1", member_type: role.toLowerCase(),
    });
    expect(state.memberWrites[0].url).toBe(`http://127.0.0.1:4185/api/agents/${encodeURIComponent(alpha)}/members`);
    expect(state.memberWrites[0].cookie).toContain("session=synthetic-session");
    expect(state.writes).toHaveLength(0);
    expect(state.rosters.get(alpha)!.student_ids).toEqual(role === "Student" ? [...before, "invited-1"] : before);
    if (role === "Student") {
      await expect(page.locator(`[data-course-id="${alpha}"]`).getByRole("cell", { name: email, exact: true })).toBeVisible();
    }
  });
}

test("new user form keeps course optional and never claims institute-wide course access", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openNewUser(page, "alice@example.com");
  await expect(dialog.getByRole("combobox", { name: "Course / TA", exact: true })).toContainText("Select course");
  await dialog.getByRole("button", { name: "Add User", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(/Course assignments are unchanged/)).toBeVisible();
  await expect(page.getByText(/can use all courses/)).toHaveCount(0);
  expect(state.memberWrites).toHaveLength(0);
});

test("new user form resolves promoted student IDs from the authoritative roster", async ({ page }) => {
  const state = await mockAssignments(page);
  state.inviteResponseId = "old-invitation";
  const dialog = await openNewUser(page, "alice@example.com");
  await choose(page, dialog, "Course / TA", `Biology (${beta})`);
  await dialog.getByRole("button", { name: "Add User", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.memberWrites[0]).toMatchObject({ agentId: beta, user_id: "alice", member_type: "student" });
  expect(state.rosters.get(beta)!.student_ids).toEqual(["ben", "alice"]);
});

for (const failure of ["conflict", "unconfirmed"]) {
  test(`new user form retries a ${failure} assignment without creating another invitation`, async ({ page }) => {
    const state = await mockAssignments(page);
    if (failure === "conflict") state.memberError = { status: 409, detail: "The roster changed. Reload it before saving again." };
    else state.malformedMemberResponse = true;
    const dialog = await openNewUser(page);
    await choose(page, dialog, "Course / TA", `Algebra (${alpha})`);
    await dialog.getByRole("button", { name: "Add User", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("user is saved in the directory");
    await expect(dialog.getByLabel("Email", { exact: true })).toBeDisabled();
    expect(state.invites).toHaveLength(1);
    state.memberError = null;
    state.malformedMemberResponse = false;
    await dialog.getByRole("button", { name: "Retry assignment", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(state.invites).toHaveLength(1);
    expect(state.memberWrites).toHaveLength(2);
    expect(state.rosters.get(alpha)!.student_ids).toEqual(["alice", "cara", "former-student", "invited-1"]);
  });
}

test("new user form does not assign a failed invitation and blocks concurrent changes while saving", async ({ page }) => {
  const state = await mockAssignments(page);
  state.inviteError = true;
  const dialog = await openNewUser(page);
  await choose(page, dialog, "Course / TA", `Algebra (${alpha})`);
  await dialog.getByRole("button", { name: "Add User", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Invitation unavailable");
  expect(state.memberWrites).toHaveLength(0);
  await expect(dialog.getByLabel("Email", { exact: true })).toBeEnabled();
  state.inviteError = false;
  let release!: () => void;
  state.holdMember = new Promise<void>(resolve => { release = resolve; });
  await dialog.getByRole("button", { name: "Add User", exact: true }).click();
  await expect.poll(() => state.memberWrites.length).toBe(1);
  await expect(dialog.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Import users CSV")).toBeDisabled();
  await expect(dialog.getByRole("combobox", { name: "Course / TA", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).not.toBeVisible();
  expect(state.invites).toHaveLength(2);
});

test("three-column user CSV applies the selected scope, assigns students and teachers, and keeps admins directory-only", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openAddUserDialog(page);
  await selectCsvScope(page, dialog);
  await importUsers(dialog, [
    "name,email,role",
    "New Student,new-student@example.com,student",
    "New Teacher,new-teacher@example.com,teacher",
    "Alice Example,alice@example.com,student",
    "New Admin,new-admin@example.com,admin",
  ].join("\n"));
  await expect(dialog.getByText("3 course assignments confirmed", { exact: true })).toBeVisible();
  await expect(dialog.getByText("3 added", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1 directory-only users", { exact: true })).toBeVisible();
  expect(state.invites.every(user => user.institute === "Example North" && user.department === "Mathematics")).toBe(true);
  expect(state.memberWrites.every(write => write.agentId === beta)).toBe(true);
  expect(state.memberWrites.map(write => write.member_type)).toEqual(["student", "teacher", "student"]);
  expect(state.rosters.get(alpha)!.student_ids).toEqual(["alice", "cara", "former-student"]);
  expect(state.rosters.get(beta)!.student_ids).toEqual(["ben", "invited-1", "alice"]);
  expect(state.writes).toHaveLength(0);
});

test("user CSV rejects obsolete institution, department and course columns before inviting", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openAddUserDialog(page);
  await selectCsvScope(page, dialog);
  for (const tail of ["institute,department", "institute,department,course"]) {
    await importUsers(dialog, `name,email,role,${tail}\nLegacy,legacy@example.com,student,Ignored College,Ignored Department,ignored-course`);
    await expect(dialog.getByRole("alert")).toContainText("Use only name,email,role");
  }
  expect(state.invites).toHaveLength(0);
  expect(state.memberWrites).toHaveLength(0);
});

test("user CSV requires a selected course and supports the requested user-name and email-id headers", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openNewUser(page);
  await expect(dialog.getByLabel("Import users CSV")).toBeDisabled();
  await choose(page, dialog, "Course / TA", `Biology (${beta})`);
  await expect(dialog.getByLabel("Import users CSV")).toBeDisabled();
  await selectCsvScope(page, dialog);
  await expect(dialog.getByLabel("Import users CSV")).toBeEnabled();
  await importUsers(dialog, "user name,user email id,role\nExample,example-student@example.com,student");
  await expect(dialog.getByText("1 added", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1 course assignments confirmed", { exact: true })).toBeVisible();
  expect(state.invites).toHaveLength(1);
  expect(state.memberWrites[0].agentId).toBe(beta);
});

test("user CSV reports saved users separately from failed assignments and supports idempotent retry", async ({ page }) => {
  const state = await mockAssignments(page);
  state.memberError = { status: 503, detail: "Membership unavailable" };
  const dialog = await openAddUserDialog(page);
  await selectCsvScope(page, dialog);
  const csv = "name,email,role\nNew Student,new-student@example.com,student";
  await importUsers(dialog, csv);
  await expect(dialog.getByText("1 added", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1 course assignments need retry", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Re-import this row to retry");
  state.memberError = null;
  await importUsers(dialog, csv);
  await expect(dialog.getByText("1 course assignments confirmed", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(state.candidates.filter(candidate => candidate.email === "new-student@example.com")).toHaveLength(1);
  expect(state.rosters.get(beta)!.student_ids).toEqual(["ben", "invited-1"]);
});

test("course assignment never changes an existing student's saved role to teacher", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openNewUser(page, "alice@example.com", "Teacher");
  await choose(page, dialog, "Course / TA", `Biology (${beta})`);
  await dialog.getByRole("button", { name: "Add User", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("saved role is student, not teacher");
  expect(state.memberWrites).toHaveLength(0);
});

test("user CSV handles quoted user names and explicitly rejects malformed rows", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agents[0].courseName = "Algebra, Advanced";
  const dialog = await openAddUserDialog(page);
  await selectCsvScope(page, dialog, `Algebra, Advanced (${alpha})`);
  await importUsers(dialog, 'name,email,role\n"Example, Student",quoted@example.com,student');
  await expect(dialog.getByText("1 course assignments confirmed", { exact: true })).toBeVisible();
  expect(state.invites[0].name).toBe("Example, Student");
  expect(state.memberWrites[0].agentId).toBe(alpha);
  await importUsers(dialog, 'name,email,role\n"Unclosed,broken@example.com,student');
  await expect(dialog.getByRole("alert")).toContainText("unterminated quoted field");
  expect(state.invites).toHaveLength(1);
});

test("new user form can recover course loading and refuses assignments after permission is lost", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agentsError = true;
  const dialog = await openNewUser(page);
  await expect(dialog.getByRole("combobox", { name: "Course / TA", exact: true })).toBeDisabled();
  state.agentsError = false;
  await dialog.getByRole("button", { name: "Retry loading courses", exact: true }).click();
  await choose(page, dialog, "Course / TA", `Algebra (${alpha})`);
  state.permissionError = true;
  await dialog.getByRole("button", { name: "Add User", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Profile unavailable");
  expect(state.memberWrites).toHaveLength(0);
  state.permissionError = false;
  await dialog.getByRole("button", { name: "Retry assignment", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.invites).toHaveLength(1);
  expect(state.memberWrites).toHaveLength(1);
});

test("new user form fits on mobile and its CSV template contains only name, email and role", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await mockAssignments(page);
  const dialog = await openNewUser(page);
  const bounds = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflow: element.scrollWidth > element.clientWidth + 1 };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(8);
  expect(bounds.right).toBeLessThanOrEqual(382);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(720);
  expect(bounds.overflow).toBe(false);
  await dialog.getByRole("button", { name: "View Template", exact: true }).click();
  const template = page.getByRole("dialog", { name: "CSV Template — Users", exact: true });
  await expect(template.getByRole("columnheader")).toHaveText(["name", "email", "role"]);
  await expect(template.getByRole("columnheader", { name: /institute|department|course/ })).toHaveCount(0);
  await expect(template.getByText(/Existing memberships are never replaced/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await template.getByRole("button", { name: "Download Template", exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString("utf8").split("\n")[0]).toBe("name,email,role");
});

test("new user course options match affiliation pairs and reset when institution or department changes", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agents[0].courseAffiliations.push({ institute: "Example South", department: "Physics" });
  state.agents[1].courseAffiliations = [{ institute: "Example North", department: "Engineering" }];
  const dialog = await openNewUser(page);
  const course = dialog.getByRole("combobox", { name: "Course / TA", exact: true });
  await course.click();
  await expect(page.getByRole("option", { name: `Algebra (${alpha})`, exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: `Biology (${beta})`, exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: `Algebra (${alpha})`, exact: true }).click();
  await expect(dialog.getByLabel("Import users CSV")).toBeDisabled();
  await choose(page, dialog, "Department", "Engineering");
  await expect(course).toContainText("Select course");
  await expect(dialog.getByLabel("Import users CSV")).toBeDisabled();
  await course.click();
  await expect(page.getByRole("option", { name: `Algebra (${alpha})`, exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: `Biology (${beta})`, exact: true }).click();
  await choose(page, dialog, "Institute", "Example South");
  await expect(dialog.getByRole("combobox", { name: "Department", exact: true })).toContainText("Select department");
  await expect(course).toBeDisabled();
  await expect(dialog.getByLabel("Import users CSV")).toBeDisabled();
  await choose(page, dialog, "Department", "Mathematics");
  await expect(dialog.getByText("No courses match this institution and department. You can still add a single user without an assignment.")).toBeVisible();
  await expect(course).toBeDisabled();
  await choose(page, dialog, "Department", "Physics");
  await choose(page, dialog, "Course / TA", `Algebra (${alpha})`);
  await dialog.getByRole("button", { name: "Add User", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.invites[0]).toMatchObject({ institute: "Example South", department: "Physics" });
  expect(state.memberWrites[0].agentId).toBe(alpha);
});

test("analytics scopes courses and discards an old overview after parent filters change", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agents[1].courseAffiliations = [{ institute: "Example North", department: "Engineering" }];
  let release!: () => void;
  let requested = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/dashboard/agents/**/overview", async route => {
    if (!route.request().url().includes(encodeURIComponent(alpha))) return route.fallback();
    requested = true;
    await held;
    await route.fulfill({ json: {
      agent_id: alpha, student_count: 99, avg_pct_complete: 0, total_topics: 0,
      distribution: { "0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0 },
      top_struggle_topics: [], students: [],
      usage: { agent_id: alpha, active_students: 99, active_teachers: 1, total_threads: 0, active_threads: 0 },
    } });
  });
  try {
    await page.goto("/analytics");
    const institution = page.getByRole("combobox", { name: "Analytics institution", exact: true });
    const department = page.getByRole("combobox", { name: "Analytics department", exact: true });
    const course = page.getByRole("combobox", { name: "Analytics course", exact: true });
    await expect(department).toBeDisabled();
    await expect(course).toBeDisabled();
    await institution.click();
    await page.getByRole("option", { name: "Example North", exact: true }).click();
    await department.click();
    await page.getByRole("option", { name: "Mathematics", exact: true }).click();
    await course.click();
    await expect(page.getByRole("option", { name: "Biology", exact: true })).toHaveCount(0);
    await page.getByRole("option", { name: "Algebra", exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await department.click();
    await page.getByRole("option", { name: "Engineering", exact: true }).click();
    await expect(course).toContainText("Select course");
    await expect(page.getByRole("button", { name: "Teachers", exact: true })).toHaveCount(0);
    await course.click();
    await expect(page.getByRole("option", { name: "Algebra", exact: true })).toHaveCount(0);
    await page.getByRole("option", { name: "Biology", exact: true }).click();
    await expect(page.getByRole("button", { name: "Teachers", exact: true })).toBeVisible();
    const response = page.waitForResponse(res => res.url().includes(`${encodeURIComponent(alpha)}/overview`));
    release();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(course).toContainText("Biology");
    await expect(page.getByText("99", { exact: true })).toHaveCount(0);
  } finally { release(); }
});

test("courses without affiliations are excluded rather than offered to every college", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agents[1].courseAffiliations = [];
  const dialog = await openNewUser(page);
  await dialog.getByRole("combobox", { name: "Course / TA", exact: true }).click();
  await expect(page.getByRole("option", { name: `Biology (${beta})`, exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: `Algebra (${alpha})`, exact: true })).toBeVisible();
});

test("CSV bulk import locks its own scope while saving and does not use the single-user form", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openNewUser(page, "unused-single@example.com", "Admin");
  await choose(page, dialog, "Institute", "Example South");
  await choose(page, dialog, "Department", "Engineering");
  await selectCsvScope(page, dialog);
  let release!: () => void;
  state.holdMember = new Promise<void>(resolve => { release = resolve; });
  try {
    await importUsers(dialog, "name,email,role\nFirst,first@example.com,student\nSecond,second@example.com,teacher");
    await expect.poll(() => state.memberWrites.length).toBe(1);
    for (const label of ["Institute", "Department", "Course / TA", "CSV college", "CSV department", "CSV TA"]) {
      await expect(dialog.getByRole("combobox", { name: label, exact: true })).toBeDisabled();
    }
    await expect(dialog.getByLabel("Import users CSV")).toBeDisabled();
    release();
    await expect(dialog.getByText("2 course assignments confirmed", { exact: true })).toBeVisible();
    expect(state.invites.map(user => user.role)).toEqual(["student", "teacher"]);
    expect(state.invites.every(user => user.institute === "Example North" && user.department === "Mathematics")).toBe(true);
    expect(state.memberWrites.every(write => write.agentId === beta)).toBe(true);
  } finally { release(); }
});

test("three-column CSV validation reports invalid roles, missing emails and extra fields without writes", async ({ page }) => {
  const state = await mockAssignments(page);
  const dialog = await openAddUserDialog(page);
  await selectCsvScope(page, dialog);
  await importUsers(dialog, [
    "name,email,role",
    "No Email,,student",
    "Invalid Role,invalid@example.com,owner",
    "Extra Field,extra@example.com,student,unexpected",
  ].join("\n"));
  await expect(dialog.getByText("3 skipped", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("email is required");
  await expect(dialog.getByRole("alert")).toContainText('invalid role "owner"');
  await expect(dialog.getByRole("alert")).toContainText("expected only 3 columns");
  expect(state.invites).toHaveLength(0);
  expect(state.memberWrites).toHaveLength(0);
});

test("CSV dropdowns filter in order, reset dependents and remain independent of manual edits", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agents[0].courseAffiliations.push({ institute: "Example South", department: "Physics" });
  state.agents[1].courseAffiliations = [{ institute: "Example North", department: "Engineering" }];
  const dialog = await openNewUser(page);
  await choose(page, dialog, "Course / TA", `Algebra (${alpha})`);
  const csv = dialog.getByRole("region", { name: "Import from CSV", exact: true });
  await expect(csv.getByRole("combobox", { name: "CSV college", exact: true })).toContainText("Select college");
  await expect(csv.getByLabel("Import users CSV")).toBeDisabled();
  await choose(page, csv, "CSV college", "Example North");
  await choose(page, csv, "CSV department", "Mathematics");
  const ta = csv.getByRole("combobox", { name: "CSV TA", exact: true });
  await ta.click();
  await expect(page.getByRole("option", { name: `Biology (${beta})`, exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: `Algebra (${alpha})`, exact: true }).click();
  await expect(csv.getByLabel("Import users CSV")).toBeEnabled();

  await choose(page, csv, "CSV department", "Engineering");
  await expect(ta).toContainText("No TA");
  await expect(csv.getByLabel("Import users CSV")).toBeEnabled();
  await ta.click();
  await expect(page.getByRole("option", { name: `Algebra (${alpha})`, exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: `Biology (${beta})`, exact: true }).click();
  await choose(page, csv, "CSV college", "Example South");
  await expect(csv.getByRole("combobox", { name: "CSV department", exact: true })).toContainText("Select department");
  await expect(ta).toBeDisabled();
  await expect(csv.getByLabel("Import users CSV")).toBeDisabled();
  await choose(page, csv, "CSV department", "Engineering");
  await expect(csv.getByText(/No TAs match this college and department/)).toBeVisible();
  await expect(ta).toBeDisabled();
  await expect(csv.getByLabel("Import users CSV")).toBeEnabled();
  await choose(page, csv, "CSV department", "Physics");
  await choose(page, csv, "CSV TA", `Algebra (${alpha})`);

  await expect(dialog.getByRole("combobox", { name: "Institute", exact: true })).toContainText("Example North");
  await expect(dialog.getByRole("combobox", { name: "Department", exact: true })).toContainText("Mathematics");
  await choose(page, dialog, "Department", "Engineering");
  await expect(ta).toContainText("Algebra");
  await expect(csv.getByRole("combobox", { name: "CSV department", exact: true })).toContainText("Physics");
  await importUsers(csv, "name,email,role\nScoped Student,scoped@example.com,student");
  await expect(csv.getByText("1 course assignments confirmed", { exact: true })).toBeVisible();
  expect(state.invites[0]).toMatchObject({ institute: "Example South", department: "Physics" });
  expect(state.memberWrites[0].agentId).toBe(alpha);

  await choose(page, dialog, "Institute", "Example South");
  await expect(csv.getByText("1 course assignments confirmed", { exact: true })).toBeVisible();
});

test("CSV selectors reset when the dialog closes and report course-load failures beside upload", async ({ page }) => {
  const state = await mockAssignments(page);
  state.agentsError = true;
  const dialog = await openAddUserDialog(page);
  const csv = dialog.getByRole("region", { name: "Import from CSV", exact: true });
  await expect(csv.getByRole("alert")).toContainText("Courses could not be loaded");
  await expect(csv.getByRole("combobox", { name: "CSV TA", exact: true })).toBeDisabled();
  await expect(csv.getByLabel("Import users CSV")).toBeDisabled();
  state.agentsError = false;
  await csv.getByRole("button", { name: "Retry CSV courses", exact: true }).click();
  await selectCsvScope(page, dialog);
  await expect(csv.getByLabel("Import users CSV")).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add User", exact: true }).click();
  await expect(csv.getByRole("combobox", { name: "CSV college", exact: true })).toContainText("Select college");
  await expect(csv.getByRole("combobox", { name: "CSV department", exact: true })).toBeDisabled();
  await expect(csv.getByRole("combobox", { name: "CSV TA", exact: true })).toBeDisabled();
  await expect(csv.getByLabel("Import users CSV")).toBeDisabled();
  expect(state.invites).toHaveLength(0);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 720 }]) {
  test(`CSV controls sit directly above upload and fit at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockAssignments(page);
    const dialog = await openAddUserDialog(page);
    const csv = await selectCsvScope(page, dialog);
    await csv.scrollIntoViewIfNeeded();
    for (const name of ["CSV college", "CSV department", "CSV TA"]) {
      await expect(csv.getByRole("combobox", { name, exact: true })).toBeInViewport();
    }
    const layout = await csv.evaluate(element => {
      const controls = [...element.querySelectorAll('[role="combobox"]')].map(control => control.getBoundingClientRect());
      const upload = element.querySelector('input[type="file"]')!.parentElement!.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return {
        controlsAboveUpload: controls.every(control => control.bottom <= upload.top),
        contained: controls.every(control => control.left >= rect.left && control.right <= rect.right),
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
      };
    });
    expect(layout).toEqual({ controlsAboveUpload: true, contained: true, horizontalOverflow: false });
    await expect(csv.getByLabel("Import users CSV")).toBeEnabled();
    await csv.screenshot({ path: testInfo.outputPath(`csv-controls-${viewport.width}.png`) });
  });
}
