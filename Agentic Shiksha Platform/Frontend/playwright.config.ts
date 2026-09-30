import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 4175);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid PLAYWRIGHT_PORT");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testMatch: ["config.spec.ts", "share-ta.spec.ts", "chat-persistence.spec.ts", "chat-response.spec.ts", "slides.spec.ts", "presentation-editor.spec.ts", "presentation-player.spec.ts", "presentation-narration.spec.ts", "companion-animations.spec.ts", "learner-profile.spec.ts", "learner-memory.spec.ts"],
  workers: 1,
  reporter: "list",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results",
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    timeout: 120_000,
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort --mode test`,
    url: baseURL,
    reuseExistingServer: false,
    env: {
      VITE_API_BASE_URL: baseURL,
      VITE_API_URL: baseURL,
      VITE_DASHBOARD_API_URL: baseURL,
    },
  },
});