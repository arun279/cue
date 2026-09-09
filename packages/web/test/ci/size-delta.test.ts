import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/check-size-delta.mjs");

const MEASURED = ["expo iOS bundle", "expo Android bundle", "Play download estimate"];

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
  it("rejects growth above Chromium's arm64 threshold", () => {
    const result = run(64_001);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expo iOS bundle grew by 64001 bytes");
    expect(result.stderr).toContain('Add "Binary-Size: <rationale>" to the PR body.');
  });

  it("accepts the threshold and the documented rationale marker", () => {
    expect(run(64_000).status).toBe(0);
    expect(
      run(64_001, "Context\nBinary-Size: The larger artwork is worth the download.\n").status,
    ).toBe(0);
  });

  it("does not read prose as the rationale marker", () => {
    expect(run(64_001, "The binary size: it grew.\nbinary-size: shrug\n").status).toBe(1);
  });

  it("fails when an artifact is missing from either side", () => {
    const result = run(0, "", MEASURED.slice(0, 2));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Play download estimate: not measured on both sides");
  });

  it("does not gate a merge base without the packages", () => {
    const directory = tempDirectory("cue-size-delta-");
    writeFileSync(path.join(directory, "base.json"), JSON.stringify({ sizes: null }));
    writeFileSync(path.join(directory, "head.json"), JSON.stringify({ sizes: [] }));

    const result = spawnSync(process.execPath, [SCRIPT, "base.json", "head.json"], {
      cwd: directory,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("n/a because the merge base has no measured packages");
  });
});
