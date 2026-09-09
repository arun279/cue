import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/check-size-ratchet.mjs");

const setup = (): string => {
  const repository = tempDirectory("cue-size-ratchet-");
  mkdirSync(path.join(repository, "scripts"));
  mkdirSync(path.join(repository, ".github/workflows"), { recursive: true });
  cpSync(SCRIPT, path.join(repository, "scripts/check-size-ratchet.mjs"));
  execFileSync("git", ["init", "--quiet"], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["config", "user.name", "Cue Tests"], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["config", "user.email", "cue-tests@example.invalid"], {
    cwd: repository,
    env: gitEnv(),
  });
  writeFileSync(
    path.join(repository, ".size-limit.json"),
    JSON.stringify([
      {
        name: "bundle",
        path: "dist/app.js",
        limit: "100 kB",
        message: "Measured 90000 bytes on 2026-09-09. Reduction target 72000 bytes.",
      },
    ]),
  );
  writePlayLimit(repository, 100);
  execFileSync("git", ["add", "."], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["commit", "--quiet", "-m", "baseline"], {
    cwd: repository,
    env: gitEnv(),
  });
  return repository;
};

const writePlayLimit = (repository: string, limit: number): void => {
  writeFileSync(
    path.join(repository, ".github/workflows/ci.yml"),
    `PLAY_SIZE_MEASUREMENT_BYTES: "90"\nPLAY_SIZE_MEASURED_ON: "2026-09-09"\nPLAY_SIZE_LIMIT_BYTES: "${limit}"\n`,
  );
};

const runRatchet = (repository: string) =>
  spawnSync(process.execPath, ["scripts/check-size-ratchet.mjs"], {
    cwd: repository,
    encoding: "utf8",
    env: gitEnv(),
  });

describe("size budget ratchet", () => {
  it("rejects a raised bundle limit", () => {
    const repository = setup();
    const config = JSON.parse(readFileSync(path.join(repository, ".size-limit.json"), "utf8"));
    config[0].limit = "101 kB";
    writeFileSync(path.join(repository, ".size-limit.json"), JSON.stringify(config));

    const result = runRatchet(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bundle: limit 101000 bytes exceeds previous 100000 bytes");
  });

  it("rejects a raised Play download limit", () => {
    const repository = setup();
    writePlayLimit(repository, 101);

    const result = runRatchet(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Play download: limit 101 bytes exceeds previous 100 bytes");
  });
});
