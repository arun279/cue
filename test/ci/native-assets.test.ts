import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/check-native-assets.mjs");

const setup = () => {
  const directory = tempDirectory("cue-native-assets-");
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
      assets: [{ path: "assets/known", type: "png", bytes: 5, platforms: ["ios"] }],
    }),
  );
  return { directory, exported, manifest };
};

describe("native export assets", () => {
  it("accepts platforms regardless of metadata key order", () => {
    const { exported, manifest } = setup();
    writeFileSync(
      path.join(exported, "metadata.json"),
      JSON.stringify({
        fileMetadata: {
          ios: { assets: [{ path: "assets/known", ext: "png" }] },
          android: { assets: [{ path: "assets/known", ext: "png" }] },
        },
      }),
    );
    writeFileSync(
      manifest,
      JSON.stringify({
        measuredOn: "2026-09-09",
        assets: [{ path: "assets/known", type: "png", bytes: 5, platforms: ["ios", "android"] }],
      }),
    );

    expect(spawnSync(process.execPath, [SCRIPT, exported, manifest]).status).toBe(0);
  });

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
