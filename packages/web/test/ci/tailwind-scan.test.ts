import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const STYLES = path.join(import.meta.dirname, "../../src/ui/styles.css");
const APP_SOURCE = path.join(import.meta.dirname, "../../src");

/**
 * Tailwind v4 starts its automatic content detection at the working directory
 * the build runs in, which for this app is the whole web package: the utility
 * set was a function of prose in unit tests and Playwright specs, and the
 * shipped stylesheet moved when a comment did. Only `source()` on the import
 * moves that starting point; a bare `@source` rule adds a path and leaves
 * automatic detection running, which is what made the first attempt at this a
 * no-op that nothing could see.
 */
describe("the Tailwind scan", () => {
  it("starts at the app's own source root", () => {
    const pinned = /@import\s+"tailwindcss"\s+source\("([^"]+)"\)\s*;/.exec(
      readFileSync(STYLES, "utf8"),
    );
    expect(pinned, "the tailwindcss import must pin its scan base with source(...)").not.toBeNull();
    expect(path.resolve(path.dirname(STYLES), pinned?.[1] ?? "")).toBe(APP_SOURCE);
  });
});
