import { defineConfig, devices } from "@playwright/test";

// Vite's default preview port. Override with E2E_PREVIEW_PORT so two checkouts
// can run their suites at once on one machine instead of fighting over it.
const PREVIEW_PORT = process.env["E2E_PREVIEW_PORT"] ?? "4173";
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const MOBILE_EXPERIENCE_SPECS = [
  "reflow.spec.ts",
  "touch-targets.spec.ts",
  "viewport-zoom.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: 1,
  webServer: {
    // `--mode test` loads the committed .env.test so the build boots with a dummy
    // public client id in CI (where the real, gitignored .env is absent).
    command: `pnpm exec vite build --mode test && pnpm exec vite preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    // Always spawn a fresh build+preview so the gate can never pass against a
    // stale or unrelated server already listening on that port.
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
