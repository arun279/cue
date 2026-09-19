import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const measurement = (duration: number, count: number) =>
  `${JSON.stringify({ metadata: {} })}\n${JSON.stringify({
    name: "queue row",
    meanDuration: duration,
    meanCount: count,
  })}\n`;

function run(durationDiff: number, currentCount = 3) {
  const directory = tempDirectory("cue-render-performance-");
  const baseline = path.join(directory, "baseline.perf");
  const current = path.join(directory, "current.perf");
  const comparison = path.join(directory, "output.json");
  writeFileSync(baseline, measurement(5, 3));
  writeFileSync(current, measurement(5 + durationDiff, currentCount));
  writeFileSync(
    comparison,
    JSON.stringify({
      significant: [{ name: "queue row", durationDiff }],
    }),
  );
  return spawnSync(
    process.execPath,
    [repositoryPath("scripts/check-render-counts.mjs"), baseline, current, comparison],
    { encoding: "utf8" },
  );
}

it("fails a statistically significant slowdown", () => {
  const result = run(1);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Statistically significant render slowdown");
});

it("allows a statistically significant improvement", () => {
  expect(run(-1).status).toBe(0);
});

it("keeps zero render-count deviation", () => {
  const result = run(-1, 4);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("allowed deviation of 0");
});
