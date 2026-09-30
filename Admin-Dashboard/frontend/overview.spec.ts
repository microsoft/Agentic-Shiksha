import { expect, test, type Page } from "@playwright/test";

const courseNames = [
  "Image Processing and Computer Vision",
  "Certified Industrial Training: Electrical Machines, Installation and Maintenance",
  "Microcontrollers and Embedded Systems",
  "Thermal and Fluid Systems",
  "Partial Differential Equations",
  "AdvancedElectricalInstallationTroubleshootingAndPreventiveMaintenance",
];

const courses = Array.from({ length: 26 }, (_unused, index) => ({
  agentId: `course-${index + 1}`,
  course: `Example ${index + 1}: ${courseNames[index % courseNames.length]}`,
  institute: "Example Institute",
  department: "Engineering",
  professors: ["Example Teacher"],
  activeUsers: index + 1,
  totalUsers: 30,
  conversations: 2,
  rounds: 4,
  totalTokens: index >= 23 ? 0 : index === 0 ? 40_800_000 : index === 7 ? 8_400_000 : (24 - index) * 11_027,
}));

test("graph-enabled courses label legacy progress unavailable without loading graph data", async ({ page }) => {
  const data = [{ ...courses[0], graph_memory_mode: "authoritative", progress_available: false, progress_source: "unavailable" }];
  const memoryReads: string[] = [];
  page.on("request", request => { if (request.url().includes("/memory/")) memoryReads.push(request.url()); });
  await mockOverview(page, data);
  await page.goto("/overview");
  await expect(page.getByText("Graph Memory (authoritative): legacy progress unavailable. Use the authorized teacher view.")).toBeVisible();
  expect(memoryReads).toEqual([]);
});

async function mockOverview(page: Page, data = courses) {
  await page.route("**/auth/**", route => route.fulfill({
    status: 401,
    json: { detail: "Synthetic session" },
  }));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/overview/courses")) {
      return route.fulfill({ json: { courses: data, uniqueTotalUsers: 30 } });
    }
    if (path.endsWith("/overview/today")) {
      return route.fulfill({ json: {
        activeStudents: 1, tokens: 200, rounds: 2, newConversations: 1,
        startDate: "2026-09-23", endDate: "2026-09-23",
      } });
    }
    if (path.endsWith("/image-quota")) {
      return route.fulfill({ json: {
        limits: { medium: 2, low: 5 }, costPerImageUsd: { medium: 0.03, low: 0.01 },
        estimatedWeeklyUsdPerStudent: 0.11, estimatedMonthlyUsdPerStudent: 0.473,
      } });
    }
    if (path.endsWith("/agents")) return route.fulfill({ json: { agents: [], count: 0 } });
    return route.fulfill({ status: 404, json: { detail: "Unmocked test request" } });
  });
}

async function openCourseUsage(page: Page) {
  await page.goto("/overview");
  if (page.viewportSize()!.width < 640) {
    await page.locator("aside").first().locator("button").first().click();
  }
  const trigger = page.getByRole("button", { name: "View total tokens" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Token Usage by Course" });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "short-screen", width: 1024, height: 600 },
  { name: "mobile", width: 390, height: 844 },
  { name: "narrow-mobile", width: 320, height: 568 },
]) {
  test(`course labels and values fit on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockOverview(page);
    const dialog = await openCourseUsage(page);
    const list = dialog.getByRole("list", { name: "Course token usage" });
    const items = list.getByRole("listitem");
    const [largestTotal, smallestTotal] = await page.evaluate(
      values => values.map(value => value.toLocaleString()),
      [courses[0].totalTokens, courses[22].totalTokens],
    );
    await expect(items).toHaveCount(23);
    await expect(items.first()).toContainText(courses[0].course);
    await expect(items.first()).toContainText(largestTotal);
    await expect(items.nth(1)).toContainText(courses[7].course);
    await expect(items.last()).toContainText(smallestTotal);

    const geometry = await dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll("li")].map(row => {
        const name = row.querySelector("span")!;
        const value = row.querySelector(".text-right")!;
        const rowBounds = row.getBoundingClientRect();
        return {
          top: rowBounds.top, bottom: rowBounds.bottom,
          nameRight: name.getBoundingClientRect().right,
          valueLeft: value.getBoundingClientRect().left,
          nameFits: name.scrollWidth <= name.clientWidth + 1,
        };
      });
      const scroller = element.querySelector("ol")!.parentElement!;
      return {
        left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
        width: window.innerWidth, height: window.innerHeight,
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
        scrollsVertically: scroller.scrollHeight > scroller.clientHeight,
        rows,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(8);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width - 8);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.scrollsVertically).toBe(true);
    for (const [index, row] of geometry.rows.entries()) {
      expect(row.nameFits).toBe(true);
      expect(row.nameRight).toBeLessThanOrEqual(row.valueLeft);
      if (index > 0) expect(row.top).toBeGreaterThanOrEqual(geometry.rows[index - 1].bottom);
    }

    await dialog.screenshot({ path: testInfo.outputPath(`course-usage-${viewport.name}.png`) });
    await items.last().scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("heading", { name: "Token Usage by Course" })).toBeInViewport();
    await expect(dialog.getByRole("searchbox", { name: "Search courses" })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}

test("search keeps totals and shares stable, handles no match, and resets on reopen", async ({ page }) => {
  await mockOverview(page);
  const dialog = await openCourseUsage(page);
  const list = dialog.getByRole("list", { name: "Course token usage" });
  const target = list.getByRole("listitem").filter({ hasText: courses[7].course });
  const share = await target.locator(".bg-purple-400").getAttribute("style");
  const total = await page.evaluate(
    value => value.toLocaleString(),
    courses.reduce((sum, course) => sum + course.totalTokens, 0),
  );
  const search = dialog.getByRole("searchbox", { name: "Search courses" });
  await search.fill("EXAMPLE 8:");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByText("1 of 23 courses", { exact: true })).toBeVisible();
  await expect(dialog.getByText(`${total} tokens total`, { exact: true })).toBeVisible();
  await expect(target.locator(".bg-purple-400")).toHaveAttribute("style", share!);
  await search.fill("no matching course");
  await expect(dialog.getByRole("status")).toHaveText("No matching courses.");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "View total tokens" }).click();
  await expect(search).toHaveValue("");
  await expect(list.getByRole("listitem")).toHaveCount(23);
});

test("zero usage shows an empty state instead of a blank chart", async ({ page }) => {
  await mockOverview(page, courses.map(course => ({ ...course, totalTokens: 0 })));
  const dialog = await openCourseUsage(page);
  await expect(dialog.getByRole("status")).toHaveText("No token usage recorded.");
  await expect(dialog.getByText("0 courses", { exact: true })).toBeVisible();
  await expect(dialog.getByText("0 tokens total", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("list")).toHaveCount(0);
});