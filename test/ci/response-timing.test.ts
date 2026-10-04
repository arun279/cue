import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const MARK = [52, 61, 58, 49, 63, 55, 60, 51, 66, 54, 59, 57, 62, 50, 56];
const UNDO = [71, 68, 77, 64, 73, 70, 66, 79, 69, 75, 62, 72, 67, 74, 65];

const run = (mark: readonly number[], undo: readonly number[] = UNDO) => {
  const artifacts = tempDirectory("cue-response-timing-");
  mkdirSync(path.join(artifacts, "debug"));
  writeFileSync(
    path.join(artifacts, "debug/maestro.log"),
    `JsConsole: CUE_RESPONSE_SAMPLES=Response timing: mark ${mark.join(",")}; undo ${undo.join(",")}\n`,
  );
  return spawnSync(
    process.execPath,
    [repositoryPath("scripts/check-response-timing.mjs"), artifacts, "100", "15"],
    { encoding: "utf8" },
  );
};

it("passes when a burst slows a minority of taps around the ceiling", () => {
  const burst = [131, 146, 98, 162, 104, ...MARK.slice(5)];
  const result = run(burst, [...UNDO.slice(0, 9), 109, 125, 101, 140, 97, 118]);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("| Mark | 60.0 ms |");
  expect(result.stdout).toContain("| Undo | 77.0 ms |");
});

it("fails when the mark path gains a delay on every tap", () => {
  const result = run(MARK.map((sample) => sample + 45));

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Mark response median 102.0 ms over 15 taps exceeds 100 ms");
});

it("fails a run with fewer taps than the minimum", () => {
  const result = run(MARK, UNDO.slice(1));

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Undo response needs 15 samples, got 14");
});
