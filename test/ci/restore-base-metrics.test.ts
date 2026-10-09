import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

type Job = { name: string; conclusion: string | null };

type BaseRun = {
  run: { event: string; status: string; conclusion: string | null };
  polls: Job[][];
};

const STUB_GH = String.raw`#!/bin/sh
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
query() { printf '%s\n' "$url" | sed -n "s/.*[?&]$1=\([^&]*\).*/\1/p"; }
case $url in
  */workflows/ci.yml/runs*)
    jq --arg status "$(query status)" --arg event "$(query event)" \
      '.workflow_runs |= map(select(($status == "" or .status == $status or .conclusion == $status) and ($event == "" or .event == $event)))' \
      "$FIXTURES/runs.json" ;;
  */jobs*)
    echo poll >> "$FIXTURES/polls"
    poll=$(grep -c . "$FIXTURES/polls")
    [ -f "$FIXTURES/jobs-$poll.json" ] || poll=$(ls "$FIXTURES" | grep -c '^jobs-')
    cat "$FIXTURES/jobs-$poll.json" ;;
  *) echo '{"artifacts": []}' ;;
esac | jq -r "$filter"
`;

const ciFixtures = (base?: BaseRun): string => {
  const ci = tempDirectory("cue-restore-ci-");
  writeFile(
    path.join(ci, "runs.json"),
    JSON.stringify({ workflow_runs: base ? [{ id: 7, ...base.run }] : [] }),
  );
  for (const [index, jobs] of (base?.polls ?? [[]]).entries()) {
    writeFile(path.join(ci, `jobs-${index + 1}.json`), JSON.stringify({ jobs }));
  }
  writeFile(
    path.join(ci, "artifacts/cue-js-bundles/dist/_expo/static/js/ios/entry-a.hbc"),
    "ios-bundle",
  );
  writeFile(
    path.join(ci, "artifacts/cue-js-bundles/dist/_expo/static/js/android/entry-b.hbc"),
    "apk",
  );
  writeFile(
    path.join(ci, "artifacts/cue-native-android-sizes/head-android-sizes.json"),
    JSON.stringify([
      { name: "Firebase tester APK file", size: 300 },
      { name: "Play download estimate", size: 200 },
    ]),
  );
  return ci;
};

const restore = (repository: string, base?: BaseRun) => {
  const bin = tempDirectory("cue-restore-bin-");
  const ci = ciFixtures(base);
  writeFileSync(path.join(bin, "gh"), STUB_GH, { mode: 0o755 });
  writeFileSync(path.join(bin, "sleep"), `#!/bin/sh\necho "$1" >> "$FIXTURES/sleeps"\n`, {
    mode: 0o755,
  });
  const result = spawnSync(SCRIPT, [git(repository, "rev-parse", "HEAD")], {
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
  const lines = (file: string) =>
    existsSync(path.join(ci, file))
      ? readFileSync(path.join(ci, file), "utf8").trim().split("\n")
      : [];
  return { ...result, polls: lines("polls").length, sleeps: lines("sleeps") };
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

const job = (name: string, conclusion: string | null): Job => ({ name, conclusion });

const producersDone = [job("check", "success"), job("native-android", "success")];

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
      polls: [[...producersDone, job("native-ios", "failure")]],
    });

    expect(result.status).toBe(0);
    expect(baseMetrics(repository)).toEqual(MEASURED_BASE);
    expect(result.sleeps).toEqual([]);
  });

  it("waits a minute between polls for a base run still producing its artifacts", () => {
    const repository = nativeApp();
    const result = restore(repository, {
      run: { event: "push", status: "in_progress", conclusion: null },
      polls: [[job("check", "success"), job("native-android", null)], producersDone],
    });

    expect(result.status).toBe(0);
    expect(baseMetrics(repository)).toEqual(MEASURED_BASE);
    expect(result.sleeps).toEqual(["60"]);
  });

  it("gives up after 30 polls when the producing jobs never finish", () => {
    const result = restore(nativeApp(), {
      run: { event: "push", status: "in_progress", conclusion: null },
      polls: [[job("check", null)]],
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::Missing merge-base measurements");
    expect(result.polls).toBe(30);
    expect(result.sleeps).toEqual(Array(29).fill("60"));
  });

  it("fails at once when a producing job failed on the base", () => {
    const result = restore(nativeApp(), {
      run: { event: "push", status: "in_progress", conclusion: null },
      polls: [[job("check", "success"), job("native-android", "failure")]],
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::Missing merge-base measurements");
    expect(result.polls).toBe(1);
  });
});
