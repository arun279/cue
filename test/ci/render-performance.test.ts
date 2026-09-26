import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const measurement = (count: number) =>
  `${JSON.stringify({ metadata: {} })}\n${JSON.stringify({
    name: "queue row",
    meanCount: count,
  })}\n`;

function run(currentCount = 3) {
  const directory = tempDirectory("cue-render-performance-");
  const baseline = path.join(directory, "baseline.perf");
  const current = path.join(directory, "current.perf");
  writeFileSync(baseline, measurement(3));
  writeFileSync(current, measurement(currentCount));
  return spawnSync(
    process.execPath,
    [repositoryPath("scripts/check-render-counts.mjs"), baseline, current],
    { encoding: "utf8" },
  );
}

it("keeps zero render-count deviation", () => {
  const result = run(4);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("allowed deviation of 0");
});
