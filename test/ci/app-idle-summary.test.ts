import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

function artifactsWith(samples: string): string {
  const artifacts = tempDirectory("cue-app-idle-summary-");
  mkdirSync(path.join(artifacts, "debug"));
  writeFileSync(path.join(artifacts, "debug/maestro.log"), `CUE_APP_IDLE_SAMPLES=${samples}\n`);
  writeFileSync(
    path.join(artifacts, "commands-(startup).json"),
    JSON.stringify([
      { command: { launchAppCommand: {} }, metadata: { duration: 410 } },
      {
        command: { assertConditionCommand: { condition: { visible: { idRegex: "app-idle" } } } },
        metadata: { duration: 215 },
      },
    ]),
  );
  return artifacts;
}

it("computes the median of five returning-user launches", () => {
  const artifacts = artifactsWith("900,400,700,500,600");

  expect(
    execFileSync(
      process.execPath,
      [repositoryPath("scripts/summarize-app-idle.mjs"), artifacts, "1000"],
      {
        encoding: "utf8",
      },
    ),
  ).toContain(
    "| Five-launch median to app idle | 600.0 ms |\n| Samples | 900, 400, 700, 500, 600 ms |",
  );
});

it("fails a median over the fixed budget", () => {
  const result = spawnSync(
    process.execPath,
    [
      repositoryPath("scripts/summarize-app-idle.mjs"),
      artifactsWith("900,1100,1200,800,1050"),
      "1000",
    ],
    { encoding: "utf8" },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("median 1050.0 ms exceeds 1000 ms");
});
