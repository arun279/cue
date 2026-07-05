import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

const src = (path: string): string => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@domain": src("domain"),
      "@data": src("data"),
      "@ui": src("ui"),
      "@app": src("app"),
      "@platform": src("platform"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**"],
      // The composition root (src/app) and every presentational surface (src/ui)
      // are gated by the hermetic Playwright suite, not a line threshold
      // Line coverage targets the logic layers below.
      exclude: ["src/**/*.d.ts", "src/app/**", "src/ui/**"],
      thresholds: {
        // Global floor = rot tripwire, not the quality bar. Logic layers carry
        // the real gate below; ui/ behavior is gated by the Playwright suite.
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
        "src/domain/**": { lines: 90, functions: 90, statements: 90, branches: 80 },
        "src/data/**": { lines: 90, functions: 90, statements: 90, branches: 80 },
      },
    },
  },
});
