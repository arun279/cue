/**
 * `pnpm check` is the pre-push hook, and git exports `GIT_DIR`, `GIT_INDEX_FILE`
 * and friends into everything a hook runs. A test that builds a scratch
 * repository and inherits them does not get a scratch repository at all: its
 * `git init` is ignored, its commits land in the repository being pushed, and
 * the branch is rewritten with the scratch directory as its tree. This runs both
 * halves against a stand-in repository, so the failure is demonstrated rather
 * than assumed and the guard is pinned to what it actually prevents.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";

const directories: string[] = [];

const scratchRepository = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "cue-git-env-"));
  directories.push(directory);
  return directory;
};

const git = (repository: string, environment: NodeJS.ProcessEnv, ...args: string[]): void => {
  execFileSync("git", args, { cwd: repository, stdio: "ignore", env: environment });
};

const headOf = (repository: string): string =>
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
    env: gitEnv(),
  }).trim();

/** A repository standing in for the one a hook would be pushing. */
function standIn(): string {
  const repository = scratchRepository();
  const environment = gitEnv();
  git(repository, environment, "init", "--quiet");
  git(repository, environment, "config", "user.name", "Cue Tests");
  git(repository, environment, "config", "user.email", "cue-tests@example.invalid");
  writeFileSync(path.join(repository, "kept.txt"), "kept\n");
  git(repository, environment, "add", ".");
  git(repository, environment, "commit", "--quiet", "-m", "the commit being pushed");
  return repository;
}

/** Everything a test does inside a temp repository, under `environment`. */
function commitInTempRepository(environment: NodeJS.ProcessEnv): void {
  const repository = scratchRepository();
  git(repository, environment, "init", "--quiet");
  git(repository, environment, "config", "user.name", "Cue Tests");
  git(repository, environment, "config", "user.email", "cue-tests@example.invalid");
  writeFileSync(path.join(repository, "fixture.ts"), "const fixture = true;\n");
  git(repository, environment, "add", ".");
  git(repository, environment, "commit", "--quiet", "-m", "fixture");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("a test that shells out to git under a hook", () => {
  it("rewrites the repository being pushed when it inherits the hook's environment", () => {
    const pushed = standIn();
    const before = headOf(pushed);

    commitInTempRepository({ ...process.env, GIT_DIR: path.join(pushed, ".git") });

    expect(headOf(pushed)).not.toBe(before);
  });

  it("leaves it alone under gitEnv()", () => {
    const pushed = standIn();
    const before = headOf(pushed);
    process.env["GIT_DIR"] = path.join(pushed, ".git");

    try {
      commitInTempRepository(gitEnv());
    } finally {
      delete process.env["GIT_DIR"];
    }

    expect(headOf(pushed)).toBe(before);
  });
});
