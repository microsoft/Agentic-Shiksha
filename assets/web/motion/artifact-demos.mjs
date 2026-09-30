import assert from "node:assert/strict";
import { agentId } from "./platform-demo.mjs";

const slidesId = "00000000-0000-4000-8000-000000000201";
const makeSlide = (layout, title, extra = {}) => ({
  layout, title, subtitle: "", bullets: [], columns: [], speaker_notes: "", sources: [], ...extra,
});
const deck = {
  title: "Ohm's law in four slides",
  subtitle: "Predict, compare and explain",
  theme: "academic",
  slides: [
    makeSlide("title", "Predict current with Ohm's law", {
      subtitle: "A hypothetical 6 V DC circuit. No physical wiring is needed.",
      speaker_notes: "We will keep voltage fixed and predict what happens to current when resistance changes.",
    }),
    makeSlide("process", "Predict, calculate, explain", {
      bullets: [
        "Keep the voltage fixed at 6 V.",
        "Use I = V / R to calculate current.",
        "Explain what changes when resistance doubles.",
      ],
      speaker_notes: "First predict the change. Then divide voltage by resistance. Finally compare the two currents while keeping voltage fixed.",
      sources: [{ title: "Original synthetic lesson: Ohm's law, I = V / R", url: null }],
    }),
    makeSlide("two_column", "Compare at the same voltage", {
      columns: [
        { heading: "R = 1,000 ohms", bullets: ["V = 6 V", "I = 6 / 1,000 = 0.006 A", "Current = 6 mA"] },
        { heading: "R = 2,000 ohms", bullets: ["V = 6 V", "I = 6 / 2,000 = 0.003 A", "Current = 3 mA"] },
      ],
      speaker_notes: "These are calculated values for an ideal resistor, not physical measurements. Doubling resistance halves current because the voltage remains 6 V.",
      sources: [{ title: "Calculated example: 6 V / R", url: null }],
    }),
    makeSlide("summary", "Double resistance, halve current", {
      bullets: [
        "Voltage stays at 6 V.",
        "Resistance changes from 1,000 to 2,000 ohms.",
        "Current changes from 6 mA to 3 mA.",
      ],
      speaker_notes: "The fixed-voltage condition matters. Use I = V / R to explain the change rather than memorizing a rule without its conditions.",
    }),
  ],
};

const circuit = {
  title: "Hypothetical 6 V resistor circuit",
  components: [
    { id: "Supply", kind: "voltage_source", positive: "vin", negative: "0", value: 6, waveform: "dc" },
    { id: "R1", kind: "resistor", positive: "vin", negative: "0", value: 1000 },
  ],
  analysis: { mode: "dc", probes: ["vin"] },
};
const circuitSessions = new WeakMap();
const mockNotice = "Synthetic tutorial readings calculated with Ohm's law; no ngspice or cloud service was run.";

function mockCircuitResult(spec) {
  assert.equal(spec.title, circuit.title);
  assert.equal(spec.analysis.mode, "dc");
  assert.deepEqual(spec.analysis.probes, ["vin"]);
  assert.equal(spec.components.length, 2);
  const supply = spec.components.find((part) => part.id === "Supply");
  const resistor = spec.components.find((part) => part.id === "R1");
  assert(supply && resistor, "Only the tutorial's source and resistor are supported");
  assert.equal(supply.kind, "voltage_source");
  assert.equal(supply.value, 6);
  assert.equal(supply.waveform, "dc");
  assert.equal(resistor.kind, "resistor");
  assert([1000, 2000].includes(resistor.value), "The walkthrough uses only 1,000 and 2,000 ohms");
  for (const part of [supply, resistor]) {
    assert.equal(part.positive, "vin");
    assert.equal(part.negative, "0");
    assert.notEqual(part.connected, false);
  }
  const current = supply.value / resistor.value;
  return {
    // This discriminator is required by the real renderer, not evidence of an engine run.
    engine: "ngspice", mode: "dc", time_seconds: [],
    traces: [
      { name: "vin", unit: "V", values: [supply.value] },
      { name: "Supply", unit: "A", values: [-current] },
      { name: "R1", unit: "A", values: [current] },
    ],
    notices: [mockNotice],
  };
}

function enableArtifact(demo, artifact) {
  assert.equal(demo.account.role, "student");
  demo.addApiHandler(async ({ path, method }) => {
    if (method !== "GET") return undefined;
    if (path === `/api/agents/${agentId}/details`) return { json: {
      name: agentId, found: true,
      definition: { tools: ["add_message", "add_quiz", "add_document", `add_${artifact}`]
        .map((name) => ({ type: "function", name })) },
    } };
    if (path === `/api/agents/${agentId}/${artifact}/tool`) return { json: {
      enabled: true, agent_version: "tutorial-1",
      ...(artifact === "circuit" ? { engine_available: true, trainer_available: false } : { update_available: false }),
    } };
    return undefined;
  });
}

