import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

// Each case starts a whole vitest run, about 2 s on a loaded runner before the guard's 3 s.
const RUN_MS = 60_000;

const run = (filter: string) =>
  spawnSync(
    process.execPath,
    [
      repositoryPath("node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      repositoryPath("test/ci/fixtures/stall-guard/vitest.config.ts"),
      filter,
    ],
    { encoding: "utf8", timeout: RUN_MS, env: { ...process.env, VITEST_STALL_MS: "3000" } },
  );

it("fails the run and names the file when a test file never finishes loading", {
  timeout: RUN_MS,
}, () => {
  const result = run("loads-forever");

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Vitest stalled: no test file finished for 3 s. Still running:");
  expect(result.stderr).toContain("loads-forever.fixture.ts");
});

it("lets a run whose files finish pass", { timeout: RUN_MS }, () => {
  const result = run("finishes");

  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).not.toContain("Vitest stalled");
});
