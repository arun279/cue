import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { describe, expect, it } from "vitest";

// Vitest is only ever invoked from the repository root (the `test` script in
// package.json), so process.cwd() is the anchor rather than import.meta.url,
// which this loader does not resolve to a file: URL.
const REPOSITORY_ROOT = process.cwd();
const MOBILE_RELEASE_WORKFLOW = path.join(REPOSITORY_ROOT, ".github/workflows/mobile-release.yml");

const SHIPS = [
  "src/**/!(*.md)",
  "index.html",
  "public/**/!(*.md)",
  "vite.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "capacitor.config.ts",
  "android/**/!(*.md)",
  "ios/**/!(*.md)",
  "fastlane/**/!(*.md)",
  "Gemfile",
  "Gemfile.lock",
  ".nvmrc",
  ".ruby-version",
  "scripts/verify-apk-version.sh",
  "tsconfig.json",
] as const;

const DOES_NOT_SHIP = [
  "docs/**",
  "**/*.md",
  ".github/**",
  "LICENSE",
  "e2e/**",
  "test/**",
  "playwright.config.ts",
  "vitest.config.ts",
  "lefthook.yml",
  "cspell.json",
  "dprint.json",
  "biome.jsonc",
  "knip.json",
  ".jscpd.json",
  ".dependency-cruiser.cjs",
  ".env.example",
  ".env.test",
  ".gitignore",
  "assets/**",
] as const;

// Picomatch uses { dot: true }; GitHub path filters differ around ** and leading slashes, so this guard does not claim exact parity.
const MATCH_OPTIONS = { dot: true };

type PatternMatcher = {
  pattern: string;
  matches: (file: string) => boolean;
};

const compilePatterns = (patterns: readonly string[]): PatternMatcher[] =>
  patterns.map((pattern) => ({
    pattern,
    matches: picomatch(pattern, MATCH_OPTIONS),
  }));

const SHIP_MATCHERS = compilePatterns(SHIPS);
const DOES_NOT_SHIP_MATCHERS = compilePatterns(DOES_NOT_SHIP);

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: REPOSITORY_ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const matchingPatterns = (file: string, matchers: PatternMatcher[]): string[] =>
  matchers.filter(({ matches }) => matches(file)).map(({ pattern }) => pattern);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const readPathsIgnore = (): string[] => {
  const workflow = readFileSync(MOBILE_RELEASE_WORKFLOW, "utf8");

  // This intentionally parses only paths-ignore's JSON-compatible bracket array
  // (dprint may fold it onto one line or wrap it, trailing comma included), not
  // general YAML.
  const matches = [...workflow.matchAll(/ {4}paths-ignore:\s*(\[[^\]]*\])/g)];
  const raw = matches.length === 1 ? matches[0]?.[1] : undefined;
  const encoded = raw?.replace(/,(\s*])/g, "$1");
  if (encoded === undefined) {
    throw new Error(`expected one inline paths-ignore array, found ${matches.length}`);
  }

  const parsed: unknown = JSON.parse(encoded);
  if (!isStringArray(parsed)) {
    throw new Error("paths-ignore must be an array of strings");
  }
  return parsed;
};

describe("mobile release path partition", () => {
  it("classifies every tracked file", () => {
    const unmatched = trackedFiles.filter(
      (file) =>
        matchingPatterns(file, SHIP_MATCHERS).length === 0 &&
        matchingPatterns(file, DOES_NOT_SHIP_MATCHERS).length === 0,
    );

    expect(unmatched, `Unclassified tracked files:\n${unmatched.join("\n")}`).toEqual([]);
  });

  it("does not classify any tracked file both ways", () => {
    const overlaps = trackedFiles.flatMap((file) => {
      const ships = matchingPatterns(file, SHIP_MATCHERS);
      const doesNotShip = matchingPatterns(file, DOES_NOT_SHIP_MATCHERS);
      return ships.length > 0 && doesNotShip.length > 0 ? [{ file, ships, doesNotShip }] : [];
    });
    const details = overlaps
      .map(
        ({ file, ships, doesNotShip }) =>
          `${file}\n  SHIPS: ${ships.join(", ")}\n  DOES_NOT_SHIP: ${doesNotShip.join(", ")}`,
      )
      .join("\n");

    expect(overlaps, `Tracked files matching both partitions:\n${details}`).toEqual([]);
  });

  it("keeps paths-ignore aligned with non-shipping paths", () => {
    expect([...readPathsIgnore()].sort()).toEqual([...DOES_NOT_SHIP].sort());
  });
});
