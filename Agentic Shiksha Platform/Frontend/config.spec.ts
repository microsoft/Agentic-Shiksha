import { expect, test, type Page, type Route } from "@playwright/test";
import type { BackendConfig } from "./src/lib/config";

const serverConfig: BackendConfig = {
  default_model: "example-chat-deployment",
  agent_model: "example-agent-deployment",
  allowed_models: ["example-chat-deployment", "example-fast-deployment"],
  version: "test",
};

async function mockConfigApp(page: Page, respond: (route: Route, attempt: number) => Promise<void>) {
  const user = {
    userId: "example-user", displayName: "Example Teacher", email: "user@example.com",
    role: "teacher", authProvider: "microsoft", isAuthenticated: true,
  };
  await page.addInitScript(user => {
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({ version: 1, state: user }));
    localStorage.setItem("ekalaiva.chat.v1", JSON.stringify({ version: 2, state: {
      onboardingCompleted: true, userStatus: "active", userName: "Example",
      projects: {}, threads: {}, messagesByThreadId: {}, activeThreadId: null,
    } }));
  }, user);

  const requests = { config: 0, modelWrites: [] as unknown[] };
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" && request.headers()["content-type"]?.includes("application/json")) {
      const body = request.postDataJSON();
      if (body && Object.hasOwn(body, "model")) requests.modelWrites.push(body.model);
    }
    if (url.pathname === "/api/config") {
      await respond(route, ++requests.config);
    } else if (url.pathname === "/auth/me") {
      await route.fulfill({ json: { id: user.userId, ...user } });
    } else if (url.pathname.startsWith("/api/user/")) {
      await route.fulfill({ json: { success: true, profile: {
        id: user.userId, ...user, fullName: user.displayName, status: "active", onboardingCompleted: true,
      } } });
    } else if (url.pathname === "/api/azure/agents/list") {
      await route.fulfill({ json: [] });
    } else if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ json: {
        success: true, status: "not_available", threads: [], messages: [], files: [],
        assets: [], versions: [], total: 0, hasMore: false, progress: null,
      } });
    } else if (url.hostname === "127.0.0.1") {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  return requests;
}

function readBackendConfig(page: Page): Promise<BackendConfig> {
  return page.evaluate(async () => {
    const path = "/src/lib/config.ts";
    const { fetchBackendConfig } = await import(path);
    return fetchBackendConfig();
  });
}

test("server deployments replace stale model lists and setup waits for validated configuration", async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const requests = await mockConfigApp(page, async route => {
    await ready;
    await route.fulfill({ json: serverConfig });
  });
  await page.goto("/create");
  await expect(page.getByRole("status")).toHaveText("Loading model configuration…");
  await expect(page.getByPlaceholder("e.g., Data Structures & Algorithms")).toHaveCount(0);
  expect(requests.modelWrites).toEqual([]);

  const concurrent = page.evaluate(async () => {
    const path = "/src/lib/config.ts";
    const { fetchBackendConfig } = await import(path);
    return Promise.all([fetchBackendConfig(), fetchBackendConfig()]);
  });
  release();
  expect(await concurrent).toEqual([serverConfig, serverConfig]);
  await expect(page.getByPlaceholder("e.g., Data Structures & Algorithms")).toBeVisible();
  expect(await readBackendConfig(page)).toEqual(serverConfig);
  expect(requests.config).toBe(1);

  await page.getByPlaceholder("e.g., Data Structures & Algorithms").fill("Example course");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).first().click();
  await expect(page.getByPlaceholder("e.g., Data Structures & Algorithms")).toHaveValue("Example course");
  expect(requests.config).toBe(1);
  expect(requests.modelWrites).toEqual([]);
});

for (const failure of ["HTTP", "network", "invalid JSON"] as const) {
  test(`${failure} config failure is explicit and retry recovers without a fallback model`, async ({ page }) => {
    const requests = await mockConfigApp(page, async (route, attempt) => {
      if (attempt > 1) return route.fulfill({ json: serverConfig });
      if (failure === "network") return route.abort("failed");
      if (failure === "invalid JSON") {
        return route.fulfill({ contentType: "application/json", body: "not JSON" });
      }
      return route.fulfill({ status: 503, json: { detail: "Internal configuration details" } });
    });
    await page.goto("/create");
    await expect(page.getByRole("alert")).toContainText("Model configuration unavailable");
    await expect(page.getByPlaceholder("e.g., Data Structures & Algorithms")).toHaveCount(0);
    await expect(page.getByText("Internal configuration details", { exact: true })).toHaveCount(0);
    expect(requests.config).toBe(1);
    expect(requests.modelWrites).toEqual([]);

    await page.getByRole("button", { name: "Retry configuration" }).click();
    await expect(page.getByPlaceholder("e.g., Data Structures & Algorithms")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await readBackendConfig(page)).toEqual(serverConfig);
    expect(requests.config).toBe(2);
    expect(requests.modelWrites).toEqual([]);
  });
}

const invalidConfigs: Array<[string, unknown]> = [
  ["null response", null],
  ["array response", []],
  ["missing fields", {}],
  ["missing agent deployment", { ...serverConfig, agent_model: undefined }],
  ["blank agent deployment", { ...serverConfig, agent_model: " " }],
  ["blank default", { ...serverConfig, default_model: "" }],
  ["missing version", { ...serverConfig, version: undefined }],
  ["non-string version", { ...serverConfig, version: 1 }],
  ["empty allowed list", { ...serverConfig, allowed_models: [] }],
  ["non-array allowed list", { ...serverConfig, allowed_models: serverConfig.default_model }],
  ["invalid allowed entry", { ...serverConfig, allowed_models: [serverConfig.default_model, 1] }],
  ["blank allowed entry", { ...serverConfig, allowed_models: [serverConfig.default_model, " "] }],
  ["unlisted default", { ...serverConfig, default_model: "unlisted-deployment" }],
];

for (const [name, config] of invalidConfigs) {
  test(`rejects ${name} and does not cache it as successful configuration`, async ({ page }) => {
    const requests = await mockConfigApp(page, async (route, attempt) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(attempt === 1 ? config : serverConfig),
      });
    });
    await page.goto("/create");
    await expect(page.getByRole("alert")).toContainText("Model configuration unavailable");
    await expect(page.getByPlaceholder("e.g., Data Structures & Algorithms")).toHaveCount(0);
    expect(requests.modelWrites).toEqual([]);

    await page.getByRole("button", { name: "Retry configuration" }).click();
    await expect(page.getByPlaceholder("e.g., Data Structures & Algorithms")).toBeVisible();
    expect(await readBackendConfig(page)).toEqual(serverConfig);
    expect(requests.config).toBe(2);
  });
}
