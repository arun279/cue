import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const allowlist: string[] = [];
type Patterns = readonly (readonly [RegExp, string])[];
const retries: Patterns = [
  [/--retry(?:\b|=)/, "retry flag"],
  [/\bretry["']?\s*:(?!\s*false\b)/, "retry option"],
  [/\bretryTimes\s*\(/, "jest retryTimes"],
];
const matches = (text: string, patterns: Patterns): string[] =>
  patterns.flatMap(([pattern, label]) =>
    [...text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].map(() => label),
  );
const masks = (source: string): string[] => {
  const text = source.replace(/^\s*#.*$/gm, "");
  const violations = matches(text, [
    ...retries,
    [/\bretryTapIfNoChange["']?\s*:/, "retryTapIfNoChange"],
    [/\boptional["']?\s*:\s*true\b/, "optional assertion"],
    [/(?:^|[;&|]|\bdo\s)\s*(?:\w+=\S+\s+)*sleep\s/m, "shell sleep"],
    [/\bgh\s+run\s+watch\b/, "run watch"],
    [/\brepeat:[\s\S]*\brunFlow:/, "flow rerun"],
    [/\bcontinue-on-error\s*:(?!\s*false\b)/, "continue-on-error"],
  ]);
  const invocation =
    /(?:^|[;&|]|\b(?:do|then)\s)\s*(?:if\s+!?\s*)?(?:maestro\s+(?:test\b|--device\b|"\$@")|(?:bash\s+)?scripts\/maestro-test\.sh\b)/gm;
  for (const block of text.split(/^ {2}[\w-]+:\s*$/m)) {
    if ([...block.matchAll(invocation)].length > 1) violations.push("Maestro rerun");
    for (const loop of block.matchAll(/\b(?:for|while|until)\s[^\n]*[\s\S]*?\bdone\b/g)) {
      if ([...loop[0].matchAll(invocation)].length > 0) violations.push("Maestro rerun");
    }
  }
  return violations;
};

const sources = (directories: string[]) =>
  directories.flatMap((directory) =>
    readdirSync(repositoryPath(directory), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(?:ya?ml|sh|[cm]?[jt]sx?)$/.test(file))
      .map((file) => path.posix.join(directory, file)),
  );
const scan = (names: string[], detect: (source: string) => string[]) =>
  names.flatMap((name) =>
    detect(readFileSync(repositoryPath(name), "utf8")).map((mask) => `${name}:${mask}`),
  );

it("keeps workflows, scripts and flows free of flake masks", () => {
  expect(allowlist).toEqual([]);
  expect(scan(sources([".github", "scripts", ".maestro"]), masks)).toEqual([]);
});

it("keeps both test runners from retrying a failed test", () => {
  const names = [
    ...sources(["test", "packages/core/test", "packages/native/__tests__"]).filter(
      (name) => name !== "test/ci/no-flake-masks.test.ts",
    ),
    "package.json",
    "vitest.config.ts",
    "packages/core/package.json",
    "packages/core/vitest.config.ts",
    "packages/native/package.json",
    "packages/native/jest.config.js",
  ];
  expect(scan(names, (source) => matches(source, retries))).toEqual([]);
});

it.each([
  "retryTapIfNoChange: true",
  "optional: true",
  '"optional": true',
  "while true; do sleep 1; done",
  "curl --retry 3 URL",
  "while true; do\n  sleep 1\ndone",
  "repeat:\n  commands:\n    - runFlow: app.yaml",
  "maestro test app.yaml || maestro test app.yaml",
  "for i in 1 2; do\n bash scripts/maestro-test.sh test app.yaml\ndone",
  "- retry:\n    maxRetries: 3",
  "jest.retryTimes(3);",
  "export default defineConfig({ test: { retry: 2 } });",
  'it("loads", { retry: 3 }, () => {});',
  "vitest run --retry=2",
  "continue-on-error: true",
  "continue-on-error: $" + "{{ inputs.advisory }}",
])("detects a flake mask: %s", (source) => {
  expect(masks(source).length).toBeGreaterThan(0);
});

it.each(["retry: false", "continue-on-error: false"])("accepts a disabled option: %s", (source) => {
  expect(masks(source)).toEqual([]);
});

it("accepts command-completion readiness probes with a single watchdog and no delay", () => {
  const source = readFileSync(repositoryPath("scripts/wait-ios-ready.mjs"), "utf8");
  expect(masks(source)).toEqual([]);
  expect(source.match(/setTimeout\(/g)).toHaveLength(1);
  expect(source).toMatch(/while \(consecutive < 3\) \{[\s\S]*await new Promise/);
  expect(source).not.toMatch(/setInterval|sleep|node:timers/);
});
