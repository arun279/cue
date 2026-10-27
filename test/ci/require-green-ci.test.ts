import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fakeBin } from "../support/fake-bin";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

type CheckRun = { name: string; status: string; conclusion: string | null };

const required: string[] = JSON.parse(
  readFileSync(repositoryPath(".github/required-checks.json"), "utf8"),
);
const passed = (name: string): CheckRun => ({ name, status: "completed", conclusion: "success" });

const bin = fakeBin({
  gh: `#!/bin/sh
[ -n "$PAGES" ] || exit 0
case "$*" in
  "api --paginate --slurp repos/owner/cue/commits/abc/check-runs?filter=all&per_page=100") cat "$PAGES" ;;
  *) exit 23 ;;
esac
`,
});

function gate(pages: CheckRun[][], repository = "owner/cue") {
  const fixture = path.join(tempDirectory("cue-release-gate-"), "pages.json");
  writeFileSync(fixture, JSON.stringify(pages.map((check_runs) => ({ check_runs }))));
  return spawnSync("bash", [repositoryPath("scripts/require-green-ci.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"]}`,
      PAGES: fixture,
      GH_TOKEN: "test",
      REPO: repository,
      SHA: "abc",
    },
  });
}

it("accepts a commit whose every required check passed, across result pages", () => {
  const [first = "", ...rest] = required;

  expect(gate([[passed(first)], rest.map(passed)]).status).toBe(0);
});

it.each([
  "check",
  "codeql (actions)",
])("rejects a commit missing the required check %s", (missing) => {
  const result = gate([required.filter((name) => name !== missing).map(passed)]);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain(`${missing}: missing`);
});

it.each([
  ["failure", "completed"],
  ["cancelled", "completed"],
  ["skipped", "completed"],
  ["timed_out", "completed"],
  [null, "in_progress"],
])("does not let a later success hide an earlier %s (%s) run", (conclusion, status) => {
  const result = gate([[{ name: "check", status, conclusion }, ...required.map(passed)]]);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain(`check: ${conclusion ?? status}`);
});

it("fails when the check runs cannot be read", () => {
  expect(gate([required.map(passed)], "owner/other").status).not.toBe(0);
});
