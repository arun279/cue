import { defineConfig } from "vitest/config";

// Git exports GIT_DIR and friends into the pre-push hook that runs these tests;
// a scratch repository a test creates would otherwise write to the one being pushed.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name];
}

export default defineConfig({
  resolve: { alias: { "@/": new URL("./src/", import.meta.url).pathname } },
  test: {
    // The app's own tests under __tests__ run on jest-expo, which has the React Native runtime.
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          environment: "node",
          env: { TZ: "Pacific/Kiritimati" },
          globals: true,
          include: ["test/core/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: { name: "repository", environment: "node", include: ["test/ci/**/*.test.ts"] },
      },
    ],
  },
});
