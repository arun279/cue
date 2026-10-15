import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const required: string[] = JSON.parse(
  readFileSync(repositoryPath(".github/required-checks.json"), "utf8"),
);
const job = (name: string, conclusion = "success", run_attempt = 1) => ({
  name,
  conclusion,
  status: "completed",
  run_attempt,
});
const run = (workflow: string) => ({
  head_sha: "abc",
  path: `.github/workflows/${workflow}.yml`,
  event: "push",
  status: "completed",
  run_attempt: 1,
});

function gate(
  change: {
    ci?: object;
    codeql?: object;
    first?: ReturnType<typeof job>[];
    second?: ReturnType<typeof job>[];
  } = {},
) {
  const directory = tempDirectory("cue-release-gate-");
  const first = change.first ?? required.map((name) => job(name));
  const responses = {
    "1": { ...run("ci"), ...change.ci },
    "2": { ...run("codeql"), ...change.codeql },
    "1/attempts/1/jobs": [{ jobs: first.filter(({ name }) => !name.startsWith("codeql (")) }],
    "2/attempts/1/jobs": [{ jobs: first.filter(({ name }) => name.startsWith("codeql (")) }],
    "1/attempts/2/jobs": [{ jobs: change.second ?? [] }],
  };
  writeFileSync(path.join(directory, "data.json"), JSON.stringify(responses));
  writeFileSync(
    path.join(directory, "gh"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const url = process.argv.find(arg => arg.startsWith('repos/'));
const key = url.split('/runs/')[1].split('?')[0];
const value = JSON.parse(fs.readFileSync(process.env.FIXTURES))[key];
if (!value) process.exit(23);
process.stdout.write(JSON.stringify(value));
`,
    { mode: 0o755 },
  );
  return spawnSync("bash", [repositoryPath("scripts/require-green-ci.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env["PATH"]}`,
      FIXTURES: path.join(directory, "data.json"),
      GH_TOKEN: "test",
      REPO: "owner/cue",
      SHA: "abc",
      CI_RUN_ID: "1",
      CODEQL_RUN_ID: "2",
    },
  });
}

it("accepts the identified completed runs for the exact commit", () => {
  expect(gate().status).toBe(0);
});

it.each([
  { head_sha: "other" },
  { path: ".github/workflows/other.yml" },
  { event: "pull_request" },
  { status: "in_progress" },
])("rejects an ineligible CI or CodeQL run: %j", (identity) => {
  expect(gate({ ci: identity }).status).toBe(1);
  expect(gate({ codeql: identity }).status).toBe(1);
});

it.each([
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
])("does not replace an earlier %s with a successful attempt", (conclusion) => {
  const result = gate({
    ci: { run_attempt: 2 },
    first: required.map((name) => job(name, name === "check" ? conclusion : "success")),
    second: [job("check", "success", 2)],
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(`check: attempt 1 ${conclusion}`);
});

it("accepts a partial rerun only when every recorded attempt passed", () => {
  expect(gate({ ci: { run_attempt: 2 }, second: [job("check", "success", 2)] }).status).toBe(0);
});

it.each(["check", "codeql (actions)"])("rejects a missing required job: %s", (missing) => {
  const result = gate({
    first: required.filter((name) => name !== missing).map((name) => job(name)),
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(`${missing}: missing`);
});

it("fails an API error without accepting incomplete attempt evidence", () => {
  expect(gate({ ci: { run_attempt: 3 } }).status).not.toBe(0);
});
