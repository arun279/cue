import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/src/**"],
      // The composition root (src/app) and every presentational surface (src/ui)
      // are gated by the hermetic Playwright suite, not a line threshold
      // Line coverage targets the logic layers below.
      exclude: [
        "**/*.d.ts",
        "packages/web/src/app/**",
        "packages/web/src/ui/**",
        // The composition root, as src/app has always been. The ports beside it
        // in core/src/runtime are library code both targets run, so they are in.
        "packages/core/src/app/**",
      ],
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
