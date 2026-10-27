import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "core",
    environment: "node",
    env: { TZ: "Pacific/Kiritimati" },
    globals: true,
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
