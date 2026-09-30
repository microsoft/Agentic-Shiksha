import { expect, test, type Locator, type Page } from "@playwright/test";
import { resolveCourseAvatar, type CourseAvatarOptions } from "./src/lib/courseAvatar";

const agentId = "course-Electronics-Mechanic";
const courseName = "Electronics Mechanic";
const coursePath = `/course/${encodeURIComponent(courseName)}`;
const code = "ABC123";
const user = {
  userId: "example-user",
  displayName: "Example Teacher",
  email: "user@example.com",
  role: "teacher",
  authProvider: "microsoft",
  isAuthenticated: true,
};

async function mockApp(page: Page, authenticated = true, hasCourse = true, access: "new" | "member" | "owner" = "new", role: "student" | "teacher" = "teacher", course: { name?: string; imageUrl?: string } = {}) {
  const account = { ...user, role };
  const currentCourseName = course.name ?? courseName;
  const currentAgentName = `course-${currentCourseName.replace(/\s+/g, "-")}`;
  const connections: string[] = [];
  let alreadyJoined = access !== "new";
  await page.addInitScript(({ user, agentId, agentName, courseName, authenticated, hasCourse }) => {
    if (sessionStorage.getItem("sharing-test-seeded")) return;
    sessionStorage.setItem("sharing-test-seeded", "true");
    if (authenticated) {
      localStorage.setItem("ekalaiva.user.v1", JSON.stringify({ state: user, version: 1 }));
    }
    localStorage.setItem("ekalaiva.chat.v1", JSON.stringify({
      version: 2,
      state: {
        onboardingCompleted: true,
        userStatus: "active",
        userName: "Example",
        userFullName: user.displayName,
        projects: hasCourse ? {
          "example-project": {
            id: "example-project",
            name: courseName,
            agentId,
            agentName,
            createdAt: 1,
            updatedAt: 1,
          },
        } : {},
        threads: {},
        messagesByThreadId: {},
        activeThreadId: null,
      },
    }));
  }, { user: account, agentId, agentName: currentAgentName, courseName: currentCourseName, authenticated, hasCourse });

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === "/auth/me") {
      await route.fulfill({ status: authenticated ? 200 : 401, json: { id: account.userId, ...account } });
    } else if (pathname === "/api/agents/connect-by-code") {
      const submittedCode = route.request().postDataJSON().code;
      connections.push(submittedCode);
      const result = { agent_id: agentId, agent_name: currentAgentName, course_name: currentCourseName, already_joined: alreadyJoined };
      if (submittedCode === code) alreadyJoined = true;
      await route.fulfill({
        status: submittedCode === code ? 200 : 404,
        json: submittedCode === code
          ? result
          : { detail: "No agent found with that code." },
      });
    } else if (pathname.endsWith("/manage-code")) {
      await route.fulfill({ json: { manage_code: code } });
    } else if (pathname === "/api/azure/agents/list") {
      await route.fulfill({ json: [{ id: agentId, name: currentAgentName, createdById: user.userId, created_by: user.displayName, model: "gpt-4.1", agentImageUrl: course.imageUrl }] });
    } else if (pathname.startsWith("/api/user/")) {
      await route.fulfill({ json: { success: true, profile: { ...account, fullName: account.displayName, onboardingCompleted: true, status: "active" } } });
    } else if (pathname === "/api/config") {
      await route.fulfill({ json: { default_model: "gpt-4.1", agent_model: "gpt-4.1", allowed_models: ["gpt-4.1"], version: "test" } });
    } else if (pathname.startsWith("/api/agents/setup/")) {
      await route.fulfill({ json: { courseName: currentCourseName, createdById: user.userId, conversationStarters: [], agentImageUrl: course.imageUrl } });
    } else if (pathname.endsWith("/conversation-starters")) {
      await route.fulfill({ json: { starters: [] } });
    } else if (pathname.startsWith("/api/")) {
      await route.fulfill({ json: { success: true, status: "not_available", threads: [], messages: [], assets: [], versions: [], total: 0, hasMore: false, progress: null } });
    } else if (url.hostname === "127.0.0.1") {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  return connections;
}

