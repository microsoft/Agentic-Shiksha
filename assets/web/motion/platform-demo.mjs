import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const courseName = "Electricity Basics";
export const agentId = "course-Electricity-Basics";
export const quizId = "demo-ohms-law-check";
export const courseStarters = [
  { title: "Understand the basics", prompt: "Explain voltage, current and resistance." },
  { title: "Work an example", prompt: "Walk me through an Ohm's law example." },
  { title: "Check my understanding", prompt: "Test my understanding with a quick question." },
  { title: "Explore a circuit", prompt: "Show a simple circuit and explain its behavior." },
];
export const lesson = [
  "### Why current falls when resistance rises",
  "",
  "At a **fixed voltage**, current and resistance are inversely related:",
  "",
  "$$ I = \\frac{V}{R} $$",
  "",
  "For a hypothetical **12 V** circuit:",
  "- With **6 ohms**, the current is **2 A**.",
  "- With **12 ohms**, the current is **1 A**.",
  "",
  "**Doubling resistance halves the current** - provided the voltage stays the same.",
  "",
  "Try the concept check below and explain your reasoning.",
].join("\n");

export const question = {
  question: "At a fixed voltage, what happens to current when resistance doubles?",
  options: ["It doubles", "It halves", "It stays the same"],
  correct: 1,
  explanation: "From I = V / R, doubling R at a fixed V halves I. The voltage must remain unchanged.",
  targetsMisconception: "A larger resistance always produces a larger current.",
};

export const courseDraft = {
  courseName: "Electricity Foundations",
  courseLevel: "Certificate",
  courseSpan: "1 Month",
  courseCode: "ELEC101",
  prerequisites: ["__none__"],
  courseNotes: "Explore voltage, current and resistance through guided explanations and concept checks. Learn to apply Ohm's law, interpret simple circuit diagrams and justify predictions using evidence. The course uses hypothetical examples; no physical wiring is required.",
  conversationStarters: courseStarters,
};

