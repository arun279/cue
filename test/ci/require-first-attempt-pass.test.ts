import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const job = (name: string, conclusion: string, run_attempt: number) => ({
  name,
  conclusion,
  status: "completed",
  run_attempt,
});

function refuse(attempt: number, history: Record<number, ReturnType<typeof job>[]>) {
  const directory = tempDirectory("cue-first-attempt-");
  writeFileSync(
    path.join(directory, "data.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(history).map(([key, jobs]) => [key, [{ jobs }]])),
    ),
  );
  writeFileSync(
    path.join(directory, "gh"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const url = process.argv.find(arg => arg.startsWith('repos/'));
fs.appendFileSync(process.env.CALLS, url + '\\n');
const [, key] = url.match(/^repos\\/owner\\/cue\\/actions\\/runs\\/7\\/attempts\\/(\\d+)\\/jobs\\?per_page=100$/) ?? [];
const value = JSON.parse(fs.readFileSync(process.env.FIXTURES))[key];
if (!value) process.exit(23);
process.stdout.write(JSON.stringify(value));
`,
    { mode: 0o755 },
  );
  const calls = path.join(directory, "calls");
  writeFileSync(calls, "");
  const result = spawnSync(
    "bash",
    [repositoryPath("scripts/require-first-attempt-pass.sh"), "native-ios", "native-e2e-ios-light"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env["PATH"]}`,
        FIXTURES: path.join(directory, "data.json"),
        CALLS: calls,
        GITHUB_REPOSITORY: "owner/cue",
        GITHUB_RUN_ID: "7",
        GITHUB_RUN_ATTEMPT: String(attempt),
      },
    },
  );
  return { ...result, calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) };
}

it("passes a first attempt without reading any history", () => {
  const result = refuse(1, {});

  expect(result.status).toBe(0);
  expect(result.calls).toEqual([]);
});

it.each([
  "failure",
  "cancelled",
  "timed_out",
])("refuses a listed job that ended %s in an earlier attempt", (conclusion) => {
  const result = refuse(3, {
    1: [job("native-ios", "success", 1), job("native-e2e-ios-light (detail)", "success", 1)],
    2: [job("native-e2e-ios-light (detail)", conclusion, 2)],
  });

  expect(result.status).toBe(1);
  expect(result.stdout).toContain(`native-e2e-ios-light (detail): attempt 2 ${conclusion}`);
  expect(result.calls).toHaveLength(2);
});

it("passes a rerun whose earlier attempts passed or skipped every listed job", () => {
  expect(
    refuse(2, {
      1: [
        job("native-ios", "skipped", 1),
        job("native-e2e-ios-light (activity)", "success", 1),
        job("check", "failure", 1),
        job("native-e2e-ios-light-extra", "failure", 1),
      ],
    }).status,
  ).toBe(0);
});

it("fails when an earlier attempt cannot be read", () => {
  expect(refuse(3, { 1: [job("native-ios", "success", 1)] }).status).not.toBe(0);
});