async function openShareDialog(page: Page) {
  await page.goto(coursePath);
  await page.getByRole("button", { name: "TA actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^TA Code/ })).toHaveCount(0);
  await page.getByRole("menuitem", { name: /^Share TA/ }).click();
  await expect(page.getByRole("dialog", { name: "Share TA" })).toBeVisible();
}

async function expectCourseAvatar(avatar: Locator, initials: string, size: number) {
  await expect(avatar).toHaveText(initials);
  await expect(avatar).toHaveAttribute("aria-hidden", "true");
  await expect(avatar).toHaveCSS("width", `${size}px`);
  await expect(avatar).toHaveCSS("height", `${size}px`);
  await expect(avatar).toHaveCSS("border-radius", size === 96 ? "16px" : "12px");
  await expect(avatar).toHaveCSS("background-color", "rgb(38, 38, 38)");
  await expect(avatar.locator("svg, img")).toHaveCount(0);
  const color = await avatar.evaluate(element => getComputedStyle(element).color);
  const channels = color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
  expect(channels).toHaveLength(3);
  expect(new Set(channels).size).toBeGreaterThan(1);
  const linearize = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const linear = channels.map(linearize);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  expect((luminance + 0.05) / (linearize(38) + 0.05)).toBeGreaterThanOrEqual(4.5);
  return color;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`keeps both sidebar modes compact at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockApp(page);
    await page.goto(coursePath);
    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toHaveCSS("width", "256px");
    await expect(sidebar.getByText("Shiksha", { exact: true })).toHaveCSS("font-size", "16px");
    const divider = sidebar.locator("nav + div[aria-hidden='true']");
    await expect(divider).toHaveCSS("height", "1px");
    await expect(divider).toHaveCSS("background-color", "rgba(64, 64, 64, 0.5)");
    for (const name of ["Library", "Assets", "Create", "Dashboard"]) {
      const button = sidebar.getByRole("button", { name, exact: true });
      await expect(button).toHaveCSS("height", "32px");
      await expect(button.locator("span")).toHaveCSS("font-size", "13px");
      await expect(button.locator("svg")).toHaveCSS("width", "16px");
      await button.click({ trial: true });
    }
    await expect(sidebar.getByRole("button", { name: "My Courses", exact: true })).toHaveCSS("height", "32px");
    const course = sidebar.getByRole("button", { name: courseName, exact: true });
    await expect(course).toHaveCSS("height", "32px");
    await expect(course.locator("span")).toHaveCSS("font-size", "13px");
    const expandedProfile = sidebar.getByRole("button", { name: "ET Example", exact: true });
    await expect(expandedProfile.locator("span")).toHaveCSS("font-size", "13px");
    await expect(expandedProfile.locator("div")).toHaveCSS("width", "28px");
    await expect.poll(() => sidebar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await sidebar.screenshot({ path: testInfo.outputPath(`expanded-sidebar-${viewport.width}.png`), animations: "disabled" });
    const iconCenters = () => sidebar.locator("nav button svg")
      .or(sidebar.getByRole("button", { name: /^My Courses/ }).locator("svg").first())
      .evaluateAll(icons => icons.map(icon => {
        const bounds = icon.getBoundingClientRect();
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      }));
    const expandedIconCenters = await iconCenters();
    expect(expandedIconCenters).toHaveLength(5);
    const expectAlignedIcons = () => expect.poll(async () => {
      const currentCenters = await iconCenters();
      if (currentCenters.length !== expandedIconCenters.length) return Infinity;
      return Math.max(...currentCenters.flatMap((center, index) => [
        Math.abs(center.x - expandedIconCenters[index].x),
        Math.abs(center.y - expandedIconCenters[index].y),
      ]));
    }, { message: "Sidebar icon centers stay aligned across modes and active states" }).toBeLessThan(1);
    const expandedProfileCenter = await expandedProfile.locator("div").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    });
    const expandedLibrary = sidebar.getByRole("button", { name: "Library", exact: true });
    let expandedDimensions = { width: "", height: "", iconWidth: "" };
    await expect.poll(async () => {
      expandedDimensions = await expandedLibrary.evaluate(element => {
        const style = getComputedStyle(element);
        return { width: style.width, height: style.height, iconWidth: getComputedStyle(element.querySelector("svg")!).width };
      });
      return Object.values(expandedDimensions).every(value => parseFloat(value) > 0);
    }).toBe(true);
    await sidebar.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(sidebar).toHaveCSS("width", "48px");
    for (const name of ["Expand sidebar", "Library", "Assets", "Create teaching assistant", "Dashboard"]) {
      const button = sidebar.getByRole("button", { name, exact: true });
      await expect(button).toHaveCSS("width", "36px");
      await expect(button).toHaveCSS("height", "36px");
      await expect(button.locator("svg")).toHaveCSS("width", "16px");
      await button.click({ trial: true });
    }
    await expect(sidebar.getByRole("button", { name: "Library", exact: true })).toHaveAttribute("title", "Library");
    await expect(sidebar.getByRole("button", { name: /^My Courses/ })).toHaveCSS("width", "36px");
    await expect(sidebar.getByRole("button", { name: /^My Courses/ })).toHaveCSS("height", "36px");
    await expect.poll(() => sidebar.evaluate(element => {
      const rail = element.getBoundingClientRect();
      return [...element.querySelectorAll("button")].every(button => {
        const bounds = button.getBoundingClientRect();
        return bounds.left >= rail.left && bounds.right <= rail.right;
      });
    })).toBe(true);
    const profile = sidebar.getByRole("button", { name: "User Menu", exact: true });
    await expect(profile).toHaveCSS("width", "32px");
    await expect(profile).toHaveCSS("font-size", "12px");
    await expectAlignedIcons();
    await expect.poll(() => profile.evaluate((element, expandedCenter) => {
      const bounds = element.getBoundingClientRect();
      return Math.max(
        Math.abs(bounds.left + bounds.width / 2 - expandedCenter.x),
        Math.abs(bounds.top + bounds.height / 2 - expandedCenter.y),
      );
    }, expandedProfileCenter), { message: "Profile avatar stays aligned across sidebar modes" }).toBeLessThan(1);
    await profile.click();
    await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await sidebar.screenshot({ path: testInfo.outputPath(`compact-sidebar-${viewport.width}.png`), animations: "disabled" });
    await sidebar.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect(sidebar).toHaveCSS("width", "256px");
    await expect(expandedLibrary).toHaveCSS("width", expandedDimensions.width);
    await expect(expandedLibrary).toHaveCSS("height", expandedDimensions.height);
    await expect(expandedLibrary.locator("svg")).toHaveCSS("width", expandedDimensions.iconWidth);
    await expectAlignedIcons();
    await sidebar.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await sidebar.getByRole("button", { name: "Library", exact: true }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(sidebar).toHaveCSS("width", "48px");
    await expectAlignedIcons();
    await sidebar.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect(sidebar).toHaveCSS("width", "256px");
    await expectAlignedIcons();
  });

  test(`keeps the chat header compact without shrinking its controls at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockApp(page);
    await page.goto(coursePath);
    await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
    const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
    if (await collapse.isVisible()) await collapse.click();
    await expect.poll(() => page.evaluate(async () => {
      const modulePath = "/src/lib/chatStore.ts";
      const { useChatStore } = await import(modulePath);
      return Boolean(useChatStore.getState().activeThreadId);
    })).toBe(true);
    const header = page.getByTestId("chat-header");
    const expectRightAligned = () => expect.poll(() => header.evaluate(element => {
      const button = element.querySelector('button[aria-label="TA actions"]')!;
      return element.getBoundingClientRect().right - button.getBoundingClientRect().right;
    })).toBeCloseTo(12, 1);
    await expect(header).toHaveCSS("height", "44px");
    await expect(header.getByRole("group", { name: "Chat actions", exact: true })).toHaveCSS("column-gap", "2px");
    for (const name of ["Chat History", "TA actions"]) {
      const button = header.getByRole("button", { name, exact: true });
      await expect(button.locator("svg")).toHaveCSS("width", "18px");
      await expect(button.locator("svg")).toHaveCSS("height", "18px");
      await expect(button).toHaveCSS("width", "32px");
      await expect(button).toHaveCSS("height", "32px");
      await button.click({ trial: true });
    }
    await expectRightAligned();
    await expect(header.getByRole("button", { name: "TA actions", exact: true }).locator("svg")).toHaveAttribute("stroke-width", "3");
    await header.screenshot({ path: testInfo.outputPath(`chat-header-empty-${viewport.width}.png`), animations: "disabled" });
    const courseInfo = header.getByRole("button", { name: courseName, exact: true });
    await expect(courseInfo).toHaveAttribute("aria-haspopup", "dialog");
    await expect(courseInfo.locator("span")).toHaveCSS("text-decoration-line", "underline");
    await expect(courseInfo.locator("svg, img")).toHaveCount(0);
    await courseInfo.hover();
    await expect(courseInfo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(courseInfo.locator("span")).toHaveCSS("text-decoration-line", "underline");
    await expect(courseInfo.locator("span")).toHaveCSS("text-decoration-style", "solid");
    await expect(courseInfo.locator("span")).toHaveCSS("text-decoration-thickness", "1px");
    await header.screenshot({ path: testInfo.outputPath(`chat-header-hover-${viewport.width}.png`), animations: "disabled" });
    await expect(header.getByRole("button", { name: "Course Info", exact: true })).toHaveCount(0);
    await courseInfo.click();
    const infoDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: courseName, exact: true }) });
    await expect(infoDialog).toBeVisible();
    await expectCourseAvatar(infoDialog.getByTestId("course-avatar"), "EM", 80);
    await page.keyboard.press("Escape");
    await expect(infoDialog).toHaveCount(0);
    await courseInfo.blur();
    await page.mouse.move(0, 0);
    await expect(courseInfo.locator("span")).toHaveCSS("text-decoration-line", "underline");
    const newTitle = header.getByText("New Chat", { exact: true });
    await expect(newTitle).toHaveCount(0);
    for (const name of [courseName, "Chat History", "TA actions"]) {
      const button = header.getByRole("button", { name, exact: true });
      await expect(button).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
      await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
    await page.evaluate(async () => {
      const modulePath = "/src/lib/chatStore.ts";
      const { useChatStore } = await import(modulePath);
      const state = useChatStore.getState();
      const threadId = state.activeThreadId;
      state.appendMessage(threadId, { role: "user", content: "Hello", createdAt: Date.now() });
      state.appendMessage(threadId, { role: "assistant", content: "Welcome to the course.", createdAt: Date.now() });
    });
    await expect(newTitle).toHaveCount(0);
    await page.evaluate(async () => {
      const modulePath = "/src/lib/chatStore.ts";
      const { useChatStore } = await import(modulePath);
      const state = useChatStore.getState();
      state.renameThread(state.activeThreadId, "Friendly Greeting and Assistance");
    });
    await expect(header).toHaveCSS("height", "44px");
    await expect(header.getByText(courseName, { exact: true })).toBeVisible();
    await expect(header.getByText("Friendly Greeting and Assistance", { exact: true })).toBeVisible();
    await expect(header.getByText("Friendly Greeting and Assistance", { exact: true })).toHaveCSS("font-style", "italic");
    await expect(header.getByText("Friendly Greeting and Assistance", { exact: true })).toHaveCSS("font-synthesis", "style");
    await expect(header.getByText("Friendly Greeting and Assistance", { exact: true })).toHaveCSS("font-weight", "400");
    await expect(header.getByText(courseName, { exact: true })).toHaveCSS("font-style", "normal");
    await expect(header.getByText(courseName, { exact: true })).toHaveCSS("font-synthesis", "none");
    await expect(header.getByText(courseName, { exact: true })).toHaveCSS("font-weight", "500");
    await expect(header.getByRole("button", { name: "Share Chat", exact: true })).toBeVisible();
    await expect(header.getByRole("group", { name: "Chat actions", exact: true }).getByRole("button")).toHaveCount(4);
    await expect.poll(() => header.getByRole("group", { name: "Chat actions", exact: true }).evaluate(element => {
      const buttons = [...element.querySelectorAll("button")];
      return buttons.slice(1).every((button, index) =>
        Math.abs(button.getBoundingClientRect().left - buttons[index].getBoundingClientRect().right - 2) < 1);
    })).toBe(true);
    await expectRightAligned();
    await page.mouse.move(0, 0);
    await expect.poll(() => header.evaluate(element => {
      const frame = element.getBoundingClientRect();
      return [...element.querySelectorAll("button")].every(button => {
        const bounds = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return bounds.height >= 30 && bounds.width >= 30
          && bounds.top >= frame.top && bounds.bottom <= frame.bottom
          && bounds.left >= frame.left && bounds.right <= frame.right
          && style.borderTopColor === "rgba(0, 0, 0, 0)"
          && style.backgroundColor === "rgba(0, 0, 0, 0)";
      });
    })).toBe(true);
    if (viewport.width < 1024) {
      const title = await header.getByText("Friendly Greeting and Assistance", { exact: true }).boundingBox();
      const course = await courseInfo.boundingBox();
      const history = await header.getByRole("button", { name: "Chat History", exact: true }).boundingBox();
      expect(course!.x + course!.width).toBeLessThanOrEqual(title!.x);
      expect(title!.x + title!.width).toBeLessThanOrEqual(history!.x);
    }
    await header.screenshot({ path: testInfo.outputPath(`chat-header-${viewport.width}.png`), animations: "disabled" });
    await header.getByRole("button", { name: "TA actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /^Share TA/ })).toBeVisible();
    await page.keyboard.press("Escape");
    for (const name of [courseName, "Chat History", "Share Chat", "New Chat"]) {
      await header.getByRole("button", { name, exact: true }).click({ trial: true });
    }
    await header.getByRole("button", { name: "Chat History", exact: true }).click();
    await expect(header).toHaveCSS("height", "44px");
    await expect(header.getByRole("button", { name: "Course Info", exact: true })).toHaveCount(0);
    await expect(header.getByRole("button", { name: "Chat History", exact: true })).toHaveCount(0);
    await expect(header.getByRole("button", { name: "TA actions", exact: true }).locator("svg")).toHaveCSS("width", "18px");
    await expectRightAligned();
    await header.getByRole("button", { name: "TA actions", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(courseInfo).toBeFocused();
    await expect(courseInfo.locator("span")).toHaveCSS("text-decoration-line", "underline");
    await page.keyboard.press("Enter");
    await expect(infoDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(infoDialog).toHaveCount(0);
    await header.getByRole("button", { name: "TA actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /^Course Info/ })).toBeVisible();
  });

  test(`keeps material-processing status out of Course Info at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockApp(page, true, true, "owner");
    const description = "Learn electrical concepts through practical examples.";
    await page.route("**/api/agents/setup/**", route => route.fulfill({ json: {
      courseName, createdById: user.userId, conversationStarters: [],
      materialJobId: "example-material-job", agentDescription: description,
      courseCode: "EM101", courseLevel: "Certificate",
    } }));
    const materialRequests: string[] = [];
    await page.route("**/api/knowledge/jobs/**", route => {
      materialRequests.push(route.request().url());
      return route.fulfill({ json: { job_id: "example-material-job", status: "PROCESSING", progress: "indexing", files: [] } });
    });
    await page.goto(coursePath);
    await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
    const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
    if (await collapse.isVisible()) await collapse.click();
    const infoButton = page.getByTestId("chat-header").getByRole("button", { name: courseName, exact: true });
    await infoButton.click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: courseName, exact: true }) });
    await expect(dialog.getByText(description, { exact: true })).toBeVisible();
    await expect(dialog.getByText("EM101", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Certificate", { exact: true })).toBeVisible();
    await expectCourseAvatar(dialog.getByTestId("course-avatar"), "EM", 80);
    await expect(dialog.getByRole("heading", { name: "Capabilities", exact: true })).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Material processing status", exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Materials processing", { exact: true })).toHaveCount(0);
    await dialog.screenshot({ path: testInfo.outputPath(`course-info-no-materials-${viewport.width}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await infoButton.click();
    await expect(dialog.getByText(description, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Material processing status", exact: true })).toHaveCount(0);
    expect(materialRequests).toEqual([]);
  });
}

for (const fixture of [
  { name: "Ca Course", initials: "CC", width: 1440 },
  { name: "Ca Course", initials: "CC", width: 390 },
  { name: "Electricity", initials: "EL", width: 1440 },
  { name: "\u00c9lectricit\u00e9 G\u00e9n\u00e9rale", initials: "\u00c9G", width: 1440 },
  { name: "Data & Society", initials: "DS", width: 1440 },
]) {
  test(`uses consistent colored course initials for ${fixture.name} at ${fixture.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: fixture.width, height: fixture.width < 768 ? 844 : 900 });
    await mockApp(page, true, true, "owner", "teacher", { name: fixture.name });
    await page.goto(`/course/${encodeURIComponent(fixture.name)}`);
    await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
    const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
    if (await collapse.isVisible()) await collapse.click();
    const infoButton = page.getByTestId("chat-header").getByRole("button", { name: fixture.name, exact: true });
    await infoButton.click();
    const infoDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: fixture.name, exact: true }) });
    await expect(infoDialog).toHaveAccessibleName("Course information");
    await expect(infoDialog.getByRole("heading", { name: "Course information", exact: true })).toBeVisible();
    const color = await expectCourseAvatar(infoDialog.getByTestId("course-avatar"), fixture.initials, 80);
    await expect(infoDialog.getByRole("heading", { name: fixture.name, exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
    await infoDialog.screenshot({ path: testInfo.outputPath(`course-info-${fixture.width}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await infoButton.click();
    await expect(infoDialog.getByTestId("course-avatar")).toHaveCSS("color", color);
    await page.keyboard.press("Escape");

    await page.goto("/library");
    const card = page.getByRole("button").filter({ has: page.getByRole("heading", { name: fixture.name, exact: true, level: 3 }) });
    expect(await expectCourseAvatar(card.getByTestId("course-avatar"), fixture.initials, 48)).toBe(color);
    await expect(card.getByRole("heading", { name: fixture.name, exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(card.getByText(`By ${user.displayName}`, { exact: true })).toBeVisible();
    await expect(card.locator(".lucide-user")).toHaveCount(0);
    await card.screenshot({ path: testInfo.outputPath(`course-card-${fixture.width}.png`), animations: "disabled" });
    await card.click();
    const preview = page.getByRole("heading", { name: fixture.name, exact: true, level: 2 }).locator("..");
    await expect(page.getByRole("heading", { name: "Course information", exact: true })).toBeVisible();
    expect(await expectCourseAvatar(preview.getByTestId("course-avatar"), fixture.initials, 96)).toBe(color);
    await expect(preview.getByRole("heading", { name: fixture.name, exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
    await preview.screenshot({ path: testInfo.outputPath(`course-preview-${fixture.width}.png`), animations: "disabled" });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("preserves uploaded course images in Library cards and previews", async ({ page }) => {
  const imageUrl = "/api/test-course-avatar.svg";
  await mockApp(page, true, true, "owner", "teacher", { imageUrl });
  await page.route("**/api/test-course-avatar.svg", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2563eb"/></svg>',
  }));
  await page.goto("/library");
  const card = page.getByRole("button").filter({ has: page.getByRole("heading", { name: courseName, exact: true, level: 3 }) });
  const image = card.getByRole("img", { name: courseName, exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
  await expect(card.getByTestId("course-avatar")).toHaveCount(0);
  await card.click();
  const preview = page.getByRole("heading", { name: courseName, exact: true, level: 2 }).locator("..");
  const previewImage = preview.getByRole("img", { name: courseName, exact: true });
  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveAttribute("src", new URL(imageUrl, page.url()).href);
  await expect(preview.getByTestId("course-avatar")).toHaveCount(0);
  await page.goto(coursePath);
  await page.getByTestId("chat-header").getByRole("button", { name: courseName, exact: true }).click();
  const info = page.getByRole("dialog", { name: "Course information", exact: true });
  await expect(info.getByRole("img", { name: courseName, exact: true })).toHaveAttribute("src", new URL(imageUrl, page.url()).href);
  await expect(info.getByTestId("course-avatar")).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`customizes the course picture from its name at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApp(page);
    await page.goto("/create");
    const picture = page.getByRole("button", { name: "Customize course picture", exact: true });
    const name = page.getByPlaceholder("e.g., Data Structures & Algorithms", { exact: true });
    await expect(picture.getByTestId("course-avatar")).toHaveText("TA");
    await expect(page.getByRole("button", { name: "Upload image", exact: true })).toHaveCount(0);
    await name.fill("Thermodynamics Course");
    await expect(picture.getByTestId("course-avatar")).toHaveText("TC");
    await picture.click();
    const dialog = page.getByRole("dialog", { name: "Customize course picture", exact: true });
    await expect(dialog.getByRole("button", { name: "Upload image", exact: true })).toBeVisible();
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath(`course-picture-upload-dialog-${width}.png`), animations: "disabled" });
    await dialog.getByLabel("Initials", { exact: true }).fill("phy");
    await dialog.getByRole("button", { name: "Rose color", exact: true }).click();
    await expect(dialog.getByTestId("course-avatar")).toHaveText("PHY");
    await dialog.getByRole("button", { name: "Apply changes", exact: true }).click();
    await expect(picture.getByTestId("course-avatar")).toHaveText("PHY");
    await expect(picture.getByTestId("course-avatar")).toHaveCSS("color", "rgb(251, 113, 133)");
    await name.fill("Advanced Physics");
    await expect(picture.getByTestId("course-avatar")).toHaveText("PHY");
    await picture.click();
    await dialog.getByLabel("Initials", { exact: true }).fill("XXXX");
    await expect(dialog.getByRole("alert")).toContainText("up to 3");
    await expect(dialog.getByRole("button", { name: "Apply changes", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(picture.getByTestId("course-avatar")).toHaveText("PHY");
    const image = await picture.screenshot();
    await picture.click();
    const chooserPromise = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "Upload image", exact: true }).click();
    await (await chooserPromise).setFiles({ name: "course.png", mimeType: "image/png", buffer: image });
    await expect(dialog).not.toBeVisible();
    await expect(picture.getByRole("img", { name: "Course picture", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload image", exact: true })).toHaveCount(0);
    await picture.click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(picture.getByRole("img", { name: "Course picture", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Use initials", exact: true }).click();
    await expect(picture.getByTestId("course-avatar")).toHaveText("PHY");
    await picture.click();
    await dialog.getByRole("button", { name: "Reset to automatic", exact: true }).click();
    await dialog.getByRole("button", { name: "Apply changes", exact: true }).click();
    await expect(picture.getByTestId("course-avatar")).toHaveText("AP");
    await picture.click();
    await dialog.getByLabel("Upload course image", { exact: true }).setInputFiles({ name: "not-an-image.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(dialog.getByRole("alert")).toContainText("up to 5 MB");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(picture.getByTestId("course-avatar")).toHaveText("AP");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await picture.screenshot({ path: testInfo.outputPath(`course-picture-${width}.png`) });
  });
}

test("persists the course picture through editing, reload, library and Course Info", async ({ page }) => {
  await mockApp(page, true, true, "owner");
  let avatar: CourseAvatarOptions | null = { initials: "EM", color: "#22d3ee" };
  let imageUrl: string | null = "/api/test-course-picture.svg";
  const updates: Array<{ agentAvatar: CourseAvatarOptions | null; agentImageUrl: string | null }> = [];
  let imageDeletes = 0;
  await page.route("**/api/test-course-picture.svg*", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2563eb"/></svg>',
  }));
  await page.route("**/api/azure/agents/list*", route => route.fulfill({ json: [{
    id: agentId, name: `course-${courseName.replace(/\s+/g, "-")}`,
    created_by_id: user.userId, created_by: user.displayName, agentAvatar: avatar, agentImageUrl: imageUrl,
  }] }));
  await page.route("**/api/agents/setup/**", route => {
    if (route.request().method() === "POST") {
      const update = route.request().postDataJSON();
      avatar = update.agentAvatar;
      imageUrl = update.agentImageUrl;
      updates.push({ agentAvatar: avatar, agentImageUrl: imageUrl });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {
      agentId, agentKind: "course", courseName, courseLevel: "Certificate", courseDuration: "1 Year",
      additionalContext: "An example course.", courseCode: "EM101", prerequisites: ["__none__"],
      agentAvatar: avatar, agentImageUrl: imageUrl, conversationStarters: [
        { title: "Overview", prompt: "Give me an overview of this course." },
        { title: "Practice", prompt: "Give me a practice question." },
      ],
    } });
  });
  await page.route(`**/api/agents/image/${agentId}`, route => {
    expect(route.request().method()).toBe("DELETE");
    imageDeletes += 1;
    return route.fulfill({ json: { ok: true, deleted: 1 } });
  });
  await page.goto(`/edit/${encodeURIComponent(courseName)}`);
  const picture = page.getByRole("button", { name: "Customize course picture", exact: true });
  await expect(picture.getByRole("img", { name: "Course picture", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload image", exact: true })).toHaveCount(0);
  const image = await picture.screenshot();
  await picture.click();
  const editor = page.getByRole("dialog", { name: "Customize course picture", exact: true });
  await expect(editor.getByRole("button", { name: "Upload image", exact: true })).toBeVisible();
  const chooserPromise = page.waitForEvent("filechooser");
  await editor.getByRole("button", { name: "Upload image", exact: true }).click();
  await (await chooserPromise).setFiles({ name: "replacement.png", mimeType: "image/png", buffer: image });
  await expect(editor).not.toBeVisible();
  await expect(picture.getByRole("img", { name: "Course picture", exact: true })).toHaveAttribute("src", /^blob:/);
  await picture.click();
  await editor.getByLabel("Initials", { exact: true }).fill("MC");
  await editor.getByRole("button", { name: "Amber color", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:course|chat)\//);
  expect(updates).toEqual([{ agentAvatar: { initials: "MC", color: "#fbbf24" }, agentImageUrl: null }]);
  expect(imageDeletes).toBe(1);
  await page.goto("/library");
  await page.reload();
  const card = page.getByRole("button").filter({ has: page.getByRole("heading", { name: courseName, exact: true, level: 3 }) });
  await expect(card.getByTestId("course-avatar")).toHaveText("MC");
  await expect(card.getByTestId("course-avatar")).toHaveCSS("color", "rgb(251, 191, 36)");
  await card.click();
  await expect(page.getByRole("heading", { name: courseName, exact: true, level: 2 }).locator("..").getByTestId("course-avatar")).toHaveText("MC");
  await page.goto(coursePath);
  await page.getByTestId("chat-header").getByRole("button", { name: courseName, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Course information", exact: true }).getByTestId("course-avatar")).toHaveText("MC");
  await page.goto(`/edit/${encodeURIComponent(courseName)}`);
  await expect(picture.getByTestId("course-avatar")).toHaveText("MC");
  await picture.click();
  await editor.getByRole("button", { name: "Reset to automatic", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:course|chat)\//);
  expect(updates.at(-1)?.agentAvatar).toBeNull();
  await page.goto("/library");
  await expect(card.getByTestId("course-avatar")).toHaveText("EM");
});

test("course picture defaults and custom Unicode initials remain deterministic", () => {
  expect(resolveCourseAvatar("Thermodynamics Course")).toEqual(resolveCourseAvatar("  Thermodynamics  Course  "));
  expect(resolveCourseAvatar("Thermodynamics Course").initials).toBe("TC");
  expect(resolveCourseAvatar("Electricity").initials).toBe("EL");
  expect(resolveCourseAvatar("").initials).toBe("TA");
  expect(resolveCourseAvatar("Example", { initials: "e\u0301m", color: "#123ABC" })).toEqual({ initials: "\u00c9M", color: "#123ABC" });
  expect(() => resolveCourseAvatar("Example", { initials: "ABCD" })).toThrow();
  expect(() => resolveCourseAvatar("Example", { color: "red" })).toThrow();
});

test("shares the TA code and a working current-origin invite link", async ({ page }, testInfo) => {
  const connections = await mockApp(page);
  await openShareDialog(page);
  await expect(page.getByLabel("TA code", { exact: true })).toHaveValue(code);
  const inviteLink = new URL(`/join/${code}`, page.url()).href;
  await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(inviteLink);
  const dialog = page.getByRole("dialog", { name: "Share TA" });
  const size = await dialog.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
  expect(size.width).toBeLessThanOrEqual(384);
  expect(size.height).toBeLessThanOrEqual(300);
  await page.getByRole("button", { name: "Copy TA code", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await page.getByRole("button", { name: "Copy share link", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteLink);
  await expect(page.getByRole("status")).toHaveText("Share link copied");
  expect(await dialog.evaluate(element => element.clientHeight)).toBe(size.height);
  await page.screenshot({ path: testInfo.outputPath("share-ta-desktop.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Share TA" })).toHaveCount(0);
  await page.goto(inviteLink);
  await expect(page).toHaveURL(/\/(course|chat)\/Electronics%20Mechanic(?:\/.*)?$/);
  expect(connections).toEqual([code]);
});

test("keeps share controls within a narrow viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mockApp(page);
  await openShareDialog(page);
  await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(/\/join\/ABC123$/);
  expect(await page.getByRole("dialog", { name: "Share TA" }).evaluate(element => element.clientHeight)).toBeLessThanOrEqual(340);
  for (const locator of [page.getByRole("dialog", { name: "Share TA" }), page.getByLabel("Share link", { exact: true }), page.getByRole("button", { name: "Copy share link", exact: true })]) {
    const bounds = await locator.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  }
  await page.screenshot({ path: testInfo.outputPath("share-ta-mobile.png") });
});

test("keeps fields selectable when clipboard access is denied", async ({ page }) => {
  await mockApp(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); } },
      configurable: true,
    });
  });
  await openShareDialog(page);
  await page.getByRole("button", { name: "Copy share link", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Clipboard access unavailable.");
  const input = page.getByLabel("Share link", { exact: true });
  await input.focus();
  expect(await input.evaluate(element => {
    const field = element as HTMLInputElement;
    return field.selectionEnd! - field.selectionStart! === field.value.length;
  })).toBe(true);
});

test("retries a failed code request without showing stale share data", async ({ page }) => {
  await mockApp(page);
  let attempts = 0;
  await page.route("**/api/agents/*/manage-code?*", async route => {
    attempts += 1;
    await route.fulfill({
      status: attempts === 1 ? 503 : 200,
      json: attempts === 1 ? { detail: "Unavailable" } : { manage_code: code },
    });
  });
  await openShareDialog(page);
  await expect(page.getByRole("alert")).toHaveText("Could not load share details.");
  await expect(page.getByLabel("Share link", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("TA code", { exact: true })).toHaveValue(code);
  expect(attempts).toBe(2);
});

test("preserves an invite through sign-in and connects once", async ({ page }) => {
  const connections = await mockApp(page, false, false);
  await page.goto("/join/abc123");
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.evaluate(() => sessionStorage.getItem("pendingJoinCode"))).toBe(code);
  expect(connections).toEqual([]);
  await page.evaluate(user => {
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({ version: 1, state: user }));
  }, user);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/(course|chat)\/Electronics%20Mechanic(?:\/.*)?$/);
  expect(connections).toEqual([code]);
  expect(await page.evaluate(() => sessionStorage.getItem("pendingJoinCode"))).toBeNull();
});

test("opens the TA for a first-time recipient with no local course", async ({ page }) => {
  const connections = await mockApp(page, true, false);
  await page.goto(`/join/${code}`);
  await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
  expect(connections).toEqual([code]);
  expect(await page.evaluate(agentId => {
    const stored = JSON.parse(localStorage.getItem("ekalaiva.chat.v1")!);
    return Object.values(stored.state.projects).some(project => (project as { agentId: string }).agentId === agentId);
  }, agentId)).toBe(true);
});

for (const access of ["member", "owner"] as const) {
  test(`opens a shared TA directly for an existing ${access} without a local course`, async ({ page }) => {
    const connections = await mockApp(page, true, false, access);
    await page.goto(`/join/${code}`);
    await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/chat\/Electronics%20Mechanic\/.+$/);
    await expect(page.getByText(`Joined "${courseName}"`, { exact: true })).toHaveCount(0);
    expect(connections).toEqual([code]);
  });
}

test("reopens the same link after joining without another joined notice", async ({ page }) => {
  const connections = await mockApp(page, true, false);
  await page.goto(`/join/${code}`);
  await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
  await expect(page.getByText(`Joined "${courseName}"`, { exact: true })).toBeVisible();
  const projects = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ekalaiva.chat.v1")!).state.projects));

  await page.goto(`/join/${code}`);

  await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
  await expect(page.getByText(`Joined "${courseName}"`, { exact: true })).toHaveCount(0);
  expect(connections).toEqual([code, code]);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ekalaiva.chat.v1")!).state.projects))).toEqual(projects);
});

test("opens an already joined TA after signing back in", async ({ page }) => {
  const connections = await mockApp(page, false, false, "member");
  await page.goto(`/join/${code}`);
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.evaluate(() => sessionStorage.getItem("pendingJoinCode"))).toBe(code);
  expect(connections).toEqual([]);
  await page.evaluate(user => {
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({ version: 1, state: user }));
  }, user);

  await page.goto("/home");

  await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
  await expect(page.getByText(`Joined "${courseName}"`, { exact: true })).toHaveCount(0);
  expect(connections).toEqual([code]);
  expect(await page.evaluate(() => sessionStorage.getItem("pendingJoinCode"))).toBeNull();
});

test("rejects malformed and unavailable invite codes", async ({ page }) => {
  const connections = await mockApp(page);
  await page.goto("/join/not-a-code");
  await expect(page.getByRole("heading", { name: "Invalid invite link" })).toBeVisible();
  expect(connections).toEqual([]);
  await page.goto("/join/ZZZ999");
  await expect(page.getByText("This invite link is no longer valid.")).toBeVisible();
  expect(connections).toEqual(["ZZZ999"]);
});

test("an unassigned student sees the access denial without creating a local course", async ({ page }) => {
  await mockApp(page, true, false, "new", "student");
  const message = "You are not assigned to this teaching assistant. Ask an administrator for access.";
  await page.route("**/api/agents/connect-by-code", route => route.fulfill({
    status: 403, json: { detail: message },
  }));
  await page.goto(`/join/${code}`);
  await expect(page.getByRole("heading", { name: "Could not open TA" })).toBeVisible();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/join/${code}$`));
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ekalaiva.chat.v1")!).state.projects))).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem("pendingJoinCode"))).toBeNull();
});

test("an assigned student opens a shared TA without enrolling again", async ({ page }) => {
  const connections = await mockApp(page, true, false, "member", "student");
  await page.goto(`/join/${code}`);
  await expect(page).toHaveURL(/\/(course|chat)\/Electronics%20Mechanic(?:\/.*)?$/);
  await expect(page.getByText(`Joined "${courseName}"`, { exact: true })).toHaveCount(0);
  expect(connections).toEqual([code]);
});

test("students without assignments are directed to their administrator", async ({ page }) => {
  await mockApp(page, true, false, "member", "student");
  await page.route("**/api/azure/agents/list*", route => route.fulfill({ json: [] }));
  await page.goto("/library");
  await expect(page.getByText("No teaching assistants have been assigned to you yet. Ask your administrator to add you to a TA's student list.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Agent", exact: true })).toHaveCount(0);
});