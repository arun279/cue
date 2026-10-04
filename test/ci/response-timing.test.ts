import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const MARK = [52, 61, 58, 49, 63, 55, 60, 51, 66, 54, 59, 57, 62, 50, 56];
const UNDO = [71, 68, 77, 64, 73, 70, 66, 79, 69, 75, 62, 72, 67, 74, 65];

const run = (mark: readonly number[], undo: readonly number[] = UNDO, limits = ["100", "15"]) => {
  const artifacts = tempDirectory("cue-response-timing-");
  mkdirSync(path.join(artifacts, "debug"));
  writeFileSync(
    path.join(artifacts, "debug/maestro.log"),
    `JsConsole: CUE_RESPONSE_SAMPLES=Response timing: mark ${mark.join(",")}; undo ${undo.join(",")}\n`,
  );
  return spawnSync(
    process.execPath,
    [repositoryPath("scripts/check-response-timing.mjs"), artifacts, ...limits],
    { encoding: "utf8" },
  );
};

it("passes when a burst slows three of fifteen taps", () => {
  const result = run([131, 146, 162, ...MARK.slice(3)], [...UNDO.slice(0, 12), 140, 118, 125]);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("| Mark | 66.0 ms |");
  expect(result.stdout).toContain("| Undo | 79.0 ms |");
});

it("passes a p75 exactly at the ceiling", () => {
  expect(run([...Array<number>(11).fill(50), 100, 150, 150, 150]).status).toBe(0);
});

it("fails when four of fifteen taps exceed the ceiling", () => {
  const result = run([...Array<number>(11).fill(50), ...Array<number>(4).fill(150)]);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Mark response p75 150.0 ms over 15 taps exceeds 100 ms");
});

it("fails when the mark path gains a delay on every tap", () => {
  const result = run(MARK.map((sample) => sample + 40));

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Mark response p75 101.0 ms over 15 taps exceeds 100 ms");
});

it("fails a run with fewer taps than the minimum", () => {
  const result = run(MARK, UNDO.slice(1));

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Undo response needs 15 samples, got 14");
});

it.each([[["100"]], [["", "15"]]])("fails closed on missing limits %j", (limits) => {
  const result = run(MARK, UNDO, limits);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("usage: check-response-timing.mjs");
});

it("takes as many taps as the app keeps and the gate requires", () => {
  const read = (file: string) => readFileSync(repositoryPath(file), "utf8");
  const counts = [
    /const SAMPLE_WINDOW = (\d+);/.exec(read("packages/native/src/ui/response-timing.ts")),
    /RESPONSE_SAMPLES: "(\d+)"/.exec(read(".github/workflows/ci.yml")),
    ...[".maestro/ci/app-activity.yaml", ".maestro/flows/up-next-mark-and-undo.yaml"].map((file) =>
      /RESPONSE_SAMPLES: \$\{RESPONSE_SAMPLES \|\| "(\d+)"\}/.exec(read(file)),
    ),
  ].map((match) => match?.[1]);

  expect(counts).toEqual(["15", "15", "15", "15"]);
});
