import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

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
    { encoding: "utf8", timeout: 60_000, env: { ...process.env, VITEST_STALL_MS: "3000" } },
  );

it("fails the run and names the file when a test file never finishes loading", () => {
  const result = run("loads-forever");

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Vitest stalled: no test file finished for 3 s. Still running:");
  expect(result.stderr).toContain("loads-forever.fixture.ts");
});

it("lets a run whose files finish pass", () => {
  const result = run("finishes");

  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).not.toContain("Vitest stalled");
});
