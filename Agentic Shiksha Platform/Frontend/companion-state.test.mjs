import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPANION_IDLE_MS, COMPANION_NIGHT_WAKE_MS, COMPANION_STRETCH_MS,
  getCompanionMessage, isDuplicateCompanionActivity, normalizeCompanionLabel, resolveCompanionState,
  resolveCompanionBubbleVariant,
} from "./src/components/chat/chatCompanionState.ts";

const daytime = new Date(2026, 8, 29, 12).getTime();
const nighttime = new Date(2026, 8, 29, 23).getTime();
const context = { now: daytime, openedAt: daytime, lastActivityAt: null };
const resolve = patch => resolveCompanionState({ ...context, ...patch });

test("automatic bubbles use Classic speech awake and Soft thought only while sleeping", () => {
  for (const action of ["sit", "walk", "run", "stretch"]) {
    assert.equal(resolveCompanionBubbleVariant(action), "speech");
  }
  assert.equal(resolveCompanionBubbleVariant("sleep"), "thought");
  assert.equal(resolveCompanionBubbleVariant("sleep", "speech"), "speech");
  assert.equal(resolveCompanionBubbleVariant("sit", "thought"), "thought");
});

test("daytime empty chats greet once, with the same preferred first name", () => {
  const state = resolve({ empty: true });
  assert.equal(state.action, "sit");
  assert.equal(getCompanionMessage(state, "  Mira Learner  ").headline, "Hi Mira! What would you like to learn today?");
  assert.equal(getCompanionMessage(state).headline, "Hi there! What would you like to learn today?");
});

test("empty and nonempty chats sleep at two minutes, not the old 45-second timeout", () => {
  for (const empty of [true, false]) {
    assert.equal(resolve({ empty, now: daytime + 45_000 }).action, "sit");
    assert.equal(resolve({ empty, now: daytime + COMPANION_IDLE_MS - 1 }).action, "sit");
    const sleeping = resolve({ empty, now: daytime + COMPANION_IDLE_MS });
    assert.equal(sleeping.action, "sleep");
    assert.equal(sleeping.scene, "sleep");
    for (let index = 0; index < 3; index++) {
      assert.doesNotMatch(getCompanionMessage(sleeping, "Mira", index).headline, /^Hi |Ready for|learn today/);
    }
  }
});

test("night uses local time, including the exact 22:00 and 06:00 boundaries", () => {
  for (const [hour, minute, expected] of [[21, 59, "welcome"], [22, 0, "night"], [23, 0, "night"], [0, 0, "night"], [5, 59, "night"], [6, 0, "welcome"]]) {
    const now = new Date(2026, 8, 29, hour, minute).getTime();
    assert.equal(resolve({ now, openedAt: now, empty: true }).scene, expected);
  }
});

test("interaction wakes the cat at night for a full minute", () => {
  const awake = { now: nighttime, openedAt: nighttime - 300_000, lastActivityAt: nighttime };
  assert.equal(resolve(awake).action, "sit");
  assert.equal(resolve({ ...awake, now: nighttime + COMPANION_NIGHT_WAKE_MS - 1 }).action, "sit");
  assert.equal(resolve({ ...awake, now: nighttime + COMPANION_NIGHT_WAKE_MS }).scene, "night");
});

test("typing and conversation activity reset daytime inactivity without changing the draft", () => {
  const draft = "An unfinished question";
  const state = resolve({ now: daytime + 400_000, lastActivityAt: daytime + 400_000, activityKey: draft });
  assert.equal(state.scene, "composing");
  assert.equal(state.action, "sit");
  assert.equal(draft, "An unfinished question");
  assert.equal(resolve({ now: daytime + 400_000, openedAt: daytime + 400_000 }).action, "sit");
});

for (const statusLabel of ["Creating image", "Generating a document", "Generating a quiz", "Generating a challenge", "Simulating circuit", "Creating slide deck"]) {
  test(`asset work runs before text streaming: ${statusLabel}`, () => {
    const state = resolve({ now: nighttime, isSending: true, isTyping: false, statusLabel });
    assert.equal(state.scene, "asset");
    assert.equal(state.action, "run");
    assert.equal(state.working, true);
    assert.equal(getCompanionMessage(state).headline, `${statusLabel}\u2026`);
  });
}

test("actual search/progress/planning activity takes precedence over the streaming flag", () => {
  for (const [statusLabel, scene] of [
    ["Searching course material", "search"],
    ["Loading threshold concept progress", "progress"],
    ["Saving your progress", "progress"],
    ["Contextualising", "thinking"],
    ["Planning", "thinking"],
    ["Generating clarification questions", "thinking"],
  ]) {
    const state = resolve({ now: nighttime, isSending: true, isTyping: true, statusLabel });
    assert.equal(state.scene, scene);
    assert.equal(state.action, "walk");
    assert.equal(state.working, true);
  }
});

