import { expect, test } from "@playwright/test";
import { parseChatResponse } from "./src/features/chat/chatResponse";
import {
  BASE_TICK_INTERVAL_MS,
  getAdaptiveCharsPerTick,
  nextGenerationId,
  TOOL_STATUS_LABELS,
} from "./src/features/chat/generationLifecycle";

test.describe("chat response normalization", () => {
  test("extracts a fenced response and title", () => {
    expect(parseChatResponse('```json\n{"title":"Voltage","response":"A potential difference."}\n```')).toEqual({
      title: "Voltage",
      response: "A potential difference.",
    });
  });

  test("preserves text following a leading JSON response", () => {
    expect(parseChatResponse('{"title":"Safety","response":"Use PPE {always}."}\nTeacher note')).toEqual({
      title: "Safety",
      response: "Use PPE {always}.\n\nTeacher note",
    });
  });

  test("accepts the legacy json prefix", () => {
    expect(parseChatResponse('json {"response":"Legacy payload"}')).toEqual({
      title: null,
      response: "Legacy payload",
    });
  });

  test("returns malformed and plain responses unchanged", () => {
    for (const text of ['{"response":', "Ordinary prose"]) {
      expect(parseChatResponse(text)).toEqual({ title: null, response: text });
    }
  });
});

test.describe("generation lifecycle policy", () => {
  test("keeps typing cadence and acceleration bounded", () => {
    expect(BASE_TICK_INTERVAL_MS).toBe(12);
    expect(getAdaptiveCharsPerTick(100, 0)).toBe(2);
    expect(getAdaptiveCharsPerTick(1000, 1000)).toBe(8);
    expect(getAdaptiveCharsPerTick(10000, 0)).toBe(15);
  });

  test("allocates monotonically increasing generation identifiers", () => {
    const first = nextGenerationId();
    expect(nextGenerationId()).toBe(first + 1);
  });

  test("keeps user-visible tool labels stable", () => {
    expect(TOOL_STATUS_LABELS.add_slides).toBe("Creating slide deck");
    expect(TOOL_STATUS_LABELS.ask_clarification).toBe("Generating clarification questions");
    expect(TOOL_STATUS_LABELS.memory_search).toBe("Searching your memories");
  });
});
