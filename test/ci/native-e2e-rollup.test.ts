import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const cachedPullRequest = { EVENT: "pull_request", DEVICES: "true", HIT: "true", OWED: "false" };
const draft = { EVENT: "pull_request", DEVICES: "false", HIT: "", OWED: "true" };
const push = { EVENT: "push", DEVICES: "true", HIT: "", OWED: "" };

it.each([
  ["passes shards success", 0, { ...push, SHARDS: "success" }],
  ["passes shards a cached pull request skipped", 0, { ...cachedPullRequest, SHARDS: "skipped" }],
  ["passes shards a draft pull request skipped", 0, { ...draft, SHARDS: "skipped" }],
  ["fails shards failure on a draft", 1, { ...draft, SHARDS: "failure" }],
  [
    "fails shards skipped while the lane is owed",
    1,
    { ...cachedPullRequest, OWED: "true", SHARDS: "skipped" },
  ],
  [
    "fails shards skipped on a user-facing pull request",
    1,
    { ...cachedPullRequest, USER_FACING: "true", SHARDS: "skipped" },
  ],
  ["fails shards skipped on a push", 1, { ...push, SHARDS: "skipped" }],
  [
    "fails shards skipped on a pull request without a cached app",
    1,
    { ...cachedPullRequest, HIT: "", SHARDS: "skipped" },
  ],
  ["fails shards failure", 1, { ...cachedPullRequest, SHARDS: "failure" }],
])("%s with exit status %i", (_name, status, env) => {
  expect(
    spawnSync(process.execPath, [repositoryPath("scripts/native-e2e-rollup.mjs")], { env }).status,
  ).toBe(status);
});
