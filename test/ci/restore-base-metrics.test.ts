import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const SCRIPT = repositoryPath("scripts/restore-base-metrics.sh");

const git = (repository: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8", env: gitEnv() }).trim();

const writeFile = (file: string, contents: string): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
};

const baseCommit = (files: Record<string, string>): string => {
  const repository = tempDirectory("cue-restore-base-");
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Cue Tests");
  git(repository, "config", "user.email", "cue-tests@example.invalid");
  for (const [file, contents] of Object.entries(files))
    writeFile(path.join(repository, file), contents);
  git(repository, "add", ".");
  git(repository, "commit", "--quiet", "-m", "base");
  return repository;
};

type Job = { name: string; status: string; conclusion: string | null };

type BaseRun = {
  run: { event: string; status: string; conclusion: string | null };
  jobs: Job[];
  artifact?: boolean;
  runs?: number[];
  head?: string;
  workflow?: string;
};

const STUB_GH = `#!/bin/sh
if [ "$1" = run ]; then
  [ -d "$FIXTURES/artifacts/$7" ] || exit 1
  mkdir -p "$9" && cp -R "$FIXTURES/artifacts/$7/." "$9"
  exit 0
fi
for arg; do
  case $prev in --jq) filter=$arg ;; esac
  case $arg in repos/*) url=$arg ;; esac
  prev=$arg
done
case $url in
  */workflows/ci.yml/runs*) cat "$FIXTURES/runs.json" ;;
  */jobs*) cat "$FIXTURES/jobs.json" ;;
  */actions/runs/7) cat "$FIXTURES/run.json" ;;
  *) echo '{"artifacts": []}' ;;
esac | if [ -n "$filter" ]; then jq -r "$filter"; else cat; fi
`;

const NO_BASE: Partial<BaseRun> = {};

const ciFixtures = (sha: string, base?: BaseRun): string => {
  const ci = tempDirectory("cue-restore-ci-");
  const {
    run,
    jobs = [],
    artifact = true,
    runs = [7],
    head = sha,
    workflow = ".github/workflows/ci.yml",
  } = base ?? NO_BASE;
  writeFile(
    path.join(ci, "runs.json"),
    JSON.stringify([{ workflow_runs: run ? runs.map((id) => ({ id, ...run })) : [] }]),
  );
  writeFile(
    path.join(ci, "run.json"),
    JSON.stringify({ id: 7, head_sha: head, path: workflow, ...run }),
  );
  writeFile(path.join(ci, "jobs.json"), JSON.stringify([{ jobs }]));
  if (artifact) {
    writeFile(
      path.join(ci, `artifacts/cue-footprint-${sha}/head-metrics.json`),
      JSON.stringify(MEASURED_BASE),
    );
  }
  return ci;
};

const restore = (repository: string, base?: BaseRun) => {
  const bin = tempDirectory("cue-restore-bin-");
  const sha = git(repository, "rev-parse", "HEAD");
  const ci = ciFixtures(sha, base);
  writeFileSync(path.join(bin, "gh"), STUB_GH, { mode: 0o755 });
  writeFileSync(path.join(bin, "sleep"), `#!/bin/sh\nexit 99\n`, {
    mode: 0o755,
  });
  return spawnSync(SCRIPT, [sha], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...gitEnv(),
      FIXTURES: ci,
      GITHUB_REPOSITORY: "owner/cue",
      PATH: `${bin}:${process.env["PATH"]}`,
      RUNNER_TEMP: tempDirectory("cue-restore-runner-"),
    },
  });
};

const baseMetrics = (repository: string): unknown =>
  JSON.parse(readFileSync(path.join(repository, "base-metrics.json"), "utf8"));

const MEASURED_BASE = {
  sizes: [
    { name: "expo iOS bundle", size: 10 },
    { name: "expo Android bundle", size: 3 },
    { name: "Firebase tester APK file", size: 300 },
    { name: "Play download estimate", size: 200 },
  ],
};

const job = (name: string, conclusion: string | null): Job => ({
  name,
  status: conclusion === null ? "in_progress" : "completed",
  conclusion,
});

const producersDone = [job("footprint", "success")];

const nativeApp = () => baseCommit({ "packages/native/package.json": "{}\n" });

describe("restoring the merge-base measurement", () => {
  it("measures a base without the native app as zero delivered bytes", () => {
    const repository = baseCommit({ "packages/core/package.json": "{}\n" });

    expect(restore(repository).status).toBe(0);
    expect(baseMetrics(repository)).toEqual({
      sizes: [
        { name: "expo iOS bundle", size: 0 },
        { name: "expo Android bundle", size: 0 },
        { name: "Firebase tester APK file", size: 0 },
        { name: "Play download estimate", size: 0 },
      ],
    });
  });

  it("fails when a base with the native app has no measurement left", () => {
    const result = restore(nativeApp());

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::Missing merge-base measurements");
  });

  it("measures a base whose run failed only outside the producing jobs", () => {
    const repository = nativeApp();
    const result = restore(repository, {
      run: { event: "push", status: "completed", conclusion: "failure" },
      jobs: [...producersDone, job("native-ios", "failure")],
    });

    expect(result.status).toBe(0);
    expect(baseMetrics(repository)).toEqual(MEASURED_BASE);
  });

  it("rejects an incomplete base run even when its producer jobs passed", () => {
    const result = restore(nativeApp(), {
      run: { event: "push", status: "in_progress", conclusion: null },
      jobs: producersDone,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("not a completed push CI run");
  });

  it.each([
    "failure",
    "cancelled",
    null,
  ])("rejects an unsuccessful producing job: %s", (conclusion) => {
    const result = restore(nativeApp(), {
      run: { event: "push", status: "completed", conclusion: "failure" },
      jobs: [job("footprint", conclusion)],
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing or unsuccessful footprint jobs");
  });

  it.each([
    { head: "wrong" },
    { workflow: ".github/workflows/other.yml" },
  ])("rejects a run belonging elsewhere: %j", (identity) => {
    const result = restore(nativeApp(), {
      run: { event: "push", status: "completed", conclusion: "success" },
      jobs: producersDone,
      ...identity,
    });
    expect(result.status).toBe(1);
  });
  it("fails when the completed base run did not publish its measurement", () => {
    const result = restore(nativeApp(), {
      run: { event: "push", status: "completed", conclusion: "success" },
      jobs: producersDone,
      artifact: false,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("has no cue-footprint-");
  });

  it("does not choose the latest of multiple base runs", () => {
    const result = restore(nativeApp(), {
      run: { event: "push", status: "completed", conclusion: "success" },
      jobs: producersDone,
      runs: [7, 8],
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("provide BASE_CI_RUN_ID");
  });

  it("rejects an earlier failed footprint attempt even after a successful rerun", () => {
    const result = restore(nativeApp(), {
      run: { event: "push", status: "completed", conclusion: "success" },
      jobs: [job("footprint", "failure"), ...producersDone],
    });
    expect(result.status).toBe(1);
  });
});

it("waits for the base commit's CI run to finish instead of failing while it is still running", () => {
  const script = readFileSync(SCRIPT, "utf8");
  const wait = script.indexOf('gh run watch "$run_id"');
  expect(wait).toBeGreaterThan(-1);
  expect(wait).toBeLessThan(script.indexOf('.status == "completed"'));
});
