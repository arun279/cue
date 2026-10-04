import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const check = (...modules: string[]) => {
  const atlas = path.join(tempDirectory("cue-store-bundle-"), "atlas.jsonl");
  const bundle = ["ios", "/repo/packages/native", "/repo", "entry.js", "client"];
  const graph = modules.map((relativePath, id) => ({ id, relativePath }));
  writeFileSync(
    atlas,
    `${JSON.stringify({ name: "expo-atlas" })}\n${JSON.stringify([...bundle, graph])}\n`,
  );
  return spawnSync(process.execPath, [repositoryPath("scripts/check-store-bundle.mjs"), atlas], {
    encoding: "utf8",
  });
};

it("passes a store graph that resolved the harness to its stand-in", () => {
  expect(
    check("packages/native/app/_layout.tsx", "packages/native/src/ui/harness.store.ts").status,
  ).toBe(0);
});

it.each([
  "packages/native/src/ui/harness.tsx",
  "packages/native/src/ui/harness-ids.ts",
  "packages/native/src/ui/AppIdle.tsx",
  "packages/native/src/ui/response-timing.ts",
])("fails a graph that ships %s", (module) => {
  const result = check("packages/native/app/_layout.tsx", module);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`ios: ${module}`);
});
