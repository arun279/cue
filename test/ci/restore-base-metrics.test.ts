import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/restore-base-metrics.sh");

const git = (repository: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8", env: gitEnv() }).trim();

const baseCommit = (files: Record<string, string>): string => {
  const repository = tempDirectory("cue-restore-base-");
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Cue Tests");
  git(repository, "config", "user.email", "cue-tests@example.invalid");
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.join(repository, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(repository, file), contents);
  }
  git(repository, "add", ".");
  git(repository, "commit", "--quiet", "-m", "base");
  return repository;
};

const restore = (repository: string) => {
  const bin = tempDirectory("cue-restore-bin-");
  writeFileSync(path.join(bin, "gh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return spawnSync(SCRIPT, [git(repository, "rev-parse", "HEAD")], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...gitEnv(),
      GITHUB_REPOSITORY: "owner/cue",
      PATH: `${bin}:${process.env["PATH"]}`,
      RUNNER_TEMP: tempDirectory("cue-restore-runner-"),
    },
  });
};

describe("restoring the merge-base measurement", () => {
  it("measures a base without the native app as zero delivered bytes", () => {
    const repository = baseCommit({ "packages/core/package.json": "{}\n" });

    expect(restore(repository).status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(repository, "base-metrics.json"), "utf8"))).toEqual({
      sizes: [
        { name: "expo iOS bundle", size: 0 },
        { name: "expo Android bundle", size: 0 },
        { name: "Firebase tester APK file", size: 0 },
        { name: "Play download estimate", size: 0 },
      ],
    });
  });

  it("fails when a base with the native app has no measurement left", () => {
    const repository = baseCommit({ "packages/native/package.json": "{}\n" });
    const result = restore(repository);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::Missing merge-base measurements");
  });
});
