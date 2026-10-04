import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

function run(exitInfo: string, logcat = "") {
  const directory = tempDirectory("cue-anr-");
  const exitPath = path.join(directory, "exit-info.txt");
  const logPath = path.join(directory, "logcat.txt");
  writeFileSync(exitPath, exitInfo);
  writeFileSync(logPath, logcat);
  return spawnSync("bash", [repositoryPath("scripts/assert-no-anr.sh"), exitPath, logPath], {
    encoding: "utf8",
  });
}

it("accepts a run with no ANR", () => {
  expect(run("reason=10 (USER REQUESTED)").status).toBe(0);
});

it("fails an ANR in process exit history or logcat", () => {
  expect(run("reason=6 (ANR)").status).toBe(1);
  expect(run("", "ActivityManager: ANR in app.cuetracker").status).toBe(1);
});
