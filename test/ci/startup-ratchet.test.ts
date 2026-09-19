import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/check-startup-ratchet.mjs");

const setup = (): string => {
  const repository = tempDirectory("cue-startup-ratchet-");
  cpSync(SCRIPT, path.join(repository, "check-startup-ratchet.mjs"));
  writeFileSync(
    path.join(repository, ".startup-time-limit.json"),
    JSON.stringify({
      measurementMs: 400,
      ceilingMs: 500,
      targetMs: 320,
      runUrl: "https://github.com/example/cue/actions/runs/123",
      measuredOn: "2026-09-10",
    }),
  );
  execFileSync("git", ["init", "--quiet"], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["config", "user.name", "Cue Tests"], {
    cwd: repository,
    env: gitEnv(),
  });
  execFileSync("git", ["config", "user.email", "cue-tests@example.invalid"], {
    cwd: repository,
    env: gitEnv(),
  });
  execFileSync("git", ["add", "."], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["commit", "--quiet", "-m", "baseline"], {
    cwd: repository,
    env: gitEnv(),
  });
  return repository;
};

const runRatchet = (repository: string) =>
  spawnSync(process.execPath, ["check-startup-ratchet.mjs"], {
    cwd: repository,
    encoding: "utf8",
    env: gitEnv(),
  });

describe("startup timing ratchet", () => {
  it("rejects a raised ceiling", () => {
    const repository = setup();
    const file = path.join(repository, ".startup-time-limit.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.ceilingMs = 501;
    writeFileSync(file, JSON.stringify(config));

    const result = runRatchet(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ceiling 501 ms exceeds previous 500 ms");
  });

  it("rejects invalid provenance and target", () => {
    const repository = setup();
    const file = path.join(repository, ".startup-time-limit.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.runUrl = "missing";
    config.targetMs = 400;
    writeFileSync(file, JSON.stringify(config));

    const result = runRatchet(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid measurement provenance or target");
  });
});
