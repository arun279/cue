import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { REPOSITORY_ROOT, repositoryPath } from "../support/repository-path";

it("commits every script that is run by path as executable", () => {
  const modes = new Map(
    execFileSync("git", ["ls-files", "--stage", "scripts"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: gitEnv(),
    })
      .trim()
      .split("\n")
      .map((entry) => {
        const [mode, , , file] = entry.split(/\s+/);
        return [file, mode];
      }),
  );
  const sources = [".github", "scripts"].flatMap((directory) =>
    readdirSync(repositoryPath(directory), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(?:ya?ml|sh|mjs)$/.test(file))
      .map((file) => readFileSync(path.join(repositoryPath(directory), file), "utf8")),
  );
  const runByPath = new Set(
    sources.flatMap((source) =>
      [...source.matchAll(/(?<!bash "?\S*)(?<![\w.-])scripts\/[\w/-]+\.sh\b/g)].map(
        ([script]) => script,
      ),
    ),
  );

  expect(runByPath.size).toBeGreaterThan(0);
  expect([...runByPath].filter((script) => modes.get(script) !== "100755")).toEqual([]);
});
