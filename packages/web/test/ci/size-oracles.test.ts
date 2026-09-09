import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/bundletool-size.mjs");

describe("store download size oracles", () => {
  it("uses Play's reference density and checks every bundletool dimension", () => {
    const workflow = readFileSync(repositoryPath(".github/workflows/ci.yml"), "utf8");

    expect(workflow).toContain('"screenDensity":640');
    expect(workflow).toContain("--dimensions=ALL");
    expect(workflow).not.toContain("AAB_SIZE_LIMIT_BYTES");
    expect(workflow).not.toContain('"screenDensity":480');
  });

  it("gates the largest bundletool configuration", () => {
    const csv = path.join(tempDirectory("cue-size-oracle-"), "sizes.csv");
    writeFileSync(
      csv,
      "SDK,ABI,SCREEN_DENSITY,LANGUAGE,MIN,MAX\r\n35,arm64,640,en,1,9\r\n35,x86,640,en,2,11\r\n",
    );

    expect(execFileSync(process.execPath, [SCRIPT, csv, "11", "Play"], { encoding: "utf8" })).toBe(
      "Play: 11 bytes, limit 11 bytes\n",
    );
    const result = spawnSync(process.execPath, [SCRIPT, csv, "10", "Play"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Play: 11 bytes, exceeding 10 bytes");
  });
});
