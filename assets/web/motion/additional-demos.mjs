import assert from "node:assert/strict";
import { agentId } from "./platform-demo.mjs";

async function textReply(ctx, stream, content) {
  await ctx.helpers.emit({ type: "context_status", status: "ready" }, stream);
  await ctx.helpers.emit({ type: "message_block_start" }, stream);
  for (const paragraph of content.split("\n\n")) {
    await ctx.helpers.emit({ type: "message_block_delta", delta: `${paragraph}\n\n` }, stream);
    await ctx.recorder.hold(0.3);
  }
  await ctx.helpers.emit({ type: "message_block", content }, stream);
  await ctx.helpers.finishTurn(stream);
}

const notes = [
  "# Ohm's law field guide",
  "",
  "## 1. Core relationship",
  "",
  "Ohm's law connects **voltage**, **current** and **resistance** in an ideal resistive circuit.",
  "",
  "$$I = \\frac{V}{R}$$",
  "",
  "| Symbol | Quantity | Unit |",
  "|---|---|---|",
  "| V | Voltage | volt (V) |",
  "| I | Current | ampere (A) |",
  "| R | Resistance | ohm |",
  "",
  "### Keep one variable fixed",
  "",
  "To predict what changing resistance does to current, hold the voltage fixed. If both variables change, use their ratio rather than relying on a slogan.",
  "",
  "A larger resistance means a smaller current **at the same voltage**. This is an inverse relationship, not a statement that voltage and current are interchangeable.",
  "",
  "### Use consistent units",
  "",
  "Convert kilo-ohms to ohms before substituting into the equation, or keep track of the matching milliampere units. Write the unit beside every result.",
  "",
  "These are hypothetical examples for reasoning about an ideal model. They are not instructions for physical wiring.",
  "",
  "## 2. Worked example",
  "",
  "Keep the source voltage at **12 V** and compare two resistances.",
  "",
  "| Case | Voltage | Resistance | Current |",
  "|---|---|---|---|",
  "| A | 12 V | 6 ohms | 2 A |",
  "| B | 12 V | 12 ohms | 1 A |",
  "",
  "In case A, 12 divided by 6 equals 2. In case B, 12 divided by 12 equals 1.",
  "",
  "**Doubling resistance halves current when the voltage is unchanged.**",
  "",
  "Check the explanation as well as the number: the numerator remains fixed while the denominator doubles. The ratio therefore becomes half its original value.",
  "",
  "## 3. Check your understanding",
  "",
  "1. At fixed resistance, what happens to current if voltage doubles?",
  "2. If voltage and resistance both double, what happens to current?",
  "3. Which variable must remain fixed for 'more resistance means less current' to apply?",
  "",
  "Explain each answer using the ratio V / R. A correct answer is a useful observation, not proof that every related concept has been mastered.",
].join("\n");

