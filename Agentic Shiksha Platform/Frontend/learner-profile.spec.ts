import { expect, test, type Locator, type Page } from "@playwright/test";
import type { LearningProgress } from "./src/lib/api";
import type { ApiMessage, ApiThread } from "./src/lib/chatApi";
import { summarizeTopicProgress } from "./src/lib/learningProgress";

const agentId = "course-Example";
const userId = "example-learner";
const originalInstructions = "Use short explanations and everyday examples.";
const updatedInstructions = "Explain step by step.\nAsk me a question before moving on.";
const instructionSuggestions = [
  ["Step by step", "Guide me one step at a time and let me try before moving on."],
  ["Everyday examples", "Use familiar, real-world examples and connect them to the underlying concept."],
  ["Check understanding", "Ask me a short question to check my understanding before introducing the next idea."],
  ["Hints first", "When I am stuck, give me a small hint before showing a full explanation."],
  ["Clear language", "Use clear, simple language and explain unfamiliar terms when you first introduce them."],
] as const;
const recordedProgress: LearningProgress = {
  overall: { total_topics: 40, learned: 26, in_progress: 1, not_started: 13, percent: 64 },
  topics: {
    "Circuit fundamentals": { status: "learned", module: "Fundamentals", latest_summary: "Explained current flow correctly." },
    "Electrical safety": { status: "learned", module: "Fundamentals" },
    "Fault diagnosis": {
      status: "in_progress", module: "Applications", last_touched: "2026-09-28T12:00:00Z",
      latest_summary: "Needs to distinguish cause from symptom.",
    },
    "Motor control": { status: "not_started", module: "Applications" },
  },
  threshold_concepts: {
    "Current and potential": {
      status: "learned", misconceptions_addressed: ["Voltage is consumed"],
      misconception_notes: { "Voltage is consumed": { note: "Distinguished voltage from current." } },
    },
    "Fault isolation": { status: "in_progress", latest_summary: "Needs to distinguish cause from symptom." },
  },
  objectives: { "Use correct units": { status: "learned", evidence: "Used units consistently." } },
};

type ChatRequest = {
  inject_profile?: boolean;
  user_profile?: { customInstructions?: string };
};

