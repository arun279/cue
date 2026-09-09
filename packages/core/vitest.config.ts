import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

const webSource = (path: string): string =>
  fileURLToPath(new URL(`../web/src/${path}`, import.meta.url));

export default defineConfig({
  envDir: fileURLToPath(new URL("../web", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@ui": webSource("ui"),
      "@app": webSource("app"),
      "@platform": webSource("platform"),
    },
  },
  test: {
    name: "core",
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