async function runSlides({ page, recorder, expect, helpers }) {
  let stream;
  const pane = page.getByRole("region", { name: "Presentation pane", exact: true });
  const player = page.getByRole("dialog", { name: `Presentation: ${deck.title}`, exact: true });

  await recorder.chapter("1. Open a course and request a concise lesson deck.", async () => {
    await helpers.openCourse();
    stream = await helpers.ask("Create four slides explaining Ohm's law with a hypothetical 6 V resistor example and speaker notes.", 2.8);
    await recorder.hold(0.5);
  });
  await recorder.chapter("2. Open the generated slides beside your conversation.", async () => {
    await helpers.emit({ type: "delta", content: "Here is an original four-slide lesson. The worked examples are hypothetical calculations, not physical measurements." }, stream);
    await helpers.emit({ type: "tool_status", tool: "add_slides" }, stream);
    await helpers.emit({ type: "slides_start" }, stream);
    await recorder.hold(0.7);
    await helpers.emit({ type: "slides", slidesId, title: deck.title, deck }, stream);
    await helpers.finishTurn(stream);
    const open = page.getByRole("button", { name: `Open slides: ${deck.title}`, exact: true });
    await expect(open).toBeVisible();
    await recorder.click(open);
    await expect(pane).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    await expect(pane.getByRole("status", { name: "Slide 1 of 4", exact: true })).toBeVisible();
    await expect(pane.getByTestId("slide-canvas").getByText(deck.slides[0].title, { exact: true })).toBeVisible();
    await recorder.hold(2.5);
  });
  await recorder.chapter("3. Browse the lesson and reveal its speaker notes.", async () => {
    await recorder.click(pane.getByRole("button", { name: `Go to slide 2: ${deck.slides[1].title}`, exact: true }));
    await expect(pane.getByRole("status", { name: "Slide 2 of 4", exact: true })).toBeVisible();
    await recorder.click(pane.getByRole("button", { name: "Show speaker notes", exact: true }));
    await expect(pane.getByText(deck.slides[1].speaker_notes, { exact: true })).toBeVisible();
    await expect(pane.getByRole("region", { name: "Sources for slide 2", exact: true })).toBeVisible();
    await recorder.hold(3);
  });
  await recorder.chapter("4. Compare two resistances while voltage stays at 6 V.", async () => {
    await recorder.click(pane.getByRole("button", { name: "Hide speaker notes", exact: true }));
    await recorder.click(pane.getByRole("button", { name: `Go to slide 3: ${deck.slides[2].title}`, exact: true }));
    const canvas = pane.getByTestId("slide-canvas");
    await expect(canvas.getByText("Current = 6 mA", { exact: true })).toBeVisible();
    await expect(canvas.getByText("Current = 3 mA", { exact: true })).toBeVisible();
    await recorder.hold(3);
  });
  await recorder.chapter("5. Start presentation mode for a focused walkthrough.", async () => {
    await recorder.click(pane.getByRole("button", { name: "Start presentation", exact: true }));
    await expect(player).toBeVisible();
    await expect(player.getByTestId("presentation-counter")).toHaveText("3 / 4");
    await expect(player.getByTestId("presentation-stage").getByText(deck.slides[2].title, { exact: true })).toBeVisible();
    await expect(player.getByRole("progressbar", { name: "Presentation progress" })).toHaveAttribute("aria-valuenow", "3");
    await recorder.hold(3);
    recorder.posterTime = Math.max(0, recorder.frames / 12 - 1);
  });
  await recorder.chapter("6. Finish with the takeaway, then return to the same slide.", async () => {
    await recorder.click(player.getByRole("button", { name: "Next slide", exact: true }));
    await expect(player.getByTestId("presentation-counter")).toHaveText("4 / 4");
    await expect(player.getByTestId("slide-canvas").getByText(deck.slides[3].title, { exact: true })).toBeVisible();
    await expect(player.getByRole("button", { name: "Next slide", exact: true })).toBeDisabled();
    await recorder.hold(3);
    await recorder.click(player.getByRole("button", { name: "Exit presentation", exact: true }));
    await expect(player).toHaveCount(0);
    await expect(pane.getByRole("status", { name: "Slide 4 of 4", exact: true })).toBeVisible();
    await recorder.hold(1.5);
  });
}