export async function installDemo(context, baseURL, role, { onboardingCompleted = true } = {}) {
  assert(["student", "teacher"].includes(role));
  assert.equal(typeof onboardingCompleted, "boolean");
  const origin = new URL(baseURL).origin;
  const account = {
    userId: `tutorial-${role}`, displayName: role === "teacher" ? "Demo Teacher" : "Demo Learner",
    email: "user@example.com", role, authProvider: "microsoft", isAuthenticated: true,
  };
  const font = await readFile(join(here, "node_modules", "@fontsource-variable", "sora", "files", "sora-latin-wght-normal.woff2"));
  const threads = new Map(), messages = new Map(), assets = new Map();
  const requests = [], failures = [], pageErrors = [];
  const apiHandlers = [];
  let attempt = null;
  let companionRequests = 0;
  let releaseCompanion;
  let companionReady = false;

  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
  await context.routeWebSocket("**/*", (socket) => socket.close());
  await context.addInitScript(({ account, agentId, courseName, origin, onboardingCompleted }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("ekalaiva.user.v1", JSON.stringify({ version: 1, state: account }));
    localStorage.setItem("ekalaiva.chat.v1", JSON.stringify({ version: 2, state: {
      onboardingCompleted, userStatus: onboardingCompleted ? "active" : "invited", userName: account.displayName,
      userFullName: account.displayName,
      projects: { "tutorial-course": { id: "tutorial-course", name: courseName, agentId, agentName: agentId, createdAt: 1, updatedAt: 1 } },
      threads: {}, messagesByThreadId: {}, activeThreadId: null,
    } }));
    const fetchOriginal = window.fetch.bind(window);
    globalThis.tutorialStreams = [];
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (!/\/api\/agents\/[^/]+\/chat\/stream$/.test(url.pathname)) return fetchOriginal(input, init);
      const request = JSON.parse(String(init.body));
      let closed = false;
      let emit;
      const stream = new ReadableStream({
        start(controller) {
          emit = (event) => {
            if (closed) throw new Error("The simulated teaching turn is already closed");
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            if (event.type === "done") { closed = true; controller.close(); }
          };
          init.signal?.addEventListener("abort", () => {
            if (!closed) { closed = true; controller.error(new DOMException("Aborted", "AbortError")); }
          }, { once: true });
          emit({ type: "thread_id", thread_id: "tutorial-conversation" });
          emit({ type: "context_status", status: "preparing" });
        },
      });
      globalThis.tutorialStreams.push({ request, emit });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    };
  }, { account, agentId, courseName, origin, onboardingCompleted });

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({
      contentType: "text/css",
      body: `@font-face{font-family:'Sora';font-style:normal;font-weight:100 900;font-display:swap;src:url('${origin}/__tutorial-font.woff2') format('woff2')}`,
    });
    if (path === "/__tutorial-font.woff2" && url.origin === origin) {
      return route.fulfill({ contentType: "font/woff2", body: font });
    }
    if (url.hostname === "wcpstatic.microsoft.com") {
      return route.fulfill({ contentType: "application/javascript", body: "/* No consent service or telemetry is loaded in this isolated tutorial. */" });
    }
    if (url.origin !== origin) {
      failures.push(`Blocked external request: ${method} ${url.hostname}${path}`);
      return route.abort("blockedbyclient");
    }
    if (!path.startsWith("/api/") && !path.startsWith("/auth/")) return route.continue();
    requests.push(`${method} ${path}`);
    for (const handler of apiHandlers) {
      const response = await handler({ path, method, request, url });
      if (response !== undefined) {
        assert(response && Object.hasOwn(response, "json"), "A demo API handler must return a JSON response");
        return json(response.json, response.status ?? 200);
      }
    }
    if (path === "/auth/me" && method === "GET") return json({ id: account.userId, ...account });
    if (path === "/api/config" && method === "GET") return json({
      default_model: "gpt-4.1", agent_model: "gpt-4.1", allowed_models: ["gpt-4.1"], version: "tutorial-1",
    });
    if (path === "/api/speech/token" && method === "GET") {
      return json({ detail: "Speech is intentionally disabled in this offline tutorial." }, 503);
    }
    if (path === "/api/chat/health" && method === "GET") return json({ status: "ok" });
    if (path === "/api/chat/sync" && method === "POST") {
      const batch = request.postDataJSON();
      assert.equal(batch.userId, account.userId);
      batch.threads.forEach((thread) => threads.set(thread.id, thread));
      batch.messages.forEach((message) => messages.set(message.id, message));
      return json({ success: true, threadsUpserted: batch.threads.length, messagesUpserted: batch.messages.length });
    }
    if (path === `/api/chat/load/${account.userId}` && method === "GET") {
      return json({ threads: [...threads.values()], messages: [...messages.values()] });
    }
    if (path === `/api/chat/threads/${account.userId}` && method === "GET") return json({ threads: [...threads.values()] });
    if (/^\/api\/chat\/thread\/[^/]+\/messages$/.test(path) && method === "GET") {
      return json({ messages: [...messages.values()], total: messages.size, hasMore: false });
    }
    if (/^\/api\/chat\/thread\/[^/]+$/.test(path) && method === "PUT") {
      const id = path.split("/").at(-1);
      assert(threads.has(id), "Only a tutorial-owned thread may be renamed");
      const thread = { ...threads.get(id), ...request.postDataJSON() };
      threads.set(id, thread);
      return json({ success: true, thread });
    }
    if (path === "/api/chat/generate-title" && method === "POST") {
      return json({ title: "Ohm's law and resistance" });
    }
    if (path === `/api/user/${account.userId}` && ["GET", "PUT"].includes(method)) {
      return json({ success: true, profile: {
        ...account, id: account.userId, fullName: account.displayName, nickname: account.displayName,
        onboardingCompleted: true, status: "active", instituteName: "Demonstration Institute",
      } });
    }
    if (path === "/api/azure/agents/list" && method === "GET") return json([{
      id: agentId, name: agentId, createdById: "tutorial-teacher", created_by: "Demo Teacher",
      model: "gpt-4.1", description: "Understand voltage, current and resistance with a course-grounded Teaching Assistant.",
    }]);
    if (path === `/api/agents/setup/${agentId}` && method === "GET") return json({
      courseName, createdById: "tutorial-teacher", createdByName: "Demo Teacher", courseLevel: "Certificate", courseSpan: "1 Month",
      courseCode: "ELEC100", courseNotes: "Build an understanding of voltage, current and resistance through explanations and concept checks.",
      prerequisites: ["__none__"], conversationStarters: courseStarters,
    });
    if (path === `/api/agents/${agentId}/conversation-starters` && method === "GET") return json({
      starters: courseStarters,
    });
    if (path === `/api/agents/${agentId}/chat/suggestions` && method === "POST") {
      return json({ queries: ["What if the voltage doubles?", "Give me another practice question."] });
    }
    if (path === `/api/agents/${agentId}/details` && method === "GET") return json({
      name: agentId, found: true,
      definition: { tools: ["add_message", "add_quiz", "add_document"].map((name) => ({ type: "function", name })) },
    });
    if (path === `/api/agents/${agentId}/course-curriculum` && method === "GET") {
      return json({ agent_name: agentId, status: "not_available", course_curriculum: null, can_retry: false });
    }
    if (path === `/api/agents/${agentId}/memory/config` && method === "GET") return json({
      enabled: false, graph_memory_mode: "off", can_manage: false,
      memory_scope: { tenant_id: "demo", institute_id: "demo" }, curriculum_binding: null, revision: null,
    });
    if (path === `/api/agents/${agentId}/progress/${account.userId}` && method === "GET") {
      return json({ topics: {}, threshold_concepts: {}, objectives: {}, overall: { total_topics: 0, learned: 0, in_progress: 0, not_started: 0, percent: 0 } });
    }
    if (path === "/api/learner-profile" && method === "GET") return json({ customInstructions: "", updatedAt: null });
    if (path === `/api/learner-profile/learning/${agentId}` && method === "GET") return json({
      user_id: account.userId, agent_id: agentId, status: "no_state", progress: null, learning_preferences: [],
    });
    if (path === "/api/quiz-assets" && method === "POST") return json({ assetId: quizId, createdAt: "2026-09-30T00:00:00Z" });
    if (/^\/api\/quiz-attempts\/[^/]+\/first$/.test(path) && method === "GET") {
      assert.equal(url.searchParams.get("userId"), account.userId);
      assert.equal(url.searchParams.get("agentId"), agentId);
      return json((path === `/api/quiz-attempts/${quizId}/first` && attempt) || { exists: false, assetId: null, submittedAt: null });
    }
    if (path === "/api/quiz-attempts/first" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(body.quizId, quizId);
      assert.deepEqual(body.answers[0].selected, [1]);
      assert(body.answers[0].reason.length > 10);
      attempt = { exists: true, created: true, assetId: quizId, submittedAt: "2026-09-30T00:00:00Z", score: 1, totalQuestions: 1 };
      return json(attempt);
    }
    if (path === `/api/quiz-attempts/${quizId}/feedback` && method === "POST") return json({ success: true });
    if (path === "/api/assets" && method === "POST") {
      const asset = request.postDataJSON();
      assets.set(asset.id, asset);
      return json(asset);
    }
    if (path === "/api/assets" && method === "GET") return json({ assets: [...assets.values()], total: assets.size });
    if (path === "/api/assets/public" && method === "GET") return json({ assets: [], total: 0 });
    if (/^\/api\/assets\/[^/]+$/.test(path) && method === "GET") {
      const id = decodeURIComponent(path.split("/").at(-1));
      return assets.has(id) ? json(assets.get(id)) : json({ detail: "This demo asset does not exist." }, 404);
    }
    if (path === "/api/agents/check-name" && method === "GET") return json({ exists: false });
    if (path === "/api/knowledge/list" && method === "GET") return json({
      session_uuid: url.searchParams.get("session_uuid"), kb_scope: "course", files: [],
    });
    if (path === "/api/course-form/assist" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(role, "teacher");
      assert.equal(body.allowEdits, true);
      companionRequests++;
      companionReady = true;
      await new Promise((resolve) => { releaseCompanion = resolve; });
      return json({ message: "I drafted a one-month certificate course covering voltage, current and resistance. Review the highlighted fields before choosing Create. Nothing has been submitted.", fields: courseDraft });
    }
    failures.push(`Unmocked request: ${method} ${path}`);
    return json({ detail: `This isolated tutorial does not implement ${method} ${path}.` }, 501);
  });
  return {
    account, requests, failures, pageErrors, threads, messages, assets,
    addApiHandler(handler) {
      assert.equal(typeof handler, "function", "Demo API handlers must be functions");
      apiHandlers.push(handler);
    },
    get attempt() { return attempt; },
    get companionReady() { return companionReady; },
    get companionRequests() { return companionRequests; },
    completeCompanion() { assert(releaseCompanion, "No Course Companion request is waiting"); releaseCompanion(); },
    verify() {
      assert.deepEqual(failures, [], "Every backend request must be simulated, and external requests blocked");
      assert.deepEqual(pageErrors, [], "The actual frontend must run without page errors");
      assert(!requests.some((entry) => entry.includes("/create-async")), "The course-setup tutorial must not submit Create");
    },
  };
}
