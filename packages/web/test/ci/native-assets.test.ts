import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPOSITORY_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const SCRIPT = path.join(REPOSITORY_ROOT, "scripts/check-native-assets.mjs");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

const setup = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cue-native-assets-"));
  directories.push(directory);
  const exported = path.join(directory, "dist");
  mkdirSync(path.join(exported, "assets"), { recursive: true });
  writeFileSync(path.join(exported, "assets/known"), "known");
  writeFileSync(
    path.join(exported, "metadata.json"),
    JSON.stringify({
      fileMetadata: { ios: { assets: [{ path: "assets/known", ext: "png" }] } },
    }),
  );
  const manifest = path.join(directory, "manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      measuredOn: "2026-09-09",
      totalBytes: 5,
      assets: [{ path: "assets/known", type: "png", bytes: 5, platforms: ["ios"] }],
    }),
  );
  return { directory, exported, manifest };
};

describe("native export assets", () => {
  it("rejects an asset that is not declared", () => {
    const { exported, manifest } = setup();
    writeFileSync(path.join(exported, "assets/arrival"), "new");
    writeFileSync(
      path.join(exported, "metadata.json"),
      JSON.stringify({
        fileMetadata: {
          ios: {
            assets: [
              { path: "assets/known", ext: "png" },
              { path: "assets/arrival", ext: "ttf" },
            ],
          },
        },
      }),
    );

    const result = spawnSync(process.execPath, [SCRIPT, exported, manifest], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unlisted native asset: assets/arrival (3 bytes)");
  });

  it("rejects a listed asset that left the export", () => {
    const { exported, manifest } = setup();
    writeFileSync(
      path.join(exported, "metadata.json"),
      JSON.stringify({ fileMetadata: { ios: { assets: [] } } }),
    );

    const result = spawnSync(process.execPath, [SCRIPT, exported, manifest], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("listed native asset is gone: assets/known");
  });
});
