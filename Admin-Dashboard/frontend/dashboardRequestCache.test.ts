import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { cachedDashboardRequest, clearDashboardRequests } from "./src/lib/dashboardRequestCache.ts";

beforeEach(clearDashboardRequests);

test("coalesces requests and returns isolated copies", async () => {
  let reads = 0;
  let release!: (value: { count: number }) => void;
  const response = new Promise<{ count: number }>(resolve => { release = resolve; });
  const load = () => { reads += 1; return response; };
  const first = cachedDashboardRequest("admin-one", "agents", load);
  const second = cachedDashboardRequest("admin-one", "agents", load);
  release({ count: 3 });
  const results = await Promise.all([first, second]);
  results[0].count = 9;
  assert.equal(results[1].count, 3);
  assert.equal((await cachedDashboardRequest("admin-one", "agents", load)).count, 3);
  assert.equal(reads, 1);
});

test("isolates accounts and does not cache failures", async () => {
  let reads = 0;
  const load = async () => ({ count: ++reads });
  assert.equal((await cachedDashboardRequest("admin-one", "agents", load)).count, 1);
  assert.equal((await cachedDashboardRequest("admin-two", "agents", load)).count, 2);
  await assert.rejects(cachedDashboardRequest("admin-one", "failed", async () => { throw new Error("Unavailable"); }));
  assert.equal((await cachedDashboardRequest("admin-one", "failed", load)).count, 3);
});

test("edits invalidate cached and in-flight results", async () => {
  let release!: (value: string) => void;
  const response = new Promise<string>(resolve => { release = resolve; });
  const first = cachedDashboardRequest("admin-one", "agents", () => response);
  clearDashboardRequests();
  assert.equal(await cachedDashboardRequest("admin-one", "agents", async () => "new"), "new");
  release("old");
  await first;
  assert.equal(await cachedDashboardRequest("admin-one", "agents", async () => "unexpected"), "new");
});

test("expires completed responses", async context => {
  context.mock.method(Date, "now", () => 1000);
  assert.equal(await cachedDashboardRequest("admin-one", "agents", async () => "old"), "old");
  context.mock.method(Date, "now", () => 3001);
  assert.equal(await cachedDashboardRequest("admin-one", "agents", async () => "fresh"), "fresh");
});