export const additionalDemos = [
  {
    id: "answer-depth", name: "shiksha-answer-depth-tutorial",
    title: "Choose the right answer depth", role: "student",
    description: "Compare Concise and Comprehensive using the real answer-depth selector and streamed responses.",
    async run(ctx) {
      const { page, recorder, expect, helpers } = ctx;
      let concise, comprehensive;
      await recorder.chapter("01  Open your course and choose how much explanation you want.", async () => {
        await helpers.openCourse();
        await recorder.hold(1.6);
        await recorder.click(page.getByRole("button", { name: /^Answer depth:/ }));
        await recorder.hold(1.5);
        await recorder.click(page.getByRole("menuitemradio", { name: /^Concise/ }));
      });
      await recorder.chapter("02  Concise gives a short response to a focused question.", async () => {
        concise = await helpers.ask("How does resistance affect current at a fixed voltage?", 3);
        await recorder.hold(0.8);
        await textReply(ctx, concise, "**At a fixed voltage, more resistance means less current.**\n\nFrom I = V / R, doubling resistance halves current.");
        await expect(page.getByText("At a fixed voltage, more resistance means less current.", { exact: true }).first()).toBeVisible();
        await recorder.hold(2.4);
      });
      await recorder.chapter("03  Switch to Comprehensive when you want a worked explanation.", async () => {
        await recorder.click(page.getByRole("button", { name: /^Answer depth:/ }));
        await recorder.hold(1.2);
        await recorder.click(page.getByRole("menuitemradio", { name: /^Comprehensive/ }));
        comprehensive = await helpers.ask("Show the same relationship with a worked example.", 2.6);
        await recorder.hold(0.8);
      });
      await recorder.chapter("04  Read the example and its assumptions; depth can change on every turn.", async () => {
        await textReply(ctx, comprehensive, [
          "### A worked example at fixed voltage",
          "Use **I = V / R** and keep V at **12 V**.",
          "| Resistance | Current |\n|---|---|\n| 6 ohms | 2 A |\n| 12 ohms | 1 A |",
          "The resistance doubles while the voltage stays constant, so current falls from 2 A to 1 A.",
          "**Key assumption:** voltage is unchanged. If voltage changes too, calculate the new ratio.",
        ].join("\n\n"));
        await expect(page.getByRole("heading", { name: "A worked example at fixed voltage", exact: true })).toBeVisible();
        await recorder.hold(3.6);
        recorder.posterTime = recorder.frames / 12 - 1;
      });
      const depths = await page.evaluate(() => globalThis.tutorialStreams.map((stream) => stream.request.answer_depth));
      assert.deepEqual(depths, ["quick", "detailed"]);
    },
  },
  {
    id: "documents", name: "shiksha-document-reader-tutorial",
    title: "Read and navigate generated notes", role: "student",
    description: "Generate a study document, open the real reader, use full screen and jump between sections.",
    async run(ctx) {
      const { page, recorder, expect, helpers } = ctx;
      let stream;
      await recorder.chapter("01  Ask your course TA to turn an explanation into structured study notes.", async () => {
        await helpers.openCourse();
        await recorder.hold(1.2);
        stream = await helpers.ask("Create study notes on Ohm's law with a worked example and quick checks.", 3);
        await recorder.hold(0.8);
      });
      await recorder.chapter("02  Follow the document being created through the real artifact renderer.", async () => {
        await helpers.emit({ type: "context_status", status: "ready" }, stream);
        await helpers.emit({ type: "message_block", content: "Here is a short field guide. Read the relationship, then inspect the worked example." }, stream);
        await helpers.emit({ type: "document_start" }, stream);
        await helpers.emit({ type: "document_title", title: "Ohm's law field guide" }, stream);
        for (const section of notes.split(/(?=## \d)/)) {
          await helpers.emit({ type: "document_delta", delta: section }, stream);
          await recorder.hold(0.7);
        }
        await helpers.emit({ type: "document", title: "Ohm's law field guide", content: notes, doc_type: "markdown" }, stream);
        await helpers.finishTurn(stream);
        await recorder.hold(1.8);
      });
      const pane = page.getByRole("region", { name: "Document pane", exact: true });
      await recorder.chapter("03  Open the saved document, then enter full screen for focused reading.", async () => {
        const card = page.locator('[id^="asset-anchor-"]').filter({ hasText: "Ohm's law field guide" });
        await expect(card).toHaveCount(1);
        await recorder.click(card.getByRole("button", { name: "Open", exact: true }));
        await expect(pane).toBeVisible();
        await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
        await recorder.hold(1.6);
        await recorder.click(pane.getByRole("button", { name: "Enter full screen", exact: true }));
        await expect(pane.getByRole("button", { name: "Exit full screen", exact: true })).toBeVisible();
        await recorder.hold(2);
      });
      await recorder.chapter("04  Use the document-section rail to jump straight to the worked example.", async () => {
        await recorder.click(pane.getByRole("navigation", { name: "Document sections", exact: true })
          .getByRole("button", { name: /Worked example/ }));
        await expect(pane.getByRole("heading", { name: "2. Worked example", exact: true })).toBeInViewport();
        await recorder.hold(0.9);
        await recorder.move(pane.getByRole("heading", { name: "2. Worked example", exact: true }));
        await recorder.hold(2.1);
        recorder.posterTime = recorder.frames / 12 - 1;
      });
      await recorder.chapter("05  Return to the conversation without losing the generated notes.", async () => {
        await recorder.click(pane.getByRole("button", { name: "Exit full screen", exact: true }));
        await recorder.hold(0.8);
        await recorder.click(pane.getByRole("button", { name: "Close document", exact: true }));
        await expect(page.locator('[id^="asset-anchor-"]').filter({ hasText: "Ohm's law field guide" })).toBeVisible();
        await recorder.hold(2);
      });
    },
  },
  {
    id: "preferences", name: "shiksha-learning-preferences-tutorial",
    title: "Personalize your learning preferences", role: "student",
    description: "Save custom learner instructions, verify they reach the next chat turn, and reopen the saved preference.",
    async setup({ demo }) {
      let instructions = "";
      demo.addApiHandler(async ({ path, method, request }) => {
        if (path === "/api/learner-profile" && ["GET", "PUT"].includes(method)) {
          if (method === "PUT") {
            const body = request.postDataJSON();
            assert.equal(typeof body.customInstructions, "string");
            instructions = body.customInstructions;
          }
          return { json: { customInstructions: instructions, updatedAt: instructions ? "2026-09-30T00:00:00Z" : null } };
        }
        if (path === `/api/user/${demo.account.userId}` && method === "GET") {
          return { json: { success: true, profile: {
            ...demo.account, id: demo.account.userId, fullName: demo.account.displayName,
            status: "active", onboardingCompleted: true, customInstructions: instructions,
          } } };
        }
        if (path === `/api/learner-profile/learning/${agentId}` && method === "GET") {
          return { json: { user_id: demo.account.userId, agent_id: agentId, status: "no_state",
            progress: null, learning_preferences: ["Worked examples"] } };
        }
        return undefined;
      });
    },
    async run(ctx) {
      const { page, recorder, expect, helpers } = ctx;
      const instructions = "Explain step by step. Use everyday examples and ask a quick check.";
      const dialog = page.getByRole("dialog", { name: "Learner profile", exact: true });
      async function openLearning() {
        await recorder.click(page.getByRole("button", { name: "TA actions", exact: true }));
        await recorder.click(page.getByRole("menuitem", { name: /^Learner profile/ }));
        await expect(dialog).toBeVisible();
        await recorder.click(dialog.getByRole("tab", { name: "Learning", exact: true }));
      }
      await recorder.chapter("01  Open Learner profile from the course's TA actions menu.", async () => {
        await helpers.openCourse();
        await recorder.hold(1.4);
        await openLearning();
        await recorder.hold(2);
      });
      await recorder.chapter("02  Tell the tutor how you prefer explanations and practice to be presented.", async () => {
        await recorder.type(dialog.getByRole("textbox", { name: "Default instructions", exact: true }), instructions, 3.5);
        await recorder.hold(1.2);
      });
      await recorder.chapter("03  Save the instructions and return to your course conversation.", async () => {
        await recorder.click(dialog.getByRole("button", { name: "Save instructions", exact: true }));
        await expect(dialog.getByRole("button", { name: "Save instructions", exact: true })).toBeDisabled();
        await recorder.hold(1.4);
        await recorder.click(dialog.getByRole("button", { name: "Done", exact: true }));
      });
      await recorder.chapter("04  Your next teaching turn carries the saved instructions.", async () => {
        const stream = await helpers.ask("Help me understand resistance.", 2);
        const sent = await page.evaluate((index) => globalThis.tutorialStreams[index].request, stream);
        assert.equal(sent.user_profile.customInstructions, instructions);
        await textReply(ctx, stream, "Let's go step by step. **Resistance limits current at a fixed voltage.**\n\nUse I = V / R: with the voltage unchanged, more resistance means less current.\n\n**Quick check:** if resistance doubles, what happens to current?");
        await recorder.hold(3);
      });
      await recorder.chapter("05  Reopen the profile to confirm the preference is saved, not just typed.", async () => {
        await openLearning();
        await expect(dialog.getByRole("textbox", { name: "Default instructions", exact: true })).toHaveValue(instructions);
        await recorder.hold(2.5);
        recorder.posterTime = recorder.frames / 12 - 1;
      });
    },
  },
  {
    id: "companion-review", name: "shiksha-companion-review-tutorial",
    title: "Review and undo Course Companion edits", role: "teacher",
    description: "Compare Chat only with Allow editing, review a proposed form patch and undo it without creating a course.",
    async setup({ demo }) {
      const modes = [];
      demo.addApiHandler(async ({ path, method, request }) => {
        if (path !== "/api/course-form/assist" || method !== "POST") return undefined;
        const body = request.postDataJSON();
        modes.push(body.allowEdits);
        assert.equal(body.form.courseName, "Electricity Foundations");
        if (!body.allowEdits) return { json: {
          message: "Consider code ELEC102 and an outcome that asks learners to justify predictions using Ohm's law. Chat only has not changed your draft.",
          fields: {},
        } };
        assert.deepEqual(modes, [false, true]);
        return { json: {
          message: "I updated the course code and description in the draft. Review the highlighted fields, or use Undo to restore your original wording.",
          fields: { courseCode: "ELEC102", courseNotes: "Use Ohm's law to justify predictions about current at a fixed voltage." },
        } };
      });
    },
    async run(ctx) {
      const { page, recorder, expect } = ctx;
      const original = "Learn the basics of voltage, current and resistance.";
      const name = page.getByPlaceholder("e.g., Data Structures & Algorithms");
      const code = page.getByPlaceholder("e.g., CS101");
      const notes = page.getByPlaceholder("Course overview, syllabus, and learning outcomes...");
      const companion = page.getByRole("complementary", { name: "Course Companion", exact: true });
      await recorder.chapter("01  Start a course draft with your own title, code and description.", async () => {
        await recorder.click(page.getByRole("complementary").first().getByRole("button", { name: "Create", exact: true }));
        await recorder.type(name, "Electricity Foundations", 1.8);
        await recorder.type(code, "ELEC101", 0.7);
        await recorder.type(notes, original, 2);
        await page.getByRole("heading", { name: "Course Details", exact: true }).scrollIntoViewIfNeeded();
        await recorder.hold(1);
      });
      await recorder.chapter("02  Choose Chat only when you want advice without changing the form.", async () => {
        await recorder.click(page.getByRole("button", { name: "Course Companion", exact: true }));
        await recorder.click(companion.getByRole("button", { name: "Companion mode", exact: true }));
        await recorder.hold(0.8);
        await recorder.click(page.getByRole("menuitemradio", { name: "Chat only", exact: true }));
        await recorder.type(companion.getByRole("textbox", { name: "Message Course Companion", exact: true }),
          "Suggest a clearer course code and learning outcome.", 2);
        await recorder.click(companion.getByRole("button", { name: "Send message", exact: true }));
        await expect(companion.getByRole("log")).toContainText("Chat only has not changed");
        await expect(code).toHaveValue("ELEC101");
        await expect(notes).toHaveValue(original);
        await recorder.hold(1.8);
      });
      await recorder.chapter("03  Enable editing, then explicitly ask the Companion to apply the proposal.", async () => {
        await recorder.click(companion.getByRole("button", { name: "Companion mode", exact: true }));
        await recorder.click(page.getByRole("menuitemradio", { name: "Allow editing", exact: true }));
        await recorder.type(companion.getByRole("textbox", { name: "Message Course Companion", exact: true }),
          "Apply course code ELEC102 and the Ohm's-law outcome.", 2.2);
        await recorder.click(companion.getByRole("button", { name: "Send message", exact: true }));
        await expect(code).toHaveValue("ELEC102");
        await expect(companion.getByRole("log")).toContainText("updated the course code");
        await recorder.hold(2.2);
      });
      await recorder.chapter("04  Inspect the highlighted changes before deciding whether to keep them.", async () => {
        await recorder.move(code);
        await expect(page.locator('[data-companion-field="courseCode"]')).toHaveAttribute("data-companion-updated", "true");
        await recorder.hold(2.5);
        recorder.posterTime = recorder.frames / 12 - 1;
      });
      await recorder.chapter("05  Undo restores your original values. No Create submission is made.", async () => {
        await recorder.click(companion.getByRole("button", { name: "Undo last changes", exact: true }));
        await expect(code).toHaveValue("ELEC101");
        await expect(notes).toHaveValue(original);
        await expect(page.locator('[data-companion-updated="true"]')).toHaveCount(0);
        await recorder.hold(2.6);
      });
    },
  },
];
