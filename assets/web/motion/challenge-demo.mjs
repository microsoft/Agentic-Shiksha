import assert from "node:assert/strict";
import { agentId } from "./platform-demo.mjs";

const challenge = {
  title: "Double both: what happens to current?",
  description: [
    "### Predict before calculating",
    "",
    "In a hypothetical ideal resistor model, the initial voltage is **4 V** and the resistance is **1,000 ohms**.",
    "",
    "Both values then double: **8 V** and **2,000 ohms**.",
    "",
    "**Does the current increase, decrease, or stay the same? Explain why.**",
    "",
    "This is a mathematical exercise only. No physical wiring is required.",
  ].join("\n"),
  difficulty: "medium",
  hints: [
    "Use I = V / R. Compare the ratio of voltage to resistance before and after the change.",
    "The new ratio is (2 x V) / (2 x R). The factors of two cancel; check both currents in amperes.",
  ],
  solution: [
    "### The current stays the same",
    "",
    "- Initially: **I = 4 / 1,000 = 0.004 A = 4 mA**.",
    "- After both double: **I = 8 / 2,000 = 0.004 A = 4 mA**.",
    "",
    "Doubling resistance halves current only when voltage is fixed. Here, both voltage and resistance double, so their ratio is unchanged.",
  ].join("\n"),
  challengeType: "problem",
};
const reflection = "Both currents are 4 mA: doubling voltage and resistance leaves V/R unchanged. The fixed-voltage rule does not apply here.";
const feedback = "That reasoning matches the worked example: both ratios give 4 mA. Keep checking which quantities are held fixed before applying a rule.";

