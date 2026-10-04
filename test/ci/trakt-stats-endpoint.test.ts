import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { REPOSITORY_ROOT, repositoryPath } from "../support/repository-path";

const SHIPPED = ["packages/core/src", "packages/native/src", "packages/native/app"];

// Trakt answers /users/:id/stats with 204 for accounts without precomputed stats (trakt/trakt-api#929).
it("ships no request to Trakt's user stats endpoint", () => {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...SHIPPED],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: gitEnv(),
    },
  )
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file));
  expect(files.length).toBeGreaterThan(100);
  const callers = files.filter((file) =>
    /\/users\/[^"'`]*\/stats\b/.test(readFileSync(repositoryPath(file), "utf8")),
  );
  expect(callers).toEqual([]);
});
