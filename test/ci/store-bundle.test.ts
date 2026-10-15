import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const require = createRequire(import.meta.url);
const metroConfig = repositoryPath("packages/native/metro.config.js");

afterEach(() => {
  vi.unstubAllEnvs();
  delete require.cache[metroConfig];
});

it.each(["0", "1"])("resolves snackbar policy and UI harness for harness=%s", (harness) => {
  vi.stubEnv("EXPO_PUBLIC_UI_HARNESS", harness);
  delete require.cache[metroConfig];
  const { resolver } = require(metroConfig);
  const replacements = new Map(
    harness === "1"
      ? [
          [
            "packages/core/src/stores/snackbar-policy.ts",
            "packages/native/src/ui/snackbar-policy.harness.ts",
          ],
        ]
      : [["packages/native/src/ui/harness.tsx", "packages/native/src/ui/harness.store.ts"]],
  );
  const sources = ["packages/core/src", "packages/native/src"].flatMap((directory) =>
    readdirSync(repositoryPath(directory), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.[jt]sx?$/.test(file))
      .map((file) => path.join(directory, file)),
  );
  for (const source of sources) {
    expect(
      resolver.resolveRequest(
        { resolveRequest: () => ({ type: "sourceFile", filePath: repositoryPath(source) }) },
        source,
        "ios",
      ),
    ).toEqual({ type: "sourceFile", filePath: repositoryPath(replacements.get(source) ?? source) });
  }
  for (const filePath of ["\0polyfill:assets-registry", "/virtual/module.ts"]) {
    const resolution = { type: "sourceFile", filePath };
    expect(resolver.resolveRequest({ resolveRequest: () => resolution }, filePath, "ios")).toBe(
      resolution,
    );
  }
});

const check = (...modules: string[]) => {
  const atlas = path.join(tempDirectory("cue-store-bundle-"), "atlas.jsonl");
  const bundle = ["ios", "/repo/packages/native", "/repo", "entry.js", "client"];
  const graph = modules.map((relativePath, id) => ({ id, relativePath }));
  writeFileSync(
    atlas,
    `${JSON.stringify({ name: "expo-atlas" })}\n${JSON.stringify([...bundle, graph])}\n`,
  );
  return spawnSync(process.execPath, [repositoryPath("scripts/check-store-bundle.mjs"), atlas], {
    encoding: "utf8",
  });
};

it("passes a store graph that resolved the harness to its stand-in", () => {
  expect(
    check("packages/native/app/_layout.tsx", "packages/native/src/ui/harness.store.ts").status,
  ).toBe(0);
});

it.each([
  "packages/native/src/ui/harness.tsx",
  "packages/native/src/ui/harness-ids.ts",
  "packages/native/src/ui/AppIdle.tsx",
  "packages/native/src/ui/snackbar-policy.harness.ts",
])("fails a graph that ships %s", (module) => {
  const result = check("packages/native/app/_layout.tsx", module);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`ios: ${module}`);
});
