import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fakeBin } from "../support/fake-bin";
import { REPOSITORY_ROOT, repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const HEAD = "abcdef1234567890";

const bin = fakeBin({
  gh: `#!/usr/bin/env bash
case "$1 $2" in
  "pr view") echo "${HEAD}"; exit ;;
  "run download") echo "$*" > "$STATE/download"; exit ;;
esac
for arg; do
  case $prev in --jq) filter=$arg ;; esac
  case $arg in sha=*) echo "\${arg#sha=}" > "$STATE/sha" ;; esac
  prev=$arg
done
jq -r "$filter" "$STATE/suites.json"
`,
});

const suite = (databaseId: number, event: string, workflow: string, status = "COMPLETED") => ({
  status,
  workflowRun: {
    databaseId,
    event,
    workflow: { resourcePath: `/o/r/actions/workflows/${workflow}` },
  },
});

const run = (script: string, args: string[]) => {
  const state = tempDirectory("cue-ci-runs-");
  const nodes = [
    suite(7, "pull_request", "ci.yml", "IN_PROGRESS"),
    { status: "COMPLETED", workflowRun: null },
    suite(9, "push", "codeql.yml"),
    suite(8, "push", "ci.yml"),
    suite(5, "pull_request", "ci.yml"),
  ];
  writeFileSync(
    path.join(state, "suites.json"),
    JSON.stringify({ data: { repository: { object: { checkSuites: { nodes } } } } }),
  );
  const result = spawnSync("bash", [repositoryPath(`scripts/${script}`), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "o/r",
      PATH: `${bin}:${process.env["PATH"]}`,
      STATE: state,
    },
  });
  return { ...result, state };
};

it("lists a commit's CI runs from its check suites, newest first", () => {
  const { stdout, stderr, status, state } = run("ci-runs.sh", [HEAD]);

  expect(stderr).toBe("");
  expect(status).toBe(0);
  expect(readFileSync(path.join(state, "sha"), "utf8")).toBe(`${HEAD}\n`);
  expect(stdout).toBe(
    "8\tpush\tCOMPLETED\n7\tpull_request\tIN_PROGRESS\n5\tpull_request\tCOMPLETED\n",
  );
});

it("downloads the screenshots of the newest CI run of a pull request's head", () => {
  const { stderr, status, state } = run("fetch-ui-screenshots.sh", ["185", "out"]);

  expect(stderr).toBe("");
  expect(status).toBe(0);
  expect(readFileSync(path.join(state, "download"), "utf8")).toBe(
    "run download 8 --pattern ui-* --dir out\n",
  );
});

const FILTERS = "actor|branch|check_suite_id|created|event|head_sha|status";
const RUN_LIST = String.raw`actions/(?:workflows/[^/\s"'?]+/)?runs`;
const SEARCHES = [
  new RegExp(String.raw`${RUN_LIST}\?[^\s"']*\b(?:${FILTERS})=`),
  new RegExp(String.raw`${RUN_LIST}\b(?!/)[^\n]*\s(?:-f|-F|--field|--raw-field)\s+(?:${FILTERS})=`),
  /\bgh\s+run\s+list\b[^\n]*\s(?:--(?:branch|commit|created|event|status|user)\b|-(?:b|c|e|s|u)\s)/,
  new RegExp(String.raw`listWorkflowRuns(?:ForRepo)?\(\{[^}]*\b(?:${FILTERS})\b`),
];
const searches = (source: string) => {
  const text = source.replace(/\\\n\s*/g, " ");
  return SEARCHES.flatMap((pattern) => text.match(pattern) ?? []);
};

it.each([
  'gh api "repos/$repo/actions/workflows/ci.yml/runs?head_sha=$base_sha&event=push&per_page=1"',
  'gh api "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?branch=$BRANCH&status=completed"',
  "gh api -X GET repos/o/r/actions/runs -f status=completed",
  'gh run list --workflow ci.yml --commit "$head_sha" --limit 1 \\\n    --json databaseId',
  "gh run list -b main",
  "octokit.rest.actions.listWorkflowRuns({ owner, repo, workflow_id, head_sha })",
])("catches a filtered run search: %s", (line) => {
  expect(searches(line)).not.toEqual([]);
});

it.each([
  'gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run/jobs?per_page=100"',
  'gh api "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?per_page=100"',
  'gh api "repos/$GITHUB_REPOSITORY/actions/artifacts?name=$name&per_page=100"',
  "gh run list --workflow ci.yml --limit 5",
  'gh run download "$run_id" --pattern ui-*',
])("leaves a lookup that is not a run search alone: %s", (line) => {
  expect(searches(line)).toEqual([]);
});

it("never reads CI runs from GitHub's filtered run search, which drops matching runs", () => {
  const files = [".github", "scripts"].flatMap((directory) =>
    readdirSync(repositoryPath(directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(REPOSITORY_ROOT, path.join(entry.parentPath, entry.name))),
  );

  expect(files).toContain("scripts/ci-runs.sh");
  expect(
    files.flatMap((file) =>
      searches(readFileSync(repositoryPath(file), "utf8")).map((match) => `${file}: ${match}`),
    ),
  ).toEqual([]);
});
