import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

type Audit = {
  audit?: number;
  ignores?: number;
  changed?: string;
  pushed?: boolean;
  later?: boolean;
};

function audit(
  event: string,
  { audit = 1, ignores = 0, changed = "README.md", pushed, later }: Audit,
) {
  const repository = tempDirectory("cue-audit-repo-");
  const bin = tempDirectory("cue-audit-bin-");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repository, encoding: "utf8", env: gitEnv() }).trim();
  const commit = (file: string, content: string) => {
    writeFileSync(path.join(repository, file), content);
    git("add", file);
    git("commit", "--quiet", "-m", file);
    return git("rev-parse", "HEAD");
  };
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "Cue Tests");
  git("config", "user.email", "cue-tests@example.invalid");
  commit("pnpm-lock.yaml", "lock: 1\n");
  commit("pnpm-workspace.yaml", "packages: []\n");
  const before = commit("README.md", "base\n");
  commit(changed, "head\n");
  if (later) commit("README.md", "later\n");
  writeFileSync(path.join(bin, "pnpm"), `#!/bin/sh\nexit ${audit}\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, "node"), `#!/bin/sh\nexit ${ignores}\n`, { mode: 0o755 });
  return spawnSync(
    "bash",
    [repositoryPath("scripts/audit-dependencies.sh"), event, ...(pushed ? [before] : [])],
    {
      cwd: repository,
      encoding: "utf8",
      env: { ...gitEnv(), PATH: `${bin}:${process.env["PATH"]}` },
    },
  );
}

it.each([
  ["pull_request", {}],
  ["push", { pushed: true }],
  ["pull_request", { audit: 0, ignores: 1 }],
])("only warns about a %s that leaves dependencies alone: %j", (event, change) => {
  const result = audit(event, change);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("::warning::");
});

it.each([
  ["pull_request", { changed: "pnpm-lock.yaml" }],
  ["pull_request", { changed: "pnpm-workspace.yaml" }],
  ["pull_request", { changed: "pnpm-lock.yaml", audit: 0, ignores: 1 }],
  ["push", { changed: "pnpm-lock.yaml", pushed: true }],
  ["push", { changed: "pnpm-lock.yaml", pushed: true, later: true }],
  ["schedule", {}],
])("fails a %s whose audit fails: %j", (event, change) => {
  expect(audit(event, change).status).toBe(1);
});

it("passes a clean audit without a warning", () => {
  const result = audit("pull_request", { audit: 0, changed: "pnpm-lock.yaml" });

  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("::warning::");
});
