import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/check-size-delta.mjs");
const MEASURED = [
  "expo iOS bundle",
  "expo Android bundle",
  "Firebase tester APK file",
  "Play download estimate",
];

const run = (growth: number, rationale = "", measured: readonly string[] = MEASURED) => {
  const directory = tempDirectory("cue-size-delta-");
  const sizes = (size: number) => measured.map((name) => ({ name, size }));
  writeFileSync(path.join(directory, "base.json"), JSON.stringify({ sizes: sizes(1_000_000) }));
  writeFileSync(
    path.join(directory, "head.json"),
    JSON.stringify({ sizes: sizes(1_000_000 + growth) }),
  );
  return spawnSync(process.execPath, [SCRIPT, "base.json", "head.json", rationale], {
    cwd: directory,
    encoding: "utf8",
  });
};

describe("size delta gate", () => {
  it("rejects any positive artifact delta", () => {
    const result = run(1);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expo iOS bundle grew by 1 bytes");
    expect(result.stderr).toContain('Add "Binary-Size: <rationale>" to the PR body.');
  });

  it("accepts unchanged artifacts and a non-empty rationale", () => {
    expect(run(0).status).toBe(0);
    expect(
      run(1, "Binary-Size: The new asset is required; remove an older asset next.").status,
    ).toBe(0);
  });

  it.each([
    "",
    "Binary-Size: ",
    "binary-size: unexplained",
  ])("rejects an empty or malformed rationale: %s", (rationale) => {
    expect(run(1, rationale).status).toBe(1);
  });

  it("fails when a required artifact is missing", () => {
    const result = run(0, "", MEASURED.slice(0, -1));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Play download estimate: not measured on both sides");
  });

  it("fails when merge-base measurements are missing", () => {
    const directory = tempDirectory("cue-size-delta-");
    writeFileSync(path.join(directory, "base.json"), JSON.stringify({ sizes: null }));
    writeFileSync(path.join(directory, "head.json"), JSON.stringify({ sizes: [] }));

    const result = spawnSync(process.execPath, [SCRIPT, "base.json", "head.json"], {
      cwd: directory,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("merge-base measurements are missing");
  });
});
