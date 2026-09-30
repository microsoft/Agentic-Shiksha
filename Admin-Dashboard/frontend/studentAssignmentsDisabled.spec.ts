import { expect, test } from "@playwright/test";

test("disabled assignments hide manual assignment controls and disable CSV selectors without main API requests", async ({ page }) => {
  const mainApiRequests: string[] = [];
  const invitations: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).port === "4185") mainApiRequests.push(request.url());
    if (new URL(request.url()).pathname === "/api/directory" && request.method() === "POST") invitations.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({
      version: 1,
      state: {
        userId: "admin-user", displayName: "Example Admin", email: "admin@example.com",
        authProvider: "microsoft", role: "admin", isAuthenticated: true,
      },
    }));
  });
  await page.route("**/auth/**", route => route.fulfill({ status: 401, json: { detail: "Synthetic session" } }));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/directory") return route.fulfill({ json: [] });
    if (path === "/api/dashboard/agents") {
      return route.fulfill({ json: { agents: [{
        id: "course-example", name: "Example Course",
        courseAffiliations: [{ institute: "Example Institute", department: "Example Department" }],
      }], count: 1 } });
    }
    if (path.endsWith("/overview")) return route.fulfill({ json: {
      agent_id: "course-example", student_count: 0, avg_pct_complete: 0, total_topics: 0,
      distribution: { "0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0 },
      top_struggle_topics: [], students: [],
      usage: { active_students: 0, active_teachers: 0, total_threads: 0, active_threads: 0 },
    } });
    return route.fulfill({ status: 404, json: { detail: "Unexpected synthetic request" } });
  });
  await page.goto("/user-directory");
  await expect(page.getByRole("heading", { name: "User Directory", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign Students", exact: true })).toHaveCount(0);
  await expect(page.getByText("Checking assignment access")).toHaveCount(0);
  await page.getByRole("button", { name: "Add User", exact: true }).click();
  const newUser = page.getByRole("dialog", { name: "Add New User", exact: true });
  await expect(newUser.getByRole("combobox", { name: "Course / TA", exact: true })).toHaveCount(0);
  const csv = newUser.getByRole("region", { name: "Import from CSV", exact: true });
  for (const name of ["CSV college", "CSV department", "CSV TA"]) {
    await expect(csv.getByRole("combobox", { name, exact: true })).toBeVisible();
    await expect(csv.getByRole("combobox", { name, exact: true })).toBeDisabled();
  }
  await expect(newUser.getByLabel("Import users CSV")).toBeDisabled();
  await expect(newUser.getByText("CSV import requires course assignments to be enabled and an active administrator session.")).toBeVisible();
  expect(invitations).toEqual([]);
  await newUser.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/analytics");
  await page.getByRole("combobox", { name: "Analytics institution", exact: true }).click();
  await page.getByRole("option", { name: "Example Institute", exact: true }).click();
  await page.getByRole("combobox", { name: "Analytics department", exact: true }).click();
  await page.getByRole("option", { name: "Example Department", exact: true }).click();
  await page.getByRole("combobox", { name: "Analytics course", exact: true }).click();
  await page.getByRole("option", { name: "Example Course", exact: true }).click();
  await expect(page.getByRole("button", { name: "Teachers", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign Students", exact: true })).toHaveCount(0);
  expect(mainApiRequests).toEqual([]);
});