async function runCircuit({ page, demo, recorder, expect, helpers }) {
  let stream;
  const session = circuitSessions.get(demo);
  assert(session, "Circuit setup must run before its walkthrough");
  const panel = page.getByRole("region", { name: `Circuit simulator: ${circuit.title}`, exact: true });
  const readings = panel.getByRole("region", { name: "Circuit readings", exact: true });
  const selected = panel.getByRole("combobox", { name: "Selected component", exact: true });

  await recorder.chapter("1. Request a hypothetical 6 V circuit; no physical wiring.", async () => {
    await helpers.openCourse();
    stream = await helpers.ask("Show a hypothetical 6 V DC source with a 1,000 ohm resistor so I can compare current when resistance doubles.", 2.8);
    await recorder.hold(0.5);
  });
  await recorder.chapter("2. Open Circuit Lab. These readings are mocked locally.", async () => {
    await helpers.emit({ type: "delta", content: `This is a hypothetical low-voltage example, not wiring guidance. ${mockNotice} Start with 6 V and 1,000 ohms, then predict the current after doubling resistance.` }, stream);
    await helpers.emit({ type: "tool_status", tool: "add_circuit" }, stream);
    await helpers.emit({ type: "circuit_start" }, stream);
    await recorder.hold(0.7);
    await helpers.emit({ type: "circuit", title: circuit.title, circuit, result: mockCircuitResult(circuit) }, stream);
    await helpers.finishTurn(stream);
    const open = page.getByRole("button", { name: `Open circuit: ${circuit.title}`, exact: true });
    await expect(open).toBeVisible();
    await recorder.click(open);
    await expect(panel).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    await expect(panel.getByRole("group", { name: `${circuit.title} schematic`, exact: true })).toBeVisible();
    await recorder.hold(2);
  });
  await recorder.chapter("3. Inspect the 6 V supply and the 1,000 ohm resistor.", async () => {
    await expect(panel.getByRole("spinbutton", { name: "Supply value", exact: true })).toHaveValue("6");
    await recorder.move(panel.getByRole("spinbutton", { name: "Supply value", exact: true }));
    await recorder.hold(1);
    await recorder.move(selected);
    await selected.selectOption("R1");
    await expect(panel.getByRole("spinbutton", { name: "R1 value", exact: true })).toHaveValue("1000");
    await recorder.hold(2);
  });
  await recorder.chapter("4. Mock baseline: 6 V / 1,000 ohms = 6 mA.", async () => {
    await recorder.click(panel.getByRole("tab", { name: "Readings", exact: true }));
    await expect(readings.getByText("6 V", { exact: true })).toBeVisible();
    await expect(readings.getByText("6 mA", { exact: true })).toBeVisible();
    await expect(readings.getByText("-6 mA", { exact: true })).toBeVisible();
    await recorder.hold(3);
  });
  await recorder.chapter("5. Double R1 to 2,000 ohms, then run the local mock again.", async () => {
    await recorder.click(panel.getByRole("tab", { name: "Components", exact: true }));
    const resistance = panel.getByRole("spinbutton", { name: "R1 value", exact: true });
    await recorder.click(resistance);
    await resistance.fill("2000");
    await expect(resistance).toHaveValue("2000");
    await expect(panel.getByText("Changes not simulated", { exact: true })).toBeVisible();
    await expect(panel.getByTestId("circuit-visualization").locator("[data-wire-id]")).toHaveCount(0);
    await recorder.hold(1);
    await recorder.click(panel.getByRole("button", { name: "Run", exact: true }));
    await expect(panel.getByText("Simulation complete", { exact: true })).toBeVisible();
    await expect.poll(() => session.runs.length).toBe(1);
    assert.equal(session.runs[0].components.find((part) => part.id === "R1").value, 2000);
    await recorder.click(panel.getByRole("tab", { name: "Readings", exact: true }));
    await expect(readings.getByText("3 mA", { exact: true })).toBeVisible();
    await recorder.hold(1);
  });
  await recorder.chapter("6. Mock result: 6 V / 2,000 ohms = 3 mA, half the current.", async () => {
    await expect(readings.getByText("6 V", { exact: true })).toBeVisible();
    await expect(readings.getByText("-3 mA", { exact: true })).toBeVisible();
    await expect(readings.getByText("6 mA", { exact: true })).toHaveCount(0);
    await expect(panel.locator('output[aria-label="Selected branch current"]')).toHaveText("3 mA");
    await recorder.move(readings.getByText("3 mA", { exact: true }));
    await recorder.hold(4);
    recorder.posterTime = Math.max(0, recorder.frames / 12 - 1);
  });
}

export const artifactDemos = [
  {
    id: "slides",
    name: "shiksha-slides-tutorial",
    title: "Explore an interactive slide deck",
    role: "student",
    description: "Request an original Ohm's-law deck, browse real slides and speaker notes, and present a worked comparison before returning to the course.",
    async setup({ demo }) { enableArtifact(demo, "slides"); },
    run: runSlides,
  },
  {
    id: "circuits",
    name: "shiksha-circuit-tutorial",
    title: "Experiment in the Circuit Lab",
    role: "student",
    description: "Inspect a hypothetical 6 V resistor circuit, double its resistance, and compare explicitly mocked Ohm's-law readings: 6 mA becomes 3 mA.",
    async setup({ demo }) {
      enableArtifact(demo, "circuit");
      const session = { runs: [] };
      circuitSessions.set(demo, session);
      demo.addApiHandler(async ({ path, method, request }) => {
        if (path !== `/api/agents/${agentId}/circuit/simulate` || method !== "POST") return undefined;
        const spec = request.postDataJSON().circuit;
        const result = mockCircuitResult(spec);
        session.runs.push(structuredClone(spec));
        return { json: result, status: 200 };
      });
    },
    run: runCircuit,
  },
];
