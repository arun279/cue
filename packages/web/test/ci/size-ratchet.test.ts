import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";

const REPOSITORY_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  env: gitEnv(),
}).trim();
const SCRIPT = path.join(REPOSITORY_ROOT, "scripts/check-size-ratchet.mjs");
const repositories: string[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) rmSync(repository, { recursive: true });
});

const setup = (): string => {
  const repository = mkdtempSync(path.join(tmpdir(), "cue-size-ratchet-"));
  repositories.push(repository);
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
  writeFileSync(
    path.join(repository, ".github/workflows/ci.yml"),
    'PLAY_SIZE_MEASUREMENT_BYTES: "90"\nPLAY_SIZE_MEASURED_ON: "2026-09-09"\nPLAY_SIZE_LIMIT_BYTES: "100"\n',
  );
  execFileSync("git", ["add", "."], { cwd: repository, env: gitEnv() });
  execFileSync("git", ["commit", "--quiet", "-m", "baseline"], {
    cwd: repository,
    env: gitEnv(),
  });
  return repository;
};

describe("size budget ratchet", () => {
  it("rejects a raised bundle limit", () => {
    const repository = setup();
    const config = JSON.parse(readFileSync(path.join(repository, ".size-limit.json"), "utf8"));
    config[0].limit = "101 kB";
    writeFileSync(path.join(repository, ".size-limit.json"), JSON.stringify(config));

    const result = spawnSync(process.execPath, ["scripts/check-size-ratchet.mjs"], {
      cwd: repository,
      encoding: "utf8",
      env: gitEnv(),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bundle: limit 101000 bytes exceeds previous 100000 bytes");
  });

  it("rejects a raised Play download limit", () => {
    const repository = setup();
    writeFileSync(
      path.join(repository, ".github/workflows/ci.yml"),
      'PLAY_SIZE_MEASUREMENT_BYTES: "90"\nPLAY_SIZE_MEASURED_ON: "2026-09-09"\nPLAY_SIZE_LIMIT_BYTES: "101"\n',
    );

    const result = spawnSync(process.execPath, ["scripts/check-size-ratchet.mjs"], {
      cwd: repository,
      encoding: "utf8",
      env: gitEnv(),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Play download: limit 101 bytes exceeds previous 100 bytes");
  });
});