async function mockLearnerApp(page: Page, role: "student" | "teacher" = "student") {
  const account = {
    userId, displayName: "Example Learner", email: "user@example.com",
    role, authProvider: "microsoft", isAuthenticated: true,
  };
  const state = {
    instructions: originalInstructions,
    profileStatus: 200,
    progressStatus: 200,
    saveStatus: 200,
    invalidSave: false,
    wrongAcknowledgement: false,
    missingAcknowledgementTime: false,
    saveBarrier: null as Promise<void> | null,
    chatBarrier: null as Promise<void> | null,
    preferences: ["Worked examples"],
    learningOverride: undefined as unknown,
    learningReads: [] as { userId: string; agentId: string }[],
    writes: [] as Record<string, unknown>[],
    chatRequests: [] as ChatRequest[],
    progress: structuredClone(recordedProgress) as LearningProgress | null,
    progressReads: [] as string[],
    account,
  };
  const threads = new Map<string, ApiThread>();
  const messages = new Map<string, ApiMessage>();
  await page.addInitScript(({ account, agentId, originalInstructions }) => {
    if (sessionStorage.getItem("learner-profile-test-seeded")) return;
    sessionStorage.setItem("learner-profile-test-seeded", "true");
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({ version: 1, state: account }));
    localStorage.setItem("ekalaiva.chat.v1", JSON.stringify({ version: 2, state: {
      onboardingCompleted: true, userStatus: "active", userName: "Example Learner",
      userCustomInstructions: originalInstructions,
      projects: {
        example: { id: "example", name: "Example", agentId, agentName: agentId, createdAt: 1, updatedAt: 1 },
        second: { id: "second", name: "Second", agentId: "course-Second", agentName: "course-Second", createdAt: 1, updatedAt: 1 },
      },
      threads: {}, messagesByThreadId: {}, activeThreadId: null,
    } }));
  }, { account, agentId, originalInstructions });

  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const progressMatch = path.match(/^\/api\/agents\/([^/]+)\/progress\/([^/]+)$/);
    const learningMatch = path.match(/^\/api\/learner-profile\/learning\/([^/]+)$/);
    if (path === "/api/learner-profile") {
      if (request.method() === "PUT") {
        const savedUserId = account.userId;
        const payload: Record<string, unknown> = request.postDataJSON();
        state.writes.push(payload);
        if (state.saveBarrier) await state.saveBarrier;
        if (state.saveStatus !== 200) {
          await route.fulfill({ status: state.saveStatus, json: { detail: "Unable to save learner profile." } });
        } else if (state.invalidSave) {
          await route.fulfill({ json: { success: false } });
        } else if (typeof payload.customInstructions === "string") {
          if (savedUserId === account.userId && !state.wrongAcknowledgement && !state.missingAcknowledgementTime) {
            state.instructions = payload.customInstructions;
          }
          await route.fulfill({ json: {
            customInstructions: state.wrongAcknowledgement ? "Unconfirmed server value" : payload.customInstructions,
            updatedAt: state.missingAcknowledgementTime ? null : "2026-09-29T12:00:00Z",
          } });
        } else {
          await route.fulfill({ status: 422, json: { detail: "Instructions must be a string." } });
        }
      } else {
        await route.fulfill({ status: state.profileStatus, json: state.profileStatus === 200
          ? { customInstructions: state.instructions, updatedAt: null }
          : { detail: "Unable to load learner profile." } });
      }
    } else if (learningMatch) {
      const requestedAgent = decodeURIComponent(learningMatch[1]);
      state.learningReads.push({ userId: account.userId, agentId: requestedAgent });
      await route.fulfill({ status: state.progressStatus, json: state.progressStatus !== 200
        ? { detail: "Unable to load learning data." }
        : state.learningOverride !== undefined ? state.learningOverride : {
          user_id: account.userId, agent_id: requestedAgent, status: state.progress ? "ok" : "no_state",
          learning_preferences: state.preferences,
          progress: state.progress ? {
            topics: state.progress.topics ?? null,
            threshold_concepts: state.progress.threshold_concepts ?? null,
            objectives: state.progress.objectives ?? null,
          } : null,
        } });
    } else if (progressMatch) {
      state.progressReads.push(decodeURIComponent(progressMatch[1]));
      await route.fulfill({ status: state.progressStatus, json: state.progressStatus === 200
        ? {
          agent_name: decodeURIComponent(progressMatch[1]), user_id: decodeURIComponent(progressMatch[2]),
          status: state.progress ? "ok" : "no_state", progress: state.progress,
        }
        : { detail: "Unable to load learning progress." } });
    } else if (/\/chat\/(stream|agui)$/.test(path)) {
      state.chatRequests.push(request.postDataJSON());
      if (state.chatBarrier) await state.chatBarrier;
      const reply = `Profile test reply ${state.chatRequests.length}`;
      const events = path.endsWith("/agui") ? [
        { type: "RUN_STARTED", threadId: "profile-thread", runId: "profile-run" },
        { type: "TEXT_MESSAGE_START", messageId: `message-${state.chatRequests.length}`, role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: `message-${state.chatRequests.length}`, delta: reply },
        { type: "TEXT_MESSAGE_END", messageId: `message-${state.chatRequests.length}` },
        { type: "RUN_FINISHED", threadId: "profile-thread", runId: "profile-run" },
      ] : [
        { type: "thread_id", thread_id: "profile-thread" },
        { type: "delta", content: reply },
        { type: "done", thread_id: "profile-thread" },
      ];
      await route.fulfill({ contentType: "text/event-stream", body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") });
    } else if (path === "/api/chat/sync") {
      const batch: { threads: ApiThread[]; messages: ApiMessage[] } = request.postDataJSON();
      for (const thread of batch.threads) threads.set(thread.id, thread);
      for (const message of batch.messages) messages.set(message.id, message);
      await route.fulfill({ json: { success: true, threadsUpserted: batch.threads.length, messagesUpserted: batch.messages.length } });
    } else if (path.startsWith("/api/chat/load/")) {
      await route.fulfill({ json: { threads: [...threads.values()], messages: [...messages.values()] } });
    } else if (path.endsWith("/messages")) {
      await route.fulfill({ json: { messages: [...messages.values()], total: messages.size, hasMore: false } });
    } else if (path === "/auth/me") {
      await route.fulfill({ json: { id: account.userId, ...account } });
    } else if (path.startsWith("/api/user/")) {
      await route.fulfill({ json: { success: true, profile: {
        id: account.userId, ...account, fullName: account.displayName, onboardingCompleted: true,
        status: "active", customInstructions: state.instructions,
      } } });
    } else if (path === "/api/azure/agents/list") {
      await route.fulfill({ json: [agentId, "course-Second"].map(id => ({
        id, name: id, createdById: userId, model: "gpt-4.1",
      })) });
    } else if (path === "/api/config") {
      await route.fulfill({ json: { default_model: "gpt-4.1", agent_model: "gpt-4.1", allowed_models: ["gpt-4.1"], version: "test" } });
    } else if (path.startsWith("/api/agents/setup/")) {
      await route.fulfill({ json: { courseName: path.includes("Second") ? "Second" : "Example", createdById: userId, conversationStarters: [] } });
    } else if (path.startsWith("/api/")) {
      await route.fulfill({ json: {
        success: true, status: "not_available", threads: [...threads.values()], messages: [], assets: [],
        versions: [], starters: [], total: 0, hasMore: false,
      } });
    } else if (url.hostname === "127.0.0.1") {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  await page.goto("/course/Example");
  await expect(page.getByRole("button", { name: "TA actions", exact: true })).toBeVisible();
  return state;
}

async function openProfile(page: Page, tab: "Overview" | "Learning" | "Memory" = "Learning") {
  await page.getByRole("button", { name: "TA actions", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Learner profile/ }).click();
  const dialog = page.getByRole("dialog", { name: "Learner profile", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
  if (tab !== "Overview") await dialog.getByRole("tab", { name: tab, exact: true }).click();
  return dialog;
}

async function cachedInstructions(page: Page) {
  return page.evaluate(async () => {
    const modulePath = "/src/lib/chatStore.ts";
    return (await import(modulePath)).useChatStore.getState().userCustomInstructions;
  });
}

async function sendMessage(page: Page, number: number) {
  await page.getByRole("textbox", { name: "Ask anything about the course..." }).fill(`Explain topic ${number}.`);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(`Profile test reply ${number}`, { exact: true }).last()).toBeVisible();
}

async function expectNeutralProfile(dialog: Locator) {
  const coloredElements = await dialog.evaluate(element => {
    const properties = ["color", "backgroundColor", "borderTopColor", "boxShadow"] as const;
    return [element, ...element.querySelectorAll("*")].flatMap(node => {
      if (!node.getClientRects().length) return [];
      const style = getComputedStyle(node);
      return properties.flatMap(property =>
        [...style[property].matchAll(/rgba?\(([^)]+)\)/g)].flatMap(([, value]) => {
          const [red, green, blue, alpha = 1] = value.trim().split(/[,\s/]+/).map(Number);
          // Shared inputs use zinc grays rather than perfectly equal RGB channels.
          return alpha !== 0 && Math.max(red, green, blue) - Math.min(red, green, blue) > 12
            ? [`${node.tagName} ${property}: ${value}`] : [];
        }),
      );
    });
  });
  expect(coloredElements).toEqual([]);
}

for (const width of [1440, 390]) {
  test(`TA action icons share the same muted color at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockLearnerApp(page, "teacher");
    await page.route("**/api/agents/*/course-curriculum**", route => route.fulfill({
      json: { agent_name: agentId, status: "ready", course_curriculum: null, can_retry: false },
    }));
    await page.getByRole("button", { name: "TA actions", exact: true }).click();

    const curriculum = page.getByRole("menuitem", { name: /^Course Curriculum/ });
    const profile = page.getByRole("menuitem", { name: /^Learner profile/ });
    const share = page.getByRole("menuitem", { name: /^Share TA/ });
    const edit = page.getByRole("menuitem", { name: /^Edit TA/ });
    await expect(curriculum).toContainText("Syllabus & threshold concepts");
    await expect(curriculum).toHaveCSS("opacity", "1");
    const sharedIconColor = await share.locator("svg").evaluate(icon => getComputedStyle(icon).color);
    await expect(curriculum.locator("svg")).toHaveCSS("color", sharedIconColor);
    await expect(edit.locator("svg")).toHaveCSS("color", sharedIconColor);
    await expect(profile.locator("svg")).toHaveCSS("color", sharedIconColor);
  });
}

for (const role of ["student", "teacher"] as const) {
  for (const width of [1440, 390]) {
    test(`${role} sees data-backed Overview, Learning and Memory at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const state = await mockLearnerApp(page, role);
      const dialog = await openProfile(page, "Overview");
      await expect(dialog.getByRole("tab")).toHaveText(["Overview", "Learning", "Memory"]);
      for (const heading of ["Progress", "Topics covered", "Next recommended"]) {
        await expect(dialog.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }
      await expect(dialog.getByText("2 of 4 topics completed", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
      await expect(dialog.getByText("1 in progress", { exact: true })).toBeVisible();
      await expect(dialog.getByText("1 not started", { exact: true })).toBeVisible();
      await expect(dialog.getByText("1 of 2 threshold concepts crossed")).toBeVisible();
      const covered = dialog.getByRole("region", { name: "Topics covered", exact: true });
      await expect(covered.getByRole("listitem").locator("p:first-child")).toHaveText([
        "Circuit fundamentals", "Electrical safety", "Fault diagnosis",
      ]);
      await expect(covered.getByText("Learned", { exact: true })).toHaveCount(2);
      await expect(covered.getByText("In progress", { exact: true })).toHaveCount(1);
      await expect(dialog.getByRole("button", { name: "Practice Fault diagnosis", exact: true })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Learning goal", exact: true })).toHaveCount(0);
      await expect(dialog.getByText("Example Learner", { exact: true })).toHaveCount(0);
      await expect(dialog.getByText("Example · Private to you", { exact: true })).toHaveCount(0);
      await expect(dialog.getByText("64%", { exact: true })).toHaveCount(0);
      await expect(dialog.locator("svg.lucide-user-round")).toHaveCount(0);
      await expect(dialog.getByRole("progressbar").locator("div")).toHaveCSS("background-color", "rgb(212, 212, 212)");
      await expectNeutralProfile(dialog);
      await dialog.screenshot({ path: testInfo.outputPath(`learner-profile-overview-${role}-${width}.png`), animations: "disabled" });
      const refresh = dialog.getByRole("button", { name: "Refresh progress", exact: true });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await expect(refresh).toBeVisible();
      await expect(refresh).toHaveText("Refresh");
      await expect(refresh.locator("svg")).toHaveCount(0);
      await expect(close).toBeVisible();
      const refreshBounds = (await refresh.boundingBox())!;
      const closeBounds = (await close.boundingBox())!;
      expect(Math.abs(refreshBounds.y - closeBounds.y)).toBeLessThanOrEqual(1);
      expect(refreshBounds.height).toBe(closeBounds.height);
      const actionGap = closeBounds.x - (refreshBounds.x + refreshBounds.width);
      expect(actionGap).toBeGreaterThanOrEqual(4);
      expect(actionGap).toBeLessThanOrEqual(12);
      const readsBeforeRefresh = state.learningReads.length;
      await refresh.click();
      await expect.poll(() => state.learningReads.length).toBeGreaterThan(readsBeforeRefresh);
      await expect(refresh).toBeEnabled();
      await expect(refresh).toHaveAttribute("aria-busy", "false");
      await dialog.getByRole("tab", { name: "Learning", exact: true }).click();
      for (const heading of ["Strengths", "Focus areas", "Learning preferences", "Custom instructions"]) {
        await expect(dialog.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }
      await expect(dialog.getByRole("region", { name: "Strengths", exact: true }).getByRole("listitem")).toHaveText(["Circuit fundamentals", "Electrical safety"]);
      await expect(dialog.getByRole("region", { name: "Focus areas", exact: true }).getByRole("listitem")).toHaveText(["Fault diagnosis", "Fault isolation"]);
      await expect(dialog.getByRole("region", { name: "Learning preferences", exact: true }).getByRole("listitem")).toHaveText(["Worked examples"]);
      await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(originalInstructions);
      await expectNeutralProfile(dialog);
      await dialog.screenshot({ path: testInfo.outputPath(`learner-profile-learning-${role}-${width}.png`), animations: "disabled" });
      await dialog.getByRole("tab", { name: "Memory", exact: true }).click();
      await expect(dialog.getByRole("group", { name: "Active misconceptions", exact: true })).toHaveText(/Unavailable/);
      await expect(dialog.getByRole("group", { name: "Concepts developing", exact: true }).locator("dd")).toHaveText("1");
      await expect(dialog.getByRole("group", { name: "Threshold concepts crossed", exact: true }).locator("dd")).toHaveText("1");
      await expect(dialog.getByRole("group", { name: "Evidence observations", exact: true }).locator("dd")).toHaveText("4");
      await dialog.getByRole("button", { name: "View learning memory", exact: true }).click();
      const memory = dialog.getByRole("region", { name: "Recorded learning memory", exact: true });
      await expect(memory).toBeFocused();
      await expect(memory.getByText("Used units consistently.", { exact: true })).toBeVisible();
      await expect(memory.getByText("Distinguished voltage from current.", { exact: true })).toBeVisible();
      await memory.locator("summary").filter({ hasText: /^Topics/ }).click();
      await expect(memory.getByText("Explained current flow correctly.", { exact: true }).first()).toBeVisible();
      await expect(dialog.getByText("Learned", { exact: true })).toHaveCount(2);
      await memory.locator("summary").filter({ hasText: /^Threshold concepts/ }).click();
      await expect(dialog.getByText("Crossed", { exact: true })).toBeVisible();
      await expect(memory.getByText("Voltage is consumed", { exact: true })).toBeVisible();
      await expectNeutralProfile(dialog);
      await dialog.screenshot({ path: testInfo.outputPath(`learner-profile-memory-${role}-${width}.png`), animations: "disabled" });
      await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
    });
  }
}

for (const width of [1440, 390]) {
  test(`learner profile uses neutral focus and clear save states at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockLearnerApp(page);
    const dialog = await openProfile(page, "Overview");
    const overview = dialog.getByRole("tab", { name: "Overview", exact: true });
    await overview.focus();
    await expect(overview).toBeFocused();
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => overview.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe("none");
    await expectNeutralProfile(dialog);
    const save = dialog.getByRole("button", { name: "Save instructions", exact: true });
    await expect(save).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: "Learning", exact: true })).toBeFocused();
    await expect(save).toBeDisabled();
    await expect(save).toHaveCSS("background-color", "rgb(38, 38, 38)");
    const instructions = dialog.getByRole("textbox", { name: "Default instructions", exact: true });
    await instructions.fill(updatedInstructions);
    await expect(instructions).toBeFocused();
    await expect(save).toBeEnabled();
    await expect(save).toHaveCSS("background-color", "rgb(229, 229, 229)");
    await expect(save).toHaveCSS("color", "rgb(10, 10, 10)");
    await expectNeutralProfile(dialog);
    await dialog.screenshot({ path: testInfo.outputPath(`learner-profile-editing-${width}.png`), animations: "disabled" });
    await save.click();
    await expect(save).toBeDisabled();
    await expect(save).toHaveCSS("background-color", "rgb(38, 38, 38)");
    expect(await cachedInstructions(page)).toBe(updatedInstructions);
  });
}

test("waits for durable save, preserves it on reload and shares instructions across courses", async ({ page }) => {
  const state = await mockLearnerApp(page);
  let release!: () => void;
  state.saveBarrier = new Promise<void>(resolve => { release = resolve; });
  let dialog = await openProfile(page);
  await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill(updatedInstructions);
  await dialog.getByRole("button", { name: "Save instructions", exact: true }).click();
  try {
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0]).toEqual({ customInstructions: updatedInstructions });
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
    for (const [label] of instructionSuggestions) {
      await expect(dialog.getByRole("button", { name: label, exact: true })).toBeDisabled();
    }
    expect(await cachedInstructions(page)).toBe(originalInstructions);
  } finally {
    release();
  }
  await expect.poll(() => cachedInstructions(page)).toBe(updatedInstructions);
  await expect(dialog.getByRole("button", { name: "Save instructions", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  dialog = await openProfile(page);
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(updatedInstructions);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  state.progress = {
    topics: { "Different topic": { status: "not_started" }, "Another topic": { status: "not_started" } },
    threshold_concepts: {}, objectives: {},
  };
  await page.goto("/course/Second");
  dialog = await openProfile(page);
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(updatedInstructions);
  await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(dialog.getByText("0 of 2 topics completed", { exact: true })).toBeVisible();
  await expect(dialog.getByText("2 of 4 topics completed", { exact: true })).toHaveCount(0);
  expect(state.learningReads.at(-1)).toEqual({ agentId: "course-Second", userId });
});

test("reinjects changed and cleared instructions into an existing conversation", async ({ page }) => {
  const state = await mockLearnerApp(page);
  await sendMessage(page, 1);
  expect(state.chatRequests[0]).toMatchObject({ inject_profile: true, user_profile: { customInstructions: originalInstructions } });
  for (const [index, instructions] of [updatedInstructions, ""].entries()) {
    const dialog = await openProfile(page);
    await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill(instructions);
    await dialog.getByRole("button", { name: "Save instructions", exact: true }).click();
    await expect.poll(() => cachedInstructions(page)).toBe(instructions);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await sendMessage(page, index + 2);
    expect(state.chatRequests[index + 1]).toMatchObject({ inject_profile: true, user_profile: { customInstructions: instructions } });
  }
  await page.reload();
  const dialog = await openProfile(page);
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue("");
});

for (const failure of ["http", "malformed", "wrong-value", "missing-time"] as const) {
  test(`failed ${failure} saves keep the draft without updating active instructions`, async ({ page }) => {
    const state = await mockLearnerApp(page);
    state.saveStatus = failure === "http" ? 500 : 200;
    state.invalidSave = failure === "malformed";
    state.wrongAcknowledgement = failure === "wrong-value";
    state.missingAcknowledgementTime = failure === "missing-time";
    const dialog = await openProfile(page);
    await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill(updatedInstructions);
    await dialog.getByRole("button", { name: "Save instructions", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Could not save your instructions");
    expect(await cachedInstructions(page)).toBe(originalInstructions);
    await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(updatedInstructions);
    state.saveStatus = 200;
    state.invalidSave = false;
    state.wrongAcknowledgement = false;
    state.missingAcknowledgementTime = false;
    await dialog.getByRole("button", { name: "Save instructions", exact: true }).click();
    await expect.poll(() => cachedInstructions(page)).toBe(updatedInstructions);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  });
}

test("instruction and progress failures have independent retries, not fake zero progress", async ({ page }) => {
  const state = await mockLearnerApp(page);
  state.profileStatus = 503;
  const dialog = await openProfile(page);
  await expect(dialog.getByRole("alert")).toContainText("Could not load your instructions");
  await expect(dialog.getByRole("button", { name: "Save instructions", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("group", { name: "Suggested default instructions" })).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await dialog.getByRole("tab", { name: "Learning", exact: true }).click();
  state.profileStatus = 200;
  await dialog.getByRole("button", { name: "Retry instructions", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(originalInstructions);
  await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill(updatedInstructions);
  state.progressStatus = 503;
  await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
  await dialog.getByRole("button", { name: "Refresh progress", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not load your learning data");
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await expect(dialog.getByText(/No progress recorded yet/)).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Memory", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not load your learning data");
  await expect(dialog.getByRole("group", { name: "Evidence observations", exact: true })).toHaveCount(0);
  state.progressStatus = 200;
  state.progress!.topics!["Fault diagnosis"].status = "learned";
  await dialog.getByRole("button", { name: "Retry learning data", exact: true }).click();
  await expect(dialog.getByRole("group", { name: "Evidence observations", exact: true }).locator("dd")).toHaveText("4");
  await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  await dialog.getByRole("tab", { name: "Learning", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(updatedInstructions);
});

test("a new learner sees an honest empty state", async ({ page }) => {
  const state = await mockLearnerApp(page);
  state.progress = null;
  state.instructions = "";
  state.preferences = [];
  const dialog = await openProfile(page, "Overview");
  await expect(dialog.getByText(/No progress recorded yet/)).toBeVisible();
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Practice / })).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Learning", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue("");
  await expect(dialog.getByText("No strengths recorded yet.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No learning preferences saved.", { exact: true })).toBeVisible();
  await dialog.getByRole("tab", { name: "Memory", exact: true }).click();
  await expect(dialog.locator("dd")).toHaveText(["Unavailable", "Unavailable", "Unavailable", "Unavailable"]);
  await dialog.getByRole("button", { name: "View learning memory", exact: true }).click();
  await expect(dialog.getByText("No learning memory recorded for this TA yet.", { exact: true })).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`default instruction suggestions are editable, opt-in and clearable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await mockLearnerApp(page);
    state.instructions = "";
    state.preferences = [];
    let dialog = await openProfile(page);
    const suggestions = dialog.getByRole("group", { name: "Suggested default instructions" });
    const instructions = dialog.getByRole("textbox", { name: "Default instructions", exact: true });
    await expect(instructions).toHaveValue("");
    await expect(suggestions.getByRole("button")).toHaveText(instructionSuggestions.map(([label]) => label));
    await expect(dialog.getByRole("button", { name: "Save instructions", exact: true })).toBeDisabled();

    const selected: string[] = [];
    for (const [label, text] of instructionSuggestions) {
      const suggestion = suggestions.getByRole("button", { name: label, exact: true });
      await suggestion.click();
      selected.push(text);
      await expect(instructions).toHaveValue(selected.join("\n"));
      await expect(suggestion).toBeDisabled();
    }
    expect(state.writes).toHaveLength(0);
    expect(await cachedInstructions(page)).toBe("");
    await expect(dialog.getByText("No learning preferences saved.", { exact: true })).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await suggestions.scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: testInfo.outputPath(`learner-instruction-defaults-${width}.png`), animations: "disabled" });

    const edited = `${selected.join("\n")}\nKeep explanations concise.`;
    await instructions.fill(edited);
    await dialog.getByRole("button", { name: "Save instructions", exact: true }).click();
    await expect.poll(() => cachedInstructions(page)).toBe(edited);
    expect(state.writes).toEqual([{ customInstructions: edited }]);
    await page.reload();
    dialog = await openProfile(page);
    await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(edited);

    await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill("");
    await dialog.getByRole("button", { name: "Save instructions", exact: true }).click();
    await expect.poll(() => cachedInstructions(page)).toBe("");
    await page.reload();
    dialog = await openProfile(page);
    await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue("");
    for (const [label] of instructionSuggestions) {
      await expect(dialog.getByRole("button", { name: label, exact: true })).toBeEnabled();
    }
  });
}

test("instruction suggestions append without overwriting saved text and can be discarded", async ({ page }) => {
  const state = await mockLearnerApp(page);
  let dialog = await openProfile(page);
  const [label, text] = instructionSuggestions[0];
  const suggestion = dialog.getByRole("button", { name: label, exact: true });
  await suggestion.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(`${originalInstructions}\n${text}`);
  expect(await cachedInstructions(page)).toBe(originalInstructions);
  expect(state.writes).toHaveLength(0);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Discard unsaved instructions?" })
    .getByRole("button", { name: "Discard changes", exact: true }).click();
  dialog = await openProfile(page);
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(originalInstructions);
  await expect(dialog.getByRole("button", { name: label, exact: true })).toBeEnabled();
  expect(state.writes).toHaveLength(0);
});

test("closing protects unsaved edits and discarding leaves saved instructions unchanged", async ({ page }) => {
  const state = await mockLearnerApp(page);
  let dialog = await openProfile(page);
  await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill(updatedInstructions);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Discard unsaved instructions?" });
  await confirmation.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(updatedInstructions);
  await page.keyboard.press("Escape");
  await confirmation.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  expect(await cachedInstructions(page)).toBe(originalInstructions);
  dialog = await openProfile(page);
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(originalInstructions);
});

test("an old account's delayed profile response cannot replace the current learner", async ({ page }) => {
  const state = await mockLearnerApp(page);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let held = 0;
  let delivered = 0;
  await page.route("**/api/learner-profile", async route => {
    if (state.account.userId !== userId) return route.fallback();
    held += 1;
    await barrier;
    await route.fulfill({ json: { customInstructions: originalInstructions, updatedAt: null } });
    delivered += 1;
  });
  const dialog = await openProfile(page);
  await expect(dialog.getByText("Loading your instructions...", { exact: true })).toBeVisible();
  state.account.userId = "second-learner";
  state.account.displayName = "Second Learner";
  state.instructions = "Use diagrams for this learner.";
  await page.evaluate(async () => {
    const userModule = "/src/lib/userStore.ts";
    const chatModule = "/src/lib/chatStore.ts";
    const { useUserStore } = await import(userModule);
    const { useChatStore } = await import(chatModule);
    useUserStore.setState({ userId: "second-learner", displayName: "Second Learner" });
    useChatStore.setState({ userName: "Second Learner", userCustomInstructions: "" });
  });
  try {
    await dialog.getByRole("tab", { name: "Learning", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(state.instructions);
  } finally {
    release();
  }
  await expect.poll(() => delivered).toBe(held);
  expect(await cachedInstructions(page)).toBe(state.instructions);
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(state.instructions);
});

test("keyboard tabs preserve draft instructions and do not apply them before saving", async ({ page }) => {
  const state = await mockLearnerApp(page);
  const dialog = await openProfile(page, "Overview");
  await dialog.getByRole("tab", { name: "Overview", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Learning", exact: true })).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill(updatedInstructions);
  await dialog.getByRole("tab", { name: "Learning", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Memory", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("button", { name: "Practice Fault diagnosis", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(dialog.getByRole("tab", { name: "Memory", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("tab", { name: "Memory", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(dialog.getByRole("tab", { name: "Overview", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Learning", exact: true })).toBeFocused();
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(updatedInstructions);
  expect(state.writes).toHaveLength(0);
  expect(await cachedInstructions(page)).toBe(originalInstructions);
  await dialog.getByRole("tab", { name: "Memory", exact: true }).click();
  await dialog.getByRole("button", { name: "Save instructions", exact: true }).click();
  await expect.poll(() => cachedInstructions(page)).toBe(updatedInstructions);
  await expect(dialog.getByRole("tab", { name: "Memory", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("practice opens a real in-progress topic as a draft without sending it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = await mockLearnerApp(page);
  state.progress!.topics!["Control loops"] = { status: "in_progress", last_touched: "2026-09-29T12:00:00Z" };
  const dialog = await openProfile(page, "Overview");
  await expect(dialog.getByRole("region", { name: "Topics covered", exact: true }).getByRole("listitem").locator("p:first-child")).toHaveText([
    "Circuit fundamentals", "Electrical safety", "Control loops", "Fault diagnosis",
  ]);
  await dialog.getByRole("button", { name: "Practice Control loops", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Ask anything about the course..." })).toHaveValue('Help me practice "Control loops".');
  expect(state.chatRequests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("percentages are rounded from actual topic statuses and not stored aggregate values", async ({ page }) => {
  const state = await mockLearnerApp(page);
  delete state.progress!.topics!["Motor control"];
  const dialog = await openProfile(page, "Overview");
  await expect(dialog.getByText("2 of 3 topics completed", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
  await expect(dialog.getByText("64%", { exact: true })).toHaveCount(0);
});

for (const malformed of ["user", "course", "missing-progress", "status", "false-empty", "preferences"] as const) {
  test(`rejects ${malformed} learning responses without showing another scope or fake progress`, async ({ page }) => {
    const state = await mockLearnerApp(page);
    const snapshot = {
      user_id: userId, agent_id: agentId, status: "ok",
      progress: {
        topics: recordedProgress.topics,
        threshold_concepts: recordedProgress.threshold_concepts,
        objectives: recordedProgress.objectives,
      } as unknown,
      learning_preferences: ["Worked examples"] as unknown,
    };
    if (malformed === "user") snapshot.user_id = "another-learner";
    if (malformed === "course") snapshot.agent_id = "course-Other";
    if (malformed === "missing-progress") snapshot.progress = null;
    if (malformed === "status") snapshot.progress = { topics: { "Invented mastery": { status: "mastered" } } };
    if (malformed === "false-empty") snapshot.status = "no_state";
    if (malformed === "preferences") snapshot.learning_preferences = [123];
    state.learningOverride = snapshot;
    const dialog = await openProfile(page, "Overview");
    await expect(dialog.getByRole("alert")).toContainText("Could not load your learning data");
    await expect(dialog.getByRole("progressbar")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^Practice / })).toHaveCount(0);
    await expect(dialog.getByText("Circuit fundamentals", { exact: true })).toHaveCount(0);
    state.learningOverride = undefined;
    await dialog.getByRole("button", { name: "Retry learning data", exact: true }).click();
    await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });
}

test("missing memory collections are unavailable while explicit empty collections have zero counts", async ({ page }) => {
  const state = await mockLearnerApp(page);
  state.progress = {};
  const dialog = await openProfile(page, "Memory");
  await expect(dialog.locator("dd")).toHaveText(["Unavailable", "Unavailable", "Unavailable", "Unavailable"]);
  state.progress = { topics: { "Known topic": { status: "learned", latest_summary: "A real partial observation." } } };
  await dialog.getByRole("button", { name: "Refresh progress", exact: true }).click();
  await expect(dialog.locator("dd")).toHaveText(["Unavailable", "Unavailable", "Unavailable", "Unavailable"]);
  await dialog.getByRole("button", { name: "View learning memory", exact: true }).click();
  await expect(dialog.getByText("A real partial observation.", { exact: true }).last()).toBeVisible();
  state.progress = { topics: {}, threshold_concepts: {}, objectives: {} };
  await dialog.getByRole("button", { name: "Refresh progress", exact: true }).click();
  await expect(dialog.locator("dd")).toHaveText(["Unavailable", "0", "0", "0"]);
  await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Practice / })).toHaveCount(0);
});

test("closing a dialog cancels its pending read without changing confirmed instructions", async ({ page }) => {
  await mockLearnerApp(page);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let delivered = false;
  await page.route("**/api/learner-profile", async route => {
    await barrier;
    await route.fulfill({ json: { customInstructions: updatedInstructions, updatedAt: null } });
    delivered = true;
  });
  const dialog = await openProfile(page);
  await expect(dialog.getByText("Loading your instructions...", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  release();
  await expect.poll(() => delivered).toBe(true);
  await expect(dialog).toHaveCount(0);
  expect(await cachedInstructions(page)).toBe(originalInstructions);
});

test("a delayed save cannot overwrite instructions after an account switch", async ({ page }) => {
  const state = await mockLearnerApp(page);
  let release!: () => void;
  state.saveBarrier = new Promise<void>(resolve => { release = resolve; });
  const dialog = await openProfile(page);
  await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill(updatedInstructions);
  await dialog.getByRole("button", { name: "Save instructions", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  state.account.userId = "second-learner";
  state.account.displayName = "Second Learner";
  state.instructions = "Only this learner's saved instructions.";
  state.preferences = [];
  state.progress = null;
  await page.evaluate(async () => {
    const userModule = "/src/lib/userStore.ts";
    const chatModule = "/src/lib/chatStore.ts";
    const { useUserStore } = await import(userModule);
    const { useChatStore } = await import(chatModule);
    useUserStore.setState({ userId: "second-learner", displayName: "Second Learner" });
    useChatStore.setState({ userName: "Second Learner", userNickname: "", userCustomInstructions: "" });
  });
  try {
    await dialog.getByRole("tab", { name: "Learning", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(state.instructions);
  } finally {
    release();
  }
  await expect.poll(() => cachedInstructions(page)).toBe(state.instructions);
  await expect(dialog.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(state.instructions);
});

for (const scope of ["course", "account"] as const) {
test(`old-${scope} learning responses cannot replace a new scope's in-page snapshot`, async ({ page }) => {
  const state = await mockLearnerApp(page);
  const dialog = await openProfile(page, "Overview");
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  let delivered = false;
  await page.route(`**/api/learner-profile/learning/${agentId}`, async route => {
    if (scope === "account" && state.account.userId !== userId) return route.fallback();
    held = true;
    await barrier;
    await route.fulfill({ json: {
      user_id: userId, agent_id: agentId, status: "ok", learning_preferences: ["Old preferences"],
      progress: { topics: recordedProgress.topics, threshold_concepts: recordedProgress.threshold_concepts, objectives: recordedProgress.objectives },
    } });
    delivered = true;
  });
  await dialog.getByRole("button", { name: "Refresh progress", exact: true }).click();
  await expect.poll(() => held).toBe(true);
  state.preferences = ["Current saved preference"];
  state.progress = {
    topics: { "Digital logic": { status: "in_progress", latest_summary: "New TA observation." } },
    threshold_concepts: {}, objectives: {},
  };
  if (scope === "course") {
    await page.evaluate(() => {
      history.pushState(null, "", "/course/Second");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  } else {
    state.account.userId = "second-learner";
    state.account.displayName = "Second Learner";
    await page.evaluate(async () => {
      const userModule = "/src/lib/userStore.ts";
      const chatModule = "/src/lib/chatStore.ts";
      const { useUserStore } = await import(userModule);
      const { useChatStore } = await import(chatModule);
      useUserStore.setState({ userId: "second-learner", displayName: "Second Learner" });
      useChatStore.setState({ userName: "Second Learner", userNickname: "", userCustomInstructions: "" });
    });
  }
  try {
    await expect(dialog.getByText("0 of 1 topics completed", { exact: true })).toBeVisible();
    await expect(dialog.getByText("2 of 4 topics completed", { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await expect.poll(() => delivered).toBe(true);
  await dialog.getByRole("tab", { name: "Memory", exact: true }).click();
  await expect(dialog.getByRole("group", { name: "Evidence observations", exact: true }).locator("dd")).toHaveText("1");
  await dialog.getByRole("button", { name: "View learning memory", exact: true }).click();
  await expect(dialog.getByText("New TA observation.", { exact: true }).last()).toBeVisible();
  await expect(dialog.getByText("Distinguished voltage from current.", { exact: true })).toHaveCount(0);
  expect(state.learningReads.at(-1)).toEqual({
    agentId: scope === "course" ? "course-Second" : agentId,
    userId: scope === "account" ? "second-learner" : userId,
  });
});
}

test("a compact mobile dialog keeps long tracked names, tabs and save actions within the viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const state = await mockLearnerApp(page);
  const name = "A".repeat(160);
  state.progress!.topics![name] = { status: "in_progress", last_touched: "2026-09-29T13:00:00Z" };
  state.preferences = ["B".repeat(160)];
  const dialog = await openProfile(page, "Overview");
  const refresh = dialog.getByRole("button", { name: "Refresh progress", exact: true });
  await expect(refresh).toHaveText("Refresh");
  await expect(refresh.locator("svg")).toHaveCount(0);
  const titleBounds = (await dialog.getByRole("heading", { name: "Learner profile", exact: true }).boundingBox())!;
  const refreshBounds = (await refresh.boundingBox())!;
  expect(titleBounds.x + titleBounds.width).toBeLessThanOrEqual(refreshBounds.x);
  for (const tab of ["Overview", "Learning", "Memory"] as const) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    const save = dialog.getByRole("button", { name: "Save instructions", exact: true });
    if (tab === "Learning") await expect(save).toBeVisible();
    else await expect(save).toHaveCount(0);
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
  }
  await dialog.screenshot({ path: testInfo.outputPath("learner-profile-compact-mobile.png"), animations: "disabled" });
});

for (const width of [1440, 390]) {
  test(`dense learner profile keeps a consistent scale and pinned controls at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const state = await mockLearnerApp(page);
    const focuses = [
      "Industrial Control and Drives", "Electrical Safety and Isolation", "Solar-cell fundamentals",
      "Wiring, Protection and Earthing", "Solar PV fundamentals", "Motor Starter Circuits",
      "Motor starting", "Refrigerator control and compressor circuit reasoning",
      "AC source behaviour and waveform reasoning", "RC, RL and diode circuit behaviour",
      "Power conversion and efficiency", "Circuit measurement techniques", "Fault diagnosis", "Energy storage",
    ];
    state.progress = {
      topics: Object.fromEntries([
        ...focuses.map(name => [name, { status: "in_progress" as const }]),
        ...Array.from({ length: 149 }, (_, index) => [`Upcoming topic ${index + 1}`, { status: "not_started" as const }]),
      ]),
      threshold_concepts: {}, objectives: {},
    };
    const dialog = await openProfile(page, "Overview");
    const scroll = dialog.getByTestId("learner-profile-scroll");
    const title = dialog.getByRole("heading", { name: "Learner profile", exact: true });
    const done = dialog.getByRole("button", { name: "Done", exact: true });
    const save = dialog.getByRole("button", { name: "Save instructions", exact: true });
    await expect(dialog.getByText("0 of 163 topics completed", { exact: true })).toBeVisible();
    await expect(title).toHaveCSS("font-size", "18px");
    await expect(done).toHaveCSS("font-size", "13px");
    await expect(done).toHaveCSS("height", "36px");
    await expect(save).toHaveCount(0);
    for (const tab of await dialog.getByRole("tab").all()) await expect(tab).toHaveCSS("font-size", "13px");
    for (const heading of await scroll.getByRole("heading", { level: 2 }).all()) await expect(heading).toHaveCSS("font-size", "13px");
    const items = dialog.getByRole("region", { name: "Topics covered", exact: true }).getByRole("listitem");
    await expect(items.locator("p:first-child")).toHaveText([...focuses].sort((a, b) => a.localeCompare(b)));
    await expect(items.getByText("In progress", { exact: true })).toHaveCount(14);
    await expect(items.first()).toHaveCSS("font-size", "13px");
    const first = (await items.nth(0).boundingBox())!;
    const second = (await items.nth(1).boundingBox())!;
    if (width >= 640) {
      expect(first.y).toBe(second.y);
      expect(first.width).toBeCloseTo(second.width, 0);
    } else {
      expect(first.x).toBe(second.x);
      expect(second.y).toBeGreaterThan(first.y);
    }
    await expect(dialog.getByRole("button", { name: `Practice ${focuses[0]}`, exact: true })).toBeInViewport();
    const titleBefore = (await title.boundingBox())!;
    const doneBefore = (await done.boundingBox())!;
    const dialogBefore = (await dialog.boundingBox())!;
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect((await title.boundingBox())!.y).toBe(titleBefore.y);
    expect((await done.boundingBox())!.y).toBe(doneBefore.y);
    await expect(done).toBeInViewport();
    await expect.poll(() => scroll.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole("tab", { name: "Learning", exact: true }).click();
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
    expect((await dialog.boundingBox())!.height).toBe(dialogBefore.height);
    await expect(save).toBeDisabled();
    await expect(dialog.getByRole("heading", { name: "Custom instructions", exact: true })).toBeInViewport();
    await dialog.screenshot({ path: testInfo.outputPath(`learner-profile-dense-learning-${width}.png`), animations: "disabled" });
    await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill(updatedInstructions);
    await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
    await expect(save).toBeEnabled();
    await expect(save).toBeInViewport();
    await save.click();
    await expect(save).toHaveCount(0);
    expect(state.instructions).toBe(updatedInstructions);
    await expectNeutralProfile(dialog);
    await dialog.screenshot({ path: testInfo.outputPath(`learner-profile-dense-${width}.png`), animations: "disabled" });
    await dialog.getByRole("tab", { name: "Memory", exact: true }).click();
    await expect(save).toHaveCount(0);
    await expect(scroll).toHaveJSProperty("scrollTop", 0);
    await dialog.screenshot({ path: testInfo.outputPath(`learner-profile-dense-memory-${width}.png`), animations: "disabled" });
  });
}

test("shared topic progress counts only learned topics as completed and preserves unavailable data", () => {
  expect(summarizeTopicProgress(null)).toBeNull();
  expect(summarizeTopicProgress(undefined)).toBeNull();
  expect(summarizeTopicProgress({})).toEqual({
    total: 0, learned: 0, inProgress: 0, notStarted: 0, percent: 0, coveredTopics: [],
  });
  const topics = Object.freeze({
    "Started topic": { status: "in_progress" as const },
    "Unstarted topic": { status: "not_started" as const },
    "Z completed topic": { status: "learned" as const },
    "A completed topic": { status: "learned" as const },
  });
  expect(summarizeTopicProgress(topics)).toEqual({
    total: 4, learned: 2, inProgress: 1, notStarted: 1, percent: 50,
    coveredTopics: [
      { name: "A completed topic", status: "learned" },
      { name: "Z completed topic", status: "learned" },
      { name: "Started topic", status: "in_progress" },
    ],
  });
  expect(Object.keys(topics)).toEqual(["Started topic", "Unstarted topic", "Z completed topic", "A completed topic"]);
});

test("learner profile mirrors Your progress counts and covered topics, including after a refresh", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = await mockLearnerApp(page);
  await page.route("**/api/agents/*/course-curriculum", route => route.fulfill({ json: {
    status: "ready", course_curriculum: {
      course_name: "Example",
      syllabus: [{ module_id: "module-1", title: "Fundamentals", topics: Object.keys(state.progress!.topics!) }],
    },
  } }));
  await page.route("**/api/agents/*/course-curriculum/translations", route => route.fulfill({ json: {
    source_hash: "a".repeat(64), translations: [], default_instructions: "", max_instructions_length: 2000,
  } }));
  const openCurriculum = async () => {
    await page.getByRole("button", { name: "TA actions", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Course Curriculum/ }).click();
    return page.getByRole("region", { name: "Course Curriculum", exact: true });
  };
  let curriculum = await openCurriculum();
  let card = curriculum.getByRole("region", { name: "Your progress", exact: true });
  await expect(card.getByText("2 of 4 topics", { exact: true })).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  const topicNames = await card.getByRole("group", { name: "Topics covered" }).getByRole("button").allTextContents();
  expect(topicNames).toEqual(["Circuit fundamentals", "Electrical safety", "Fault diagnosis"]);
  await card.getByText("Your progress", { exact: true }).hover();
  await expect(page.getByText("Course curriculum is now available!", { exact: true })).toHaveCount(0, { timeout: 10_000 });
  await curriculum.getByRole("button", { name: "Close", exact: true }).click();

  const dialog = await openProfile(page, "Overview");
  const covered = dialog.getByRole("region", { name: "Topics covered", exact: true });
  await expect(dialog.getByText("2 of 4 topics completed", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(covered.getByRole("listitem").locator("p:first-child")).toHaveText(topicNames);
  await expect(covered.getByText("Motor control", { exact: true })).toHaveCount(0);

  state.progress!.topics!["Fault diagnosis"].status = "learned";
  state.progress!.topics!["Motor control"].status = "in_progress";
  await dialog.getByRole("button", { name: "Refresh progress", exact: true }).click();
  await expect(dialog.getByText("3 of 4 topics completed", { exact: true })).toBeVisible();
  await expect(covered.getByText("Learned", { exact: true })).toHaveCount(3);
  await expect(covered.getByText("In progress", { exact: true })).toHaveCount(1);
  const refreshedTopics = await covered.getByRole("listitem").locator("p:first-child").allTextContents();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  curriculum = await openCurriculum();
  card = curriculum.getByRole("region", { name: "Your progress", exact: true });
  await expect(card.getByText("3 of 4 topics", { exact: true })).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  await expect(card.getByRole("group", { name: "Topics covered" }).getByRole("button")).toHaveText(refreshedTopics);
  expect(errors).toEqual([]);
});

test("open learner profile refreshes saved progress after a chat completes without replacing draft instructions", async ({ page }) => {
  const state = await mockLearnerApp(page);
  let release!: () => void;
  state.chatBarrier = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("textbox", { name: "Ask anything about the course..." }).fill("Help me practise fault diagnosis.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => state.chatRequests.length).toBe(1);
  const dialog = await openProfile(page, "Overview");
  try {
    await expect(dialog.getByText("2 of 4 topics completed", { exact: true })).toBeVisible();
    await dialog.getByRole("tab", { name: "Learning", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Default instructions", exact: true }).fill(updatedInstructions);
    await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
    const readsBeforeCompletion = state.learningReads.length;
    state.progress!.topics!["Fault diagnosis"].status = "learned";
    release();
    await expect.poll(() => state.learningReads.length).toBeGreaterThan(readsBeforeCompletion);
    await expect(dialog.getByText("3 of 4 topics completed", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
    await expect(dialog.getByRole("region", { name: "Topics covered", exact: true }).getByText("Learned", { exact: true })).toHaveCount(3);
    await expect(dialog.getByText("Unsaved changes", { exact: true })).toBeVisible();
    await dialog.getByRole("tab", { name: "Learning", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(updatedInstructions);
    expect(await cachedInstructions(page)).toBe(originalInstructions);
    expect(state.writes).toHaveLength(0);
  } finally {
    release();
  }
});
