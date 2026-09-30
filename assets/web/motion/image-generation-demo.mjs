import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assetPath } from "./asset-paths.mjs";
import { agentId } from "./platform-demo.mjs";

const title = "Solar-powered irrigation";
const prompt = "Create a labeled illustration of solar-powered irrigation. Show sunlight, solar panels, a motor and pump, and water flowing to crops.";
const followup = "Explain how light becomes motion and moves water in this picture.";
const caption = "Sunlight becomes electricity, electricity drives the motor, and the pump moves water to the crops.";
const suggestions = [
  "Explain the energy changes in this picture.",
  "What happens when less sunlight reaches the panels?",
  "Why does the pump need an electric motor?",
];
const sessions = new WeakMap();

async function setup({ page, context, demo, baseURL }) {
  const svg = await readFile(assetPath("shiksha-image-generation-example.svg"), "utf8");
  assert(!/<(?:script|foreignObject|image)\b/i.test(svg), "The original fixture must be self-contained SVG artwork");
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.setContent(`<html><body style="margin:0;background:#f7faf8">${svg}</body></html>`);
  const valid = await page.evaluate((source) => {
    const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
    return parsed.querySelector("parsererror") === null
      && [...document.querySelectorAll("svg text")].every((text) => {
        const box = text.getBBox();
        return box.x >= 0 && box.y >= 0 && box.x + box.width <= 1536 && box.y + box.height <= 1024;
      });
  }, svg);
  assert(valid, "The illustration must parse and retain every label within its canvas");
  const png = await page.locator("svg").screenshot({ path: assetPath("shiksha-image-generation-example.png") });
  assert.equal(png.readUInt32BE(16), 1536);
  assert.equal(png.readUInt32BE(20), 1024);
  await page.setViewportSize({ width: 1280, height: 800 });
  const session = {
    png, imageUrl: new URL("/__tutorial-solar-irrigation.png", baseURL).href,
    imageRequests: 0, placeholderSeen: false, previewSeen: false,
  };
  sessions.set(page, session);
  await context.route(session.imageUrl, async (route) => {
    assert.equal(route.request().method(), "GET");
    session.imageRequests++;
    await route.fulfill({ contentType: "image/png", body: png });
  });
  demo.addApiHandler(async ({ path, method }) => {
    if (path === `/api/agents/${agentId}/details` && method === "GET") return { json: {
      name: agentId, found: true,
      definition: { tools: ["add_message", "generate_image"].map((name) => ({ type: "function", name })) },
    } };
    if (path === `/api/agents/${agentId}/chat/suggestions` && method === "POST") {
      return { json: { queries: suggestions } };
    }
    if (path === "/api/chat/generate-title" && method === "POST") return { json: { title } };
    return undefined;
  });
}

