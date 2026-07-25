import { defineConfig, devices } from "@playwright/test";

const PREVIEW_URL = "http://127.0.0.1:4173";
const MOBILE_EXPERIENCE_SPECS = ["reflow.spec.ts", "touch-targets.spec.ts"];

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: 1,
  webServer: {
    // `--mode test` loads the committed .env.test so the build boots with a dummy
    // public client id in CI (where the real, gitignored .env is absent).
    command:
      "pnpm exec vite build --mode test && pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: PREVIEW_URL,
    // Always spawn a fresh build+preview so the gate can never pass against a
    // stale or unrelated server already listening on 4173.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: PREVIEW_URL,
    trace: "on-first-retry",
    // The Calendar and Diary group by the viewer's *device* timezone
    // (`localTimeZone()`). Pin the browser to a fixed non-UTC zone so day-boundary
    // grouping is deterministic on any host: the fixtures are authored against it.
    timezoneId: "America/New_York",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      testMatch: MOBILE_EXPERIENCE_SPECS,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-webkit",
      testMatch: MOBILE_EXPERIENCE_SPECS,
      use: { ...devices["iPhone 15"] },
    },
  ],
});
