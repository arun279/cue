import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Named rather than globbed: `packages/native` is a jest-expo package, and a
    // glob would hand its `__tests__` to Vitest, which has no React Native
    // runtime and reports the suite as a failure rather than as not its job.
    projects: ["packages/core", "test"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Stated as what the line gate covers rather than as what it lets through.
      include: ["packages/core/src/**"],
      exclude: ["**/*.d.ts", "packages/core/src/app/**"],
      thresholds: {
        // Global floor = rot tripwire, not the quality bar. Logic layers carry
        // the real gate below; native behavior has its own Jest and Maestro gates.
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
