import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/check-size-delta.mjs");

const run = (growth: number, rationale = "") => {
  const directory = tempDirectory("cue-size-delta-");
  const names = ["expo iOS bundle", "expo Android bundle", "Play download estimate"];
  const sizes = (size: number) => names.map((name) => ({ name, size }));
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
