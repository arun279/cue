import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

it("summarizes in-app and runner startup timings", () => {
  const artifacts = tempDirectory("cue-startup-summary-");
  mkdirSync(path.join(artifacts, "debug"));
  writeFileSync(
    path.join(artifacts, "debug/maestro.log"),
    "CUE_STARTUP_TIMING=Startup timing: 625.4 ms\n",
  );
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

  expect(
    execFileSync(
      process.execPath,
      [repositoryPath("scripts/summarize-startup-timing.mjs"), artifacts],
      {
        encoding: "utf8",
      },
    ),
  ).toContain(
    "| In-app idle | 625.4 ms | rnStartupTiming |\n| Runner launch and idle assertion | 625 ms | Maestro commands |",
  );
});