export const challengeDemo = {
  id: "challenges",
  name: "shiksha-challenges-tutorial",
  title: "Work through a guided challenge",
  role: "student",
  description: "Predict current in an original hypothetical resistor challenge, reveal two hints progressively, compare the worked answer, and explain the fixed-voltage condition in chat.",
  async setup({ demo }) {
    assert.equal(demo.account.role, "student");
    demo.addApiHandler(async ({ path, method }) => {
      if (path !== `/api/agents/${agentId}/details` || method !== "GET") return undefined;
      return { json: {
        name: agentId, found: true,
        definition: { tools: ["add_message", "add_quiz", "add_document", "add_challenge"]
          .map((name) => ({ type: "function", name })) },
      } };
    });
  },
  async run({ page, demo, recorder, expect, helpers }) {
    let stream;
    const pane = page.getByRole("region", { name: "Document pane", exact: true });
    const card = page.locator('[id^="asset-anchor-"]').filter({
      has: page.getByText(challenge.title, { exact: true }),
    });
    const workedAnswer = pane.getByRole("heading", { name: "The current stays the same", exact: true });

    await recorder.chapter("01  Ask for a challenge that tests reasoning, not just recall.", async () => {
      await helpers.openCourse();
      stream = await helpers.ask("Give me a guided challenge about current when voltage and resistance both double. Use a hypothetical low-voltage example and two hints.", 3);
      await recorder.hold(0.5);
    });
    await recorder.chapter("02  Open the challenge and predict before viewing any help.", async () => {
      await helpers.emit({ type: "context_status", status: "ready" }, stream);
      await helpers.emit({ type: "delta", content: "Try this original mathematical challenge. Make a prediction first, then reveal one hint at a time. No physical wiring or live measurements are involved." }, stream);
      await helpers.emit({ type: "tool_status", tool: "add_challenge" }, stream);
      await helpers.emit({ type: "challenge_start" }, stream);
      await recorder.hold(0.7);
      await helpers.emit({ type: "challenge", ...challenge }, stream);
      await helpers.finishTurn(stream);
      await expect(card).toHaveCount(1);
      await recorder.click(card.getByRole("button", { name: "Start", exact: true }));
      await expect(pane).toBeVisible();
      await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
      await expect(pane.getByRole("tab", { name: "Challenge", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(pane.getByRole("heading", { name: "Predict before calculating", exact: true })).toBeVisible();
      await expect(pane.getByText("Does the current increase, decrease, or stay the same? Explain why.", { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Open", exact: true })).toBeVisible();
      await expect(workedAnswer).toHaveCount(0);
      await recorder.hold(3);
    });
    await recorder.chapter("03  Choose Solution, then reveal just the first hint.", async () => {
      await recorder.click(pane.getByRole("tab", { name: "Solution", exact: true }));
      await expect(pane.getByRole("tab", { name: "Solution", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(pane.getByText("Hints (0/2)", { exact: true })).toBeVisible();
      await expect(pane.getByRole("button", { name: "Show Solution", exact: true })).toHaveCount(0);
      await recorder.click(pane.getByRole("button", { name: "Show hint", exact: true }));
      await expect(pane.getByText(challenge.hints[0], { exact: true })).toBeVisible();
      await expect(pane.getByText(challenge.hints[1], { exact: true })).toHaveCount(0);
      await expect(pane.getByText("Hints (1/2)", { exact: true })).toBeVisible();
      await expect(workedAnswer).toHaveCount(0);
      await recorder.hold(3);
    });
    await recorder.chapter("04  Reveal the last hint and compare the ratios yourself.", async () => {
      await recorder.click(pane.getByRole("button", { name: "Last hint", exact: true }));
      await expect(pane.getByText(challenge.hints[1], { exact: true })).toBeVisible();
      await expect(pane.getByText("Hints (2/2)", { exact: true })).toBeVisible();
      await expect(pane.getByRole("button", { name: "Show Solution", exact: true })).toBeVisible();
      await expect(workedAnswer).toHaveCount(0);
      await recorder.hold(3);
    });
    await recorder.chapter("05  Reveal the worked solution: both currents are 4 mA.", async () => {
      await recorder.click(pane.getByRole("button", { name: "Show Solution", exact: true }));
      await expect(workedAnswer).toBeVisible();
      await expect(pane.getByText("I = 4 / 1,000 = 0.004 A = 4 mA", { exact: true })).toBeVisible();
      await expect(pane.getByText("I = 8 / 2,000 = 0.004 A = 4 mA", { exact: true })).toBeVisible();
      await expect(pane.getByRole("button", { name: "Hide Solution", exact: true })).toBeVisible();
      await recorder.hold(4);
      recorder.posterTime = Math.max(0, recorder.frames / 12 - 1);
    });
    await recorder.chapter("06  Put the solution away and explain the reasoning in chat.", async () => {
      await recorder.click(pane.getByRole("button", { name: "Hide Solution", exact: true }));
      await expect(workedAnswer).toHaveCount(0);
      await recorder.click(pane.getByRole("tab", { name: "Challenge", exact: true }));
      const reflectionStream = await helpers.ask(reflection, 3);
      await helpers.emit({ type: "context_status", status: "ready" }, reflectionStream);
      await helpers.emit({ type: "delta", content: feedback }, reflectionStream);
      await helpers.finishTurn(reflectionStream);
      await expect(page.getByText(reflection, { exact: true })).toBeVisible();
      await expect(page.getByText(feedback, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
      await expect(pane.getByRole("tab", { name: "Challenge", exact: true })).toHaveAttribute("aria-selected", "true");
      await recorder.hold(2);
    });

    const savedChallenges = () => [...demo.assets.values()]
      .filter((asset) => asset.category === "challenge" && asset.title === challenge.title);
    await expect.poll(() => savedChallenges().length).toBe(1);
    const saved = savedChallenges()[0];
    assert.equal(saved.agentId, agentId);
    const content = JSON.parse(saved.content);
    assert.equal(typeof content.challengeId, "string");
    assert(content.challengeId.length > 0, "The real stream handler must assign the challenge ID");
    assert.deepEqual(content, { challengeId: content.challengeId, ...challenge });
  },
};
