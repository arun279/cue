import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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
  for (const { source, replacement } of [
    {
      source: "packages/core/src/stores/snackbar-policy.ts",
      replacement:
        harness === "1"
          ? "packages/native/src/ui/snackbar-policy.harness.ts"
          : "packages/core/src/stores/snackbar-policy.ts",
    },
    {
      source: "packages/native/src/ui/harness.tsx",
      replacement:
        harness === "1"
          ? "packages/native/src/ui/harness.tsx"
          : "packages/native/src/ui/harness.store.ts",
    },
    {
      source: "packages/native/src/ui/SnackbarHost.tsx",
      replacement: "packages/native/src/ui/SnackbarHost.tsx",
    },
  ]) {
    expect(
      resolver.resolveRequest(
        { resolveRequest: () => ({ type: "sourceFile", filePath: repositoryPath(source) }) },
        source,
        "ios",
      ),
    ).toEqual({ type: "sourceFile", filePath: repositoryPath(replacement) });
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
