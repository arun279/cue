import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const cachedPullRequest = { EVENT: "pull_request", BUILD: "success", HIT: "true", OWED: "false" };
const push = { EVENT: "push", BUILD: "success", HIT: "true", OWED: "" };

it.each([
  ["passes shards success", 0, { ...push, SHARDS: "success" }],
  ["passes shards a cached pull request skipped", 0, { ...cachedPullRequest, SHARDS: "skipped" }],
  [
    "fails shards skipped while the lane is owed",
    1,
    { ...cachedPullRequest, OWED: "true", SHARDS: "skipped" },
  ],
  ["fails shards skipped on a push", 1, { ...push, SHARDS: "skipped" }],
  ["fails shards failure", 1, { ...cachedPullRequest, SHARDS: "failure" }],
])("%s with exit status %i", (_name, status, env) => {
  expect(
    spawnSync(process.execPath, [repositoryPath("scripts/native-e2e-rollup.mjs")], { env }).status,
  ).toBe(status);
});
