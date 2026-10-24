import { defineConfig } from "vitest/config";

// Git exports GIT_DIR and friends into the pre-push hook that runs these tests;
// a scratch repository a test creates would otherwise write to the one being pushed.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name];
}

export default defineConfig({
  test: {
    name: "repository",
    environment: "node",
    include: ["ci/**/*.test.ts"],
  },
});
