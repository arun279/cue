import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const tree = (files: Readonly<Record<string, string>>): string => {
  const root = tempDirectory("cue-complexity-tree-");
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
  return root;
};

const measure = (root: string): unknown =>
  JSON.parse(
    execFileSync(process.execPath, [repositoryPath("scripts/measure-complexity.mjs"), root], {
      encoding: "utf8",
    }),
  );

it("scores the most complex function in product code only", () => {
  const root = tree({
    "packages/core/src/branch.ts":
      "export function branch(a: number): number {\n  switch (a) {\n    case 1:\n      return 1;\n    case 2:\n      return 2;\n    case 3:\n      return 3;\n  }\n  return 0;\n}\n",
    "packages/native/src/nested.ts":
      "export function nested(a: number, b: number): number {\n  if (a > 0) {\n    if (b > 0) return 1;\n  }\n  return 0;\n}\n",
    "test/ci/ignored.test.ts":
      "export const ignored = (a: number) => (a > 0 ? (a > 1 ? (a > 2 ? (a > 3 ? 4 : 3) : 2) : 1) : 0);\n",
  });

  expect(measure(root)).toEqual({ cyclomatic: 4, cognitive: 3 });
});

it("scores a tree with no product code as zero", () => {
  expect(measure(tree({ "test/ci/only.test.ts": "export const only = 1;\n" }))).toEqual({
    cyclomatic: 0,
    cognitive: 0,
  });
});
