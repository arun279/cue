import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/summarize-atlas.mjs");

describe("Expo Atlas attribution", () => {
  it("aggregates and ranks transformed module bytes per platform", () => {
    const directory = tempDirectory("cue-atlas-");
    const atlas = path.join(directory, "atlas.jsonl");
    writeFileSync(
      atlas,
      [
        { name: "expo-atlas", version: "0.4.2" },
        [
          "ios",
          "project",
          "root",
          "modules",
          "client",
          [{ package: "runtime", size: 2 }],
          [
            { package: "library", size: 8 },
            { package: "library", size: 5 },
            { relativePath: "packages/native/app.tsx", size: 7 },
          ],
          {},
          {},
        ],
        [
          "android",
          "project",
          "root",
          "modules",
          "client",
          [],
          [
            { package: "android-library", size: 11 },
            { relativePath: "packages/native/app.tsx", size: 3 },
          ],
          {},
          {},
        ],
      ]
        .map((value) => JSON.stringify(value))
        .join("\n"),
    );

    expect(execFileSync(process.execPath, [SCRIPT, atlas], { encoding: "utf8" })).toBe(
      "\n### Expo Atlas top contributors\n\n" +
        "| platform | contributor | transformed bytes |\n" +
        "| --- | --- | ---: |\n" +
        "| iOS | library | 13 |\n" +
        "| iOS | Cue app | 7 |\n" +
        "| iOS | runtime | 2 |\n" +
        "| Android | android-library | 11 |\n" +
        "| Android | Cue app | 3 |\n",
    );
  });

  it("refuses an Atlas file that describes only one platform", () => {
    const atlas = path.join(tempDirectory("cue-atlas-"), "atlas.jsonl");
    writeFileSync(
      atlas,
      [
        { name: "expo-atlas", version: "0.4.2" },
        ["android", "project", "root", "modules", "client", [], [], {}, {}],
      ]
        .map((value) => JSON.stringify(value))
        .join("\n"),
    );

    const result = spawnSync(process.execPath, [SCRIPT, atlas], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no ios bundle");
  });

  it("pins generation, comment rendering, and artifact upload in the footprint job", () => {
    const workflow = readFileSync(repositoryPath(".github/workflows/ci.yml"), "utf8");
    const packageJson = JSON.parse(readFileSync(repositoryPath("package.json"), "utf8"));
    const knip = JSON.parse(readFileSync(repositoryPath("knip.json"), "utf8"));

    expect(packageJson.devDependencies["expo-atlas"]).toBe("0.4.3");
    expect(knip.workspaces["."].ignoreDependencies).toContain("expo-atlas");
    expect(workflow).toContain(
      'EXPO_ATLAS=true scripts/measure-sizes.sh "$PWD" "$PWD/head-sizes.json"',
    );
    expect(workflow).toContain(
      "node scripts/summarize-atlas.mjs packages/native/.expo/atlas.jsonl >> footprint.md",
    );
    expect(workflow).toMatch(
      /name: Upload Expo Atlas[\s\S]*name: expo-atlas[\s\S]*path: packages\/native\/\.expo\/atlas\.jsonl/,
    );
  });
});
