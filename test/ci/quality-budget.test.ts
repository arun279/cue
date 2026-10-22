import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const budget = (files: Record<string, string>) => {
  const root = tempDirectory("cue-quality-budget-");
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: root, env: gitEnv() });
  execFileSync("git", ["add", "."], { cwd: root, env: gitEnv() });
  return spawnSync(process.execPath, [repositoryPath("scripts/check-quality-budget.mjs"), root], {
    encoding: "utf8",
    env: gitEnv(),
  });
};

it("passes product and test code with no suppressions", () => {
  const result = budget({
    "packages/core/src/day.ts": "export const one = 1;\n",
    "packages/native/__tests__/day.test.ts": "export const two = 2;\n",
  });

  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

it.each([
  [
    "a complexity suppression in product code",
    "packages/core/src/a.ts",
    "// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: x\n",
  ],
  [
    "an oxlint disable in product code",
    "packages/native/src/a.tsx",
    "// oxlint-disable-next-line\n",
  ],
  ["a type suppression in a test", "packages/native/__tests__/a.test.ts", "// @ts-expect-error\n"],
  ["a type suppression in product code", "packages/core/src/a.ts", "// @ts-ignore\n"],
])("fails %s", (_, file, source) => {
  expect(budget({ [file]: source }).status).toBe(1);
});
