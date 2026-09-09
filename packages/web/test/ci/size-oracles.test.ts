import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const fixture = (name: string, contents: string): string => {
  const directory = tempDirectory("cue-size-oracle-");
  const file = path.join(directory, name);
  writeFileSync(file, contents);
  return file;
};

describe("store download size oracles", () => {
  it("uses Play's reference density and checks every bundletool dimension", () => {
    const workflow = readFileSync(repositoryPath(".github/workflows/ci.yml"), "utf8");

    expect(workflow).toContain('"screenDensity":640');
    expect(workflow).toContain("--dimensions=ALL");
    expect(workflow).not.toContain("AAB_SIZE_LIMIT_BYTES");
    expect(workflow).not.toContain('"screenDensity":480');
  });

  it("gates the largest bundletool configuration", () => {
    const csv = fixture(
      "sizes.csv",
      "SDK,ABI,SCREEN_DENSITY,LANGUAGE,MIN,MAX\r\n35,arm64,640,en,1,9\r\n35,x86,640,en,2,11\r\n",
    );
    const script = repositoryPath("scripts/bundletool-size.mjs");

    expect(execFileSync(process.execPath, [script, csv, "11", "Play"], { encoding: "utf8" })).toBe(
      "Play: 11 bytes, limit 11 bytes\n",
    );
    const result = spawnSync(process.execPath, [script, csv, "10", "Play"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Play: 11 bytes, exceeding 10 bytes");
  });

  it("gates the largest compressed App Thinning variant", () => {
    const report = fixture(
      "App Thinning Size Report.txt",
      "Variant: iPhone\nApp size: 12.5 MB compressed, 30 MB uncompressed\nVariant: iPad\nApp size: 40.1 MB compressed, 70 MB uncompressed\n",
    );
    const script = repositoryPath("scripts/assert-app-thinning-size.mjs");
    const result = spawnSync(process.execPath, [script, report, "40000000"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("App Store download: 40100000 bytes, exceeding 40000000 bytes");
  });
});
