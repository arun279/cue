import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["*.fixture.ts"],
    reporters: [
      "default",
      fileURLToPath(new URL("../../../support/stall-guard.ts", import.meta.url)),
    ],
  },
});
