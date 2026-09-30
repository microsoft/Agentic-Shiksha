import assert from "node:assert/strict";
import { installDemo } from "./platform-demo.mjs";

const sessions = new WeakMap();
const interests = "Science puzzles, drawing and learning how things work.";

export const onboardingDemo = {
  id: "onboarding-profile",
  name: "shiksha-onboarding-profile-tutorial",
  title: "Set up your learner profile",
  role: "student",
  startPath: "/onboarding",
  description: "Complete the actual first-run onboarding, review the saved profile in Settings, update a detail and begin a course.",
  installDemo: (context, baseURL, role) => installDemo(context, baseURL, role, { onboardingCompleted: false }),
  async setup({ demo }) {
    const session = {
      writes: [],
      profile: {
        ...demo.account, id: demo.account.userId, fullName: demo.account.displayName,
        nickname: "", language: "", currentLocation: "", passionateAbout: "",
        onboardingCompleted: false, status: "invited", college: "", department: "",
      },
    };
    sessions.set(demo, session);
    demo.addApiHandler(async ({ path, method, request }) => {
      if (path !== `/api/user/${demo.account.userId}` || !["GET", "PUT"].includes(method)) return undefined;
      if (method === "PUT") {
        const body = request.postDataJSON();
        assert(!Object.hasOwn(body, "role") && !Object.hasOwn(body, "id"), "The demo may update profile fields, not account identity or role");
        session.writes.push(structuredClone(body));
        Object.assign(session.profile, body);
        session.profile.status = session.profile.onboardingCompleted ? "active" : "invited";
      }
      return { json: { success: true, profile: session.profile } };
    });
  },
  async ready({ page, expect }) {
    await expect(page.getByPlaceholder("A name or nickname you prefer", { exact: true })).toBeVisible({ timeout: 30000 });
  },
  async run({ page, demo, recorder, expect, helpers }) {
    const session = sessions.get(demo);
    assert(session);
    async function openSettings() {
      await recorder.click(page.getByRole("button", { name: "User Menu", exact: true }));
      await recorder.click(page.getByRole("menuitem", { name: "Settings", exact: true }));
      await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    }

    await recorder.chapter("01  Begin after sign-in and choose the name you want your tutor to use.", async () => {
      await recorder.hold(1.7);
      await recorder.type(page.getByPlaceholder("A name or nickname you prefer", { exact: true }), "Asha", 1);
      await recorder.hold(0.7);
      await recorder.click(page.getByRole("button", { name: "Next", exact: true }));
    });
    await recorder.chapter("02  Add a hometown and a familiar language for a more personal profile.", async () => {
      await recorder.type(page.getByPlaceholder(/^e.g. Bengaluru/), "Mysuru", 1);
      await recorder.click(page.getByRole("button", { name: "Next", exact: true }));
      await recorder.type(page.getByPlaceholder(/^e.g. Hindi/), "Kannada", 1.1);
      await recorder.hold(0.6);
      await recorder.click(page.getByRole("button", { name: "Next", exact: true }));
    });
    await recorder.chapter("03  Share your interests and finish the first-run setup.", async () => {
      await recorder.type(page.getByRole("textbox"), interests, 2.5);
      await recorder.hold(1);
      await recorder.click(page.getByRole("button", { name: /^Let's\s*Go$/ }));
      await expect.poll(() => session.profile.onboardingCompleted).toBe(true);
      await expect(page.getByRole("button", { name: "Library", exact: true })).toBeVisible();
      assert.equal(session.profile.nickname, "Asha");
      assert.equal(session.profile.currentLocation, "Mysuru");
      assert.equal(session.profile.language, "Kannada");
      assert.equal(session.profile.passionateAbout, interests);
      await recorder.hold(1.5);
    });
    await recorder.chapter("04  Open Settings to review the profile saved during onboarding.", async () => {
      await openSettings();
      await expect(page.getByPlaceholder("What should we call you?", { exact: true })).toHaveValue("Asha");
      await expect(page.getByPlaceholder(/^e.g. English, Hindi/)).toHaveValue("Kannada");
      await expect(page.getByPlaceholder(/^e.g. Bangalore, Delhi/)).toHaveValue("Mysuru");
      await recorder.hold(2.3);
      recorder.posterTime = recorder.frames / 12 - 1;
    });
    await recorder.chapter("05  Update a profile detail, then save and verify the confirmed value.", async () => {
      const location = page.getByPlaceholder(/^e.g. Bangalore, Delhi/);
      await recorder.click(location);
      await location.fill("");
      await recorder.type(location, "Bengaluru", 1.5);
      await recorder.click(page.getByRole("button", { name: "Save", exact: true }));
      await expect.poll(() => session.profile.currentLocation).toBe("Bengaluru");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
      await recorder.hold(1.6);
    });
    await recorder.chapter("06  Return to the library and begin learning with four course starters.", async () => {
      await recorder.click(page.getByRole("complementary").first().getByRole("button", { name: "Library", exact: true }));
      await helpers.openCourse();
      await recorder.hold(2.6);
    });
    assert(session.writes.some((body) => body.onboardingCompleted === true && body.currentLocation === "Mysuru"));
    assert(session.writes.some((body) => body.currentLocation === "Bengaluru"));
    assert.equal(session.profile.nickname, "Asha");
    assert.equal(session.profile.language, "Kannada");
    assert.equal(session.profile.status, "active");
    return {
      feature: "onboarding-profile",
      completedOnboarding: true,
      savedProfile: {
        nickname: session.profile.nickname, language: session.profile.language,
        currentLocation: session.profile.currentLocation, passionateAbout: session.profile.passionateAbout,
      },
      writesVerified: session.writes.length,
      provenance: "Fresh synthetic signed-in learner; onboarding and profile writes are intercepted in memory, not persisted to a real account.",
    };
  },
};