async function run({ page, demo, recorder, expect, helpers }) {
  const session = sessions.get(page);
  assert(session, "The image fixture must be prepared in this recording context");
  let stream;
  const image = page.getByTestId("generated-image-block").getByRole("img", { name: title, exact: true });
  const preview = page.getByRole("img", { name: "Preview", exact: true });

  await recorder.chapter("01  Open a course and explore its four conversation starters.", async () => {
    await helpers.openCourse();
    await recorder.hold(2.1);
  });
  await recorder.chapter("02  Describe the image you want, including its subject and useful labels.", async () => {
    stream = await helpers.ask(prompt, 4.2);
    await recorder.hold(0.9);
    assert.equal(await page.evaluate((index) => globalThis.tutorialStreams[index].request.text, stream), prompt);
  });
  await recorder.chapter("03  Follow the native image-generation loading state.", async () => {
    await helpers.emit({ type: "context_status", status: "ready" }, stream);
    await helpers.emit({ type: "message_block", content: "Let's make the energy pathway visible: sunlight, electricity, motion, then water flow." }, stream);
    await helpers.emit({ type: "tool_status", tool: "generate_image" }, stream);
    await helpers.emit({ type: "generated_image_start" }, stream);
    const placeholder = page.getByRole("status", { name: "Generating image", exact: true });
    await expect(placeholder).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    await recorder.move(placeholder);
    session.placeholderSeen = true;
    await recorder.hold(2.5);
  });
  await recorder.chapter("04  Review the illustration and its explanation inside the conversation.", async () => {
    await helpers.emit({
      type: "generated_image", title, imageData: session.png.toString("base64"), imageUrl: session.imageUrl,
      caption, size: "1536x1024", quality: "medium",
    }, stream);
    await helpers.finishTurn(stream);
    await expect(image).toBeVisible();
    await expect(page.getByRole("status", { name: "Generating image", exact: true })).toHaveCount(0);
    await expect.poll(() => image.evaluate((element) => [element.naturalWidth, element.naturalHeight])).toEqual([1536, 1024]);
    await expect(page.getByText(caption, { exact: true })).toBeVisible();
    await recorder.move(image);
    await recorder.hold(3);
  });
  await recorder.chapter("05  Open the native image preview to inspect the complete illustration.", async () => {
    await helpers.collapseNavigation();
    await recorder.click(page.getByTestId("generated-image-block").getByRole("button", { name: title, exact: true }));
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((element) => [element.naturalWidth, element.naturalHeight])).toEqual([1536, 1024]);
    const previewSource = await preview.getAttribute("src");
    assert([session.imageUrl, `data:image/png;base64,${session.png.toString("base64")}`].includes(previewSource),
      "The preview must display the exact synthetic tool result, not a replacement");
    session.previewSeen = true;
    await recorder.hold(5.2);
    recorder.posterTime = recorder.frames / 12 - 1;
  });
  await recorder.chapter("06  Return to chat and ask your TA to explain the image's energy flow.", async () => {
    await recorder.click(preview.locator("..").getByRole("button"));
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    const next = await helpers.ask(followup, 3.2);
    const submitted = await page.evaluate((index) => globalThis.tutorialStreams[index].request, next);
    assert.equal(submitted.text, followup);
    assert.equal(submitted.thread_id, "tutorial-conversation", "The follow-up must keep the current conversation");
    await helpers.emit({ type: "context_status", status: "ready" }, next);
    const reply = [
      "### Reading the energy flow",
      "**1. Light to electricity:** the solar panels convert some incoming sunlight into electrical energy.",
      "**2. Electricity to motion:** the electric motor turns the pump.",
      "**3. Motion to water flow:** the pump transfers energy to the water, moving it toward the crops.",
      "The illustration is conceptual, not a wiring diagram. Real systems also lose energy as heat.",
    ].join("\n\n");
    await helpers.emit({ type: "message_block_start" }, next);
    for (const paragraph of reply.split("\n\n")) {
      await helpers.emit({ type: "message_block_delta", delta: `${paragraph}\n\n` }, next);
      await recorder.hold(0.2);
    }
    await helpers.emit({ type: "message_block", content: reply }, next);
    await helpers.finishTurn(next);
    await expect(page.getByRole("heading", { name: "Reading the energy flow", exact: true })).toBeVisible();
    await recorder.hold(4);
  });
  await expect.poll(() => [...demo.messages.values()].some((message) =>
    message.metadata?.contentBlocks?.some((block) => block.type === "generated_image" && block.title === title && block.imageUrl === session.imageUrl),
  )).toBe(true);
  assert.equal(await page.evaluate(() => globalThis.tutorialStreams.length), 2);
  assert(session.placeholderSeen && session.previewSeen);
  assert(session.imageRequests > 0, "The persisted image URL must resolve through the isolated fixture");
  return {
    feature: "image-generation", nativeUI: true, tool: "generate_image",
    placeholderVerified: session.placeholderSeen, previewVerified: session.previewSeen,
    navigationCollapsedBeforeImage: true, sameConversationFollowup: true, imageInSyncedHistory: true,
    image: {
      width: 1536, height: 1024, sha256: createHash("sha256").update(session.png).digest("hex"),
      source: "Original local SVG rasterized for an isolated synthetic tool-response fixture; not live model output.",
    },
    realModelCalls: 0,
  };
}

export const imageGenerationDemo = {
  id: "image-generation", name: "shiksha-image-generation-tutorial",
  title: "Generate and explore a learning image", role: "student",
  description: "Request an illustration, follow its native loading state, open the image preview and discuss the energy flow with your course TA.",
  setup, run,
};
