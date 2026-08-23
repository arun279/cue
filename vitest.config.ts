import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Stated as what the line gate covers rather than as what it lets through.
      // Every composition root (both `src/app` directories) and every
      // presentational surface (`web/src/ui`) is gated by the hermetic Playwright
      // suite instead; `web/src/ui/prefs` is in because it is the preferences
      // adapter rather than a screen, and sits under `ui` only because it is read
      // at module scope, before React exists (ui-no-platform-impl).
      include: [
        "packages/core/src/**",
        "packages/web/src/platform/**",
        "packages/web/src/ui/prefs/**",
      ],
      exclude: ["**/*.d.ts", "packages/core/src/app/**"],
      thresholds: {
        // Global floor = rot tripwire, not the quality bar. Logic layers carry
        // the real gate below; ui/ behavior is gated by the Playwright suite.
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
        "packages/core/src/domain/**": { lines: 90, functions: 90, statements: 90, branches: 80 },
        "packages/core/src/data/**": { lines: 90, functions: 90, statements: 90, branches: 80 },
        "packages/core/src/prefs/**": { lines: 90, functions: 90, statements: 90, branches: 80 },
        "packages/core/src/url/**": { lines: 90, functions: 90, statements: 90, branches: 80 },
        "packages/core/src/stores/**": { lines: 90, functions: 90, statements: 90, branches: 80 },
        // A ratchet, not a target: the hook layer has never been inside a
        // coverage number, so this is what it measured on the commit that
        // moved it. It may go up and never down.
        "packages/core/src/hooks/**": { lines: 54, functions: 52, statements: 53, branches: 42 },
      },
    },
  },
});
