import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const check = (...modules: string[]) => {
  const atlas = path.join(tempDirectory("cue-store-bundle-"), "atlas.jsonl");
  const bundle = ["ios", "/repo", "/repo", "entry.js", "client"];
  const graph = modules.map((relativePath, id) => ({ id, relativePath }));
  writeFileSync(
    atlas,
    `${JSON.stringify({ name: "expo-atlas" })}\n${JSON.stringify([...bundle, graph])}\n`,
  );
  return spawnSync(process.execPath, [repositoryPath("scripts/check-store-bundle.mjs"), atlas], {
    encoding: "utf8",
  });
};

it("passes a store graph without the test clock", () => {
  expect(check("app/_layout.tsx", "entry.ts").status).toBe(0);
});

it("fails a graph that ships the test clock", () => {
  const result = check("entry.ts", "src/shifted-date.ts");

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("ios: src/shifted-date.ts");
});
