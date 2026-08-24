import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const CI_WORKFLOW = path.join(REPOSITORY_ROOT, ".github/workflows/ci.yml");
const MOBILE_RELEASE_WORKFLOW = path.join(REPOSITORY_ROOT, ".github/workflows/mobile-release.yml");
const NOT_REQUIRED = ["footprint"];

// Markdown inside a shipping tree stays in SHIPS. Vite copies public/** into
// dist verbatim, so excluding *.md by extension misclassified those files; the
// existing "when in doubt, SHIPS" rule applies to every shipping tree.
const SHIPS = [
  "src/**",
  "index.html",
  "public/**",
  "vite.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "capacitor.config.ts",
  "android/**",
  "ios/**",
  "fastlane/**",
  "Gemfile",
  "Gemfile.lock",
  ".nvmrc",
  ".ruby-version",
  "scripts/verify-apk.sh",
  "scripts/verify-bundle.sh",
  "tsconfig.json",
] as const;

const DOES_NOT_SHIP = [
  "docs/**",
  "*.md",
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
  "scripts/diff-footprint.sh",
  "scripts/mock-trakt/**",
  ".env.example",
  ".env.test",
  ".env.mock",
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

const getJobsBlock = (): string => {
  const workflow = readFileSync(CI_WORKFLOW, "utf8");

  // This intentionally parses only the top-level jobs block and its
  // two-space-indented job IDs, not general YAML.
  const matches = [
    ...workflow.matchAll(/^jobs:[ \t]*\r?\n([\s\S]*?)(?=^[^ \t\r\n#][^:\r\n]*:|(?![\s\S]))/gm),
  ];
  const jobsBlock = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (jobsBlock === undefined) {
    throw new Error(`expected one jobs block, found ${matches.length}`);
  }
  return jobsBlock;
};

type CiJob = {
  name: string;
  body: string;
};

const readCiJobs = (): CiJob[] => {
  const jobsBlock = getJobsBlock();
  const headers = [...jobsBlock.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(?:#.*)?\r?$/gm)];
  return headers.map((header, index) => ({
    name: header[1] as string,
    body: jobsBlock.slice(
      (header.index ?? 0) + header[0].length,
      headers[index + 1]?.index ?? jobsBlock.length,
    ),
  }));
};

const readRequiredChecks = (): string[] => {
  const workflow = readFileSync(MOBILE_RELEASE_WORKFLOW, "utf8");
  const matches = [...workflow.matchAll(/^ {10}REQUIRED:[ \t]*'(\[[^\]]*\])'[ \t]*$/gm)];
  const raw = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (raw === undefined) {
    throw new Error(`expected one REQUIRED JSON array, found ${matches.length}`);
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isStringArray(parsed)) {
    throw new Error("REQUIRED must be an array of strings");
  }
  return parsed;
};

describe("mobile release path partition", () => {
  it("uses only path pattern syntax shared with GitHub Actions", () => {
    for (const pattern of [...SHIPS, ...DOES_NOT_SHIP]) {
      const character = [...pattern].find((candidate) => "?[]!+@(){}".includes(candidate));
      expect(
        character,
        `Unsafe path pattern "${pattern}": character "${character}" differs between picomatch and GitHub Actions`,
      ).toBeUndefined();
    }
  });

  it("classifies every tracked file", () => {
    const unmatched = trackedFiles.filter(
      (file) =>
        matchingPatterns(file, SHIP_MATCHERS).length === 0 &&
        matchingPatterns(file, DOES_NOT_SHIP_MATCHERS).length === 0,
    );

    expect(
      unmatched,
      `Unclassified tracked files (add each to SHIPS unless you can show it does not enter the shipped bundle, then update mobile-release.yml's paths-ignore to match):\n${unmatched.join("\n")}`,
    ).toEqual([]);
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

describe("the iOS toolchain pin", () => {
  const selectedXcode = (workflow: string): string[] =>
    [...readFileSync(workflow, "utf8").matchAll(/xcode-select -s (\S+)/g)].flatMap(
      (match) => match[1] ?? [],
    );

  it("is the same Xcode in the CI build and the release archive", () => {
    // ci.yml's ios job exists to compile what mobile-release.yml archives. Two
    // toolchains would make it a green check for a build nobody ships, and the
    // pin is deliberate: the runner image's default Xcode moves on its own.
    const release = selectedXcode(MOBILE_RELEASE_WORKFLOW);

    expect(release).toHaveLength(1);
    expect(selectedXcode(CI_WORKFLOW)).toEqual(release);
  });
});

describe("mobile release gate required checks", () => {
  it("keeps REQUIRED aligned with CI jobs except explicit exemptions", () => {
    const requiredJobs = readCiJobs().filter((job) => !NOT_REQUIRED.includes(job.name));
    expect([...readRequiredChecks()].sort()).toEqual(requiredJobs.map((job) => job.name).sort());
  });

  it("uses CI job IDs as check-run names", () => {
    const requiredChecks = new Set(readRequiredChecks());
    const unsupportedOverrides = readCiJobs()
      .filter((job) => requiredChecks.has(job.name))
      .flatMap((job) =>
        job.body.split(/\r?\n/).filter((line) => /^ {4}(?:name|strategy|if):/.test(line)),
      );

    expect(
      unsupportedOverrides,
      "A job-level name or strategy (matrix) override means the check-run name no longer equals the job ID, while a job-level if can give it a skipped conclusion, which the release gate treats as a failure. Update the gate's REQUIRED list and the polling logic in mobile-release.yml to handle real check-run names or skipped conclusions before adding the override.",
    ).toEqual([]);
  });
});
