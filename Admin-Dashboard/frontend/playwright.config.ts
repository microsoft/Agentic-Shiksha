import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4184";
const assignmentsEnabled = process.env.PLAYWRIGHT_STUDENT_ASSIGNMENTS_ENABLED !== "false";

export default defineConfig({
  testMatch: ["overview.spec.ts", assignmentsEnabled ? "studentAssignments.spec.ts" : "studentAssignmentsDisabled.spec.ts"],
  outputDir: "node_modules/.cache/playwright-results",
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4184 --strictPort --mode test",
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      // A distinct main-backend origin and /api suffix exercise credentialed routing.
      VITE_API_BASE_URL: "http://127.0.0.1:4185/api/",
      VITE_API_URL: baseURL,
      VITE_DASHBOARD_API_URL: baseURL,
      VITE_STUDENT_ASSIGNMENTS_ENABLED: String(assignmentsEnabled),
    },
  },
});