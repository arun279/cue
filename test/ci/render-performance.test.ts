import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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

it("holds every scenario to its pinned count when the base has no render suite", () => {
  const pinned: Record<string, number> = JSON.parse(
    readFileSync(repositoryPath("scripts/render-count-baselines.json"), "utf8"),
  );
  const measure = (counts: Record<string, number>) => {
    const directory = tempDirectory("cue-render-performance-");
    const current = path.join(directory, "current.perf");
    writeFileSync(
      current,
      [
        { metadata: {} },
        ...Object.entries(counts).map(([name, meanCount]) => ({ name, meanCount })),
      ]
        .map((record) => `${JSON.stringify(record)}\n`)
        .join(""),
    );
    return spawnSync(
      process.execPath,
      [
        repositoryPath("scripts/check-render-counts.mjs"),
        path.join(directory, "baseline.perf"),
        current,
      ],
      { encoding: "utf8" },
    );
  };

  expect(measure(pinned).status).toBe(0);
  const [name = "", count = 0] = Object.entries(pinned)[0] ?? [];
  expect(measure({ ...pinned, [name]: count + 1 }).stderr).toContain("allowed deviation of 0");
  expect(measure({ ...pinned, "new scenario": 1 }).stderr).toContain(
    "render scenario: new scenario",
  );
});