test("plain text streaming runs, but stale tool labels never keep a finished request busy", () => {
  assert.equal(resolve({ isTyping: true }).action, "run");
  assert.equal(resolve({ isSending: true }).action, "walk");
  assert.equal(resolve({ statusLabel: "Generating a quiz" }).action, "sit");
  assert.equal(resolve({ statusLabel: "Generating a quiz", now: daytime + COMPANION_IDLE_MS }).action, "sleep");
  const preparing = resolve({ isSending: true, statusLabel: "Contextualising" });
  assert.equal(getCompanionMessage(preparing).headline, "Contextualising\u2026");
  assert.equal(getCompanionMessage(preparing).announce, true);
  assert.equal(resolve({ statusLabel: "Contextualising" }).working, false);
});

test("waiting for clarification is not agent work and eventually sleeps", () => {
  const waiting = { isSending: true, isTyping: true, statusLabel: "Waiting for your response" };
  assert.equal(resolve(waiting).standing, true);
  assert.equal(resolve(waiting).working, false);
  assert.equal(resolve({ ...waiting, now: daytime + 10_000 }).standing, false);
  assert.equal(resolve({ ...waiting, now: daytime + 14_800 }).standing, true);
  assert.equal(resolve({ ...waiting, now: daytime + COMPANION_IDLE_MS }).action, "sleep");
  assert.equal(resolve({ ...waiting, now: nighttime }).scene, "night");
  assert.equal(resolve({ ...waiting, statusLabel: "Creating image" }).action, "run");
});

test("completion gets one full stretch before settling, without a false success claim", () => {
  assert.equal(resolve({ completedAt: daytime }).scene, "stretch");
  assert.equal(resolve({ completedAt: daytime, now: daytime + COMPANION_STRETCH_MS - 1 }).scene, "stretch");
  assert.equal(resolve({ completedAt: daytime, now: daytime + COMPANION_STRETCH_MS }).scene, "ready");
  assert.doesNotMatch(getCompanionMessage(resolve({ completedAt: daytime })).headline, /finished|success|complete|ready to download/i);
});

test("inactive and read-only companions stay quiet even with active work flags", () => {
  for (const patch of [{ active: false }, { readOnly: true }]) {
    const state = resolve({ ...patch, isSending: true, isTyping: true, statusLabel: "Creating image" });
    assert.equal(state.scene, "inactive");
    assert.equal(state.action, "sleep");
    assert.equal(getCompanionMessage(state).headline, "");
  }
});

test("each idle/sleep scene has rotating copy and working labels do not rotate", () => {
  const scenes = [
    resolve({ empty: true }), resolve({}), resolve({ activityKey: "Draft" }),
    resolve({ completedAt: daytime }), resolve({ now: daytime + COMPANION_IDLE_MS }), resolve({ now: nighttime }),
  ];
  for (const state of scenes) {
    assert.equal(new Set([0, 1, 2].map(index => getCompanionMessage(state, "Mira", index).headline)).size, 3);
    assert.deepEqual(getCompanionMessage(state, "Mira", 0), getCompanionMessage(state, "Mira", 3));
  }
  const working = resolve({ isSending: true, statusLabel: "Loading threshold concept progress..." });
  const copy = [0, 1, 2].map(index => getCompanionMessage(working, "Mira", index));
  assert.equal(new Set(copy.map(message => message.headline)).size, 1);
  assert.equal(new Set(copy.map(message => message.detail)).size, 3);
  assert.ok(copy.every(message => message.announce));
  assert.equal(copy[0].headline, "Loading threshold concept progress\u2026");
});

test("live-status deduplication tolerates punctuation but preserves completed and distinct activities", () => {
  assert.equal(normalizeCompanionLabel("  Planning\u2026  "), "Planning");
  assert.equal(isDuplicateCompanionActivity({ label: "Loading threshold concept progress" }, "Loading threshold concept progress..."), true);
  assert.equal(isDuplicateCompanionActivity({ label: "  Loading   progress\u2026" }, "loading progress"), true);
  assert.equal(isDuplicateCompanionActivity({ label: "Planning", done: true }, "Planning"), false);
  assert.equal(isDuplicateCompanionActivity({ label: "Planning" }, "Creating image"), false);
  assert.equal(isDuplicateCompanionActivity({ label: "Planning" }, null), false);

  const blocks = Object.freeze([
    Object.freeze({ type: "text", content: "The actual answer." }),
    Object.freeze({ type: "tool_activity", label: "Planning", done: true }),
    Object.freeze({ type: "tool_activity", label: "Loading progress", done: false }),
    Object.freeze({ type: "tool_activity", label: "Searching course material", done: false }),
  ]);
  const displayed = blocks.filter(block => block.type !== "tool_activity" || !isDuplicateCompanionActivity(block, "Loading progress"));
  assert.deepEqual(displayed, [blocks[0], blocks[1], blocks[3]]);
  assert.equal(blocks.length, 4);
  assert.equal(displayed[0], blocks[0]);
});
