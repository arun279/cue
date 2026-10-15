import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

it.each([0, 17])("preserves Maestro exit %s and reports the failed command once", (status) => {
  const directory = tempDirectory("cue-maestro-");
  const flow = path.join(directory, "screens", "session", "app-discovery");
  mkdirSync(flow, { recursive: true });
  writeFileSync(
    path.join(flow, "commands.json"),
    JSON.stringify([
      {
        command: { assertConditionCommand: { visible: "screen-search" } },
        metadata: {
          status: "FAILED",
          error: { message: "Element screen-search is not visible" },
          artifacts: [{ kind: "SCREENSHOT", relativePath: "screenshots/step-003.png" }],
        },
      },
    ]),
  );
  writeFileSync(
    path.join(directory, "maestro"),
    '#!/bin/sh\necho run >> "$RUNS"\nexit "$RESULT"\n',
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    [
      repositoryPath("scripts/maestro-test.sh"),
      "test",
      ".maestro/ci/app.yaml",
      "--debug-output",
      path.join(directory, "debug"),
      "--test-output-dir",
      path.join(directory, "screens"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env["PATH"]}`,
        RESULT: String(status),
        RUNS: path.join(directory, "runs"),
      },
    },
  );
  expect(result.status).toBe(status);
  expect(readFileSync(path.join(directory, "runs"), "utf8")).toBe("run\n");
  if (status === 0) expect(result.stderr).toBe("");
  else {
    expect(result.stdout).toContain("Command: maestro test .maestro/ci/app.yaml");
    expect(result.stderr).toContain(`Failing flow: ${flow}`);
    expect(result.stderr).toContain(
      'Command: {"assertConditionCommand":{"visible":"screen-search"}}',
    );
    expect(result.stderr).toContain("Maestro reason: Element screen-search is not visible");
    expect(result.stderr).toContain(`Failure screenshot: ${flow}/screenshots/step-003.png`);
  }
});

it("prints the startup reason when command metadata is incomplete", () => {
  const directory = tempDirectory("cue-maestro-startup-");
  writeFileSync(path.join(directory, "commands.json"), "[");
  writeFileSync(path.join(directory, "maestro.log"), "Driver failed: connection closed");
  const result = spawnSync(
    process.execPath,
    [repositoryPath("scripts/maestro-failure.mjs"), "--debug-output", directory],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("Driver failed: connection closed");
  expect(result.stderr).toContain("Failure screenshot: not produced by Maestro");
});
