import { defineConfig, devices } from "@playwright/test";

// 4173 is Vite's preview default. Override with E2E_PREVIEW_PORT so two checkouts can
// run their suites at once on one machine instead of fighting over it. The value is
// interpolated into the shell command below, so reject anything that is not a port: a
// typo has to fail here rather than as a two-minute wait on a URL nothing ever bound.
const PORT_OVERRIDE = process.env["E2E_PREVIEW_PORT"];
const PREVIEW_PORT = Number(PORT_OVERRIDE ?? 4173);
if (!Number.isInteger(PREVIEW_PORT) || PREVIEW_PORT < 1 || PREVIEW_PORT > 65535) {
  throw new Error(`E2E_PREVIEW_PORT must be a port from 1 to 65535, got "${PORT_OVERRIDE}"`);
}
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const MOBILE_EXPERIENCE_SPECS = [
  "reflow.spec.ts",
  "touch-targets.spec.ts",
  "viewport-zoom.spec.ts",
];

/**
 * The equivalence lane, off by default. It is a separate project rather than a
 * rewrite of the 21 specs: those answer Trakt themselves through
 * `context.route`, with no origin for a server to stand at, and moving them onto
 * one would be the largest single change this repository could make for the
 * least reason. This lane instead drives the fake Trakt with no interception at
 * all and journals what the app asked for, so the native app can be compared
 * against the same recording rather than against its own expectations.
 *
 * Off by default because it costs a second build and two more processes on every
 * run, and the lane it exists for does not exist yet. `pnpm e2e:mock` turns it on.
 */
const MOCK_LANE = process.env["E2E_MOCK"] === "1";
// `.env.mock` is committed with this origin in it, so the mock answers here or
// the build does not reach it.
const MOCK_TRAKT_URL = "http://127.0.0.1:8787";
const MOCK_PREVIEW_PORT = PREVIEW_PORT + 1;
const MOCK_PREVIEW_URL = `http://127.0.0.1:${MOCK_PREVIEW_PORT}`;
const JOURNAL = process.env["MOCK_TRAKT_JOURNAL"] ?? "journal/journal-a.ndjson";

const mockServers = [
  {
    command: `MOCK_TRAKT_JOURNAL=${JOURNAL} node ../../scripts/mock-trakt/server.mjs`,
    url: `${MOCK_TRAKT_URL}/users/settings`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  {
    command: `pnpm exec vite build --mode mock && pnpm exec vite preview --host 127.0.0.1 --port ${MOCK_PREVIEW_PORT} --strictPort`,
    url: MOCK_PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
];

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: 1,
  // An array, so the documented caveat applies: with more than one server
  // Playwright needs an explicit baseURL, which `use` below already sets.
  webServer: [
    {
      // `--mode test` loads the committed .env.test so the build boots with a dummy
      // public client id in CI (where the real, gitignored .env is absent).
      command: `pnpm exec vite build --mode test && pnpm exec vite preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      // Always spawn a fresh build+preview so the gate can never pass against a
      // stale or unrelated server already listening on that port.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    ...(MOCK_LANE ? mockServers : []),
  ],
  use: {
    baseURL: PREVIEW_URL,
    trace: "on-first-retry",
    // The Calendar and Diary group by the viewer's *device* timezone
    // (`localTimeZone()`). Pin the browser to a fixed non-UTC zone so day-boundary
    // grouping is deterministic on any host: the fixtures are authored against it.
    timezoneId: "America/New_York",
  },
  projects: [
    { name: "chromium", testIgnore: "mock/**", use: { ...devices["Desktop Chrome"] } },
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
    ...(MOCK_LANE
      ? [
          {
            name: "mock",
            testMatch: "mock/**/*.spec.ts",
            use: { ...devices["Desktop Chrome"], baseURL: MOCK_PREVIEW_URL },
          },
        ]
      : []),
  ],
});
