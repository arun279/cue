import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.join(import.meta.dirname, "../../../..");

const MANIFESTS = [
  "package.json",
  "packages/core/package.json",
  "packages/web/package.json",
  "packages/native/package.json",
];

type Manifest = Record<
  "dependencies" | "devDependencies" | "peerDependencies",
  Record<string, string> | undefined
>;

const declarations = (file: string): [string, string][] => {
  const manifest = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")) as Manifest;
  return [
    ...Object.entries(manifest.dependencies ?? {}),
    ...Object.entries(manifest.devDependencies ?? {}),
    ...Object.entries(manifest.peerDependencies ?? {}),
  ];
};

/**
 * One range per package across the whole workspace, compared as the exact
 * string. `nodeLinker: hoisted` puts one copy of each resolved version at the
 * workspace root and nests the rest, and which copy a third-party peer
 * dependency binds to is then pnpm's choice rather than anyone's: two ranges for
 * `react` that a Radix package's peer both satisfy is enough to give the web
 * app's renderer a different React instance than its component library, which
 * surfaces as `Cannot read properties of null (reading 'useId')` in a suite that
 * has nothing to do with either declaration.
 *
 * The exact string rather than range intersection, because two ranges that
 * overlap today can resolve apart tomorrow, and because the fix is always the
 * same one line.
 */
describe("a dependency two packages share", () => {
  it("is declared at the same version by every one of them", () => {
    const ranges = new Map<string, Map<string, string[]>>();
    for (const file of MANIFESTS) {
      for (const [name, range] of declarations(file)) {
        const byRange = ranges.get(name) ?? new Map<string, string[]>();
        byRange.set(range, [...new Set([...(byRange.get(range) ?? []), file])]);
        ranges.set(name, byRange);
      }
    }

    const disagreements = [...ranges]
      .filter(([, byRange]) => byRange.size > 1)
      .map(
        ([name, byRange]) =>
          `${name}: ${[...byRange].map(([range, files]) => `${range} (${files.join(", ")})`).join(" vs ")}`,
      );

    expect(disagreements).toEqual([]);
  });
});
