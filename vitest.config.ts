import { defineConfig } from "vitest/config";
import coverageScope from "./scripts/core-coverage-scope.json" with { type: "json" };

export default defineConfig({
  test: {
    // Named rather than globbed: `packages/native` is a jest-expo package, and a
    // glob would hand its `__tests__` to Vitest, which has no React Native
    // runtime and reports the suite as a failure rather than as not its job.
    projects: ["packages/core", "test"],
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      ...coverageScope,
    },
  },
});
