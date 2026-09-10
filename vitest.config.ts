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
        "packages/core/src/auth/**": {
          lines: 50.58,
          functions: 52.63,
          statements: 47.95,
          branches: 45.45,
        },
        "packages/core/src/hooks/**": {
          lines: 72.89,
          functions: 66.89,
          statements: 70.86,
          branches: 56.61,
        },
        "packages/core/src/migration/**": {
          lines: 97.5,
          functions: 100,
          statements: 95.34,
          branches: 88.88,
        },
        "packages/core/src/ports/**": {
          lines: 86.84,
          functions: 93.1,
          statements: 87.5,
          branches: 100,
        },
        "packages/core/src/queries/**": {
          lines: 43.47,
          functions: 31.57,
          statements: 44.06,
          branches: 45.45,
        },
        "packages/core/src/runtime/**": {
          lines: 100,
          functions: 100,
          statements: 95.65,
          branches: 80,
        },
      },
    },
  },
});
