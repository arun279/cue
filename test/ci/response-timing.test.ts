import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const run = (timing: string) => {
  const artifacts = tempDirectory("cue-response-timing-");
  mkdirSync(path.join(artifacts, "debug"));
  writeFileSync(path.join(artifacts, "debug/maestro.log"), `CUE_RESPONSE_TIMING=${timing}\n`);
  return spawnSync(
    process.execPath,
    [repositoryPath("scripts/check-response-timing.mjs"), artifacts, "100"],
    { encoding: "utf8" },
  );
};

it("accepts mark and undo medians within 100 ms", () => {
  expect(run("mark 99 ms, undo 100 ms").status).toBe(0);
});

it("fails either median above 100 ms", () => {
  const result = run("mark 101 ms, undo 80 ms");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("mark response 101 ms exceeds 100 ms");
});
