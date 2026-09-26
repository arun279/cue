import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const script = repositoryPath("scripts/check-changed-coverage.mjs");

function run(
  lineHits: number,
  branchHits: string,
  rationale = "",
  source = "packages/core/src/value.ts",
  measured = true,
) {
  const repository = tempDirectory("cue-changed-coverage-");
  mkdirSync(path.dirname(path.join(repository, source)), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["config", "user.name", "Cue Tests"], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["config", "user.email", "cue-tests@example.invalid"], {
    cwd: repository,
    env: gitEnv(),
  });
  writeFileSync(path.join(repository, source), "export const value = 1;\n");
  execFileSync("git", ["add", "."], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: repository, env: gitEnv() });
  writeFileSync(path.join(repository, source), "export const value = flag ? 1 : 2;\n");
  execFileSync("git", ["add", "."], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["commit", "--quiet", "-m", "head"], { cwd: repository, env: gitEnv() });
  writeFileSync(
    path.join(repository, "lcov.info"),
    measured
      ? `SF:${path.join(repository, source)}\nDA:1,${lineHits}\nBRDA:1,0,0,1\nBRDA:1,0,1,${branchHits}\nend_of_record\n`
      : "",
  );
  return spawnSync(process.execPath, [script, "HEAD~1", "lcov.info", rationale], {
    cwd: repository,
    encoding: "utf8",
    env: gitEnv(),
  });
}

it("requires every changed executable line and branch arm to be covered", () => {
  expect(run(1, "1").status).toBe(0);
  expect(run(0, "1").stderr).toContain("packages/core/src/value.ts:1");
  expect(run(1, "0").stderr).toContain("1 uncovered branch arm");
});

it("requires a non-empty coverage rationale for an exception", () => {
  expect(run(0, "1", "Coverage-Rationale: exercised by platform tests").status).toBe(0);
  expect(run(0, "1", "Coverage-Rationale: ").status).toBe(1);
});

it("gates only the files the coverage run measures", () => {
  expect(run(0, "0", "", "packages/core/src/app/boot.ts", false).status).toBe(0);
  expect(run(0, "0", "", "packages/core/src/value.ts", false).stderr).toContain(
    "packages/core/src/value.ts: coverage data missing",
  );
});
