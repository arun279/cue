import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "repository",
    environment: "node",
    include: ["ci/**/*.test.ts"],
  },
});
