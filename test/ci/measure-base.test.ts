import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const COMPLEXITY = { cyclomatic: 3, cognitive: 4 };
const SIZES = [
  { name: "expo iOS bundle", size: 10 },
  { name: "expo Android bundle", size: 11 },
  { name: "Firebase tester APK file", size: 300 },
  { name: "Play download estimate", size: 200 },
];

const HARNESS = "$" + "{EXPO_PUBLIC_UI_HARNESS-unset}";
const ATLAS = "$" + "{EXPO_ATLAS-unset}";

// One script answers for every stubbed command through links, because macOS
// checks each newly written executable on its first run, about 0.2 s apiece.
const STUB = `#!/bin/sh
name=$(basename "$0")
case $name in
  pnpm)
    echo "pnpm $* harness=${HARNESS} atlas=${ATLAS}" >> "$LOG"
    case "$*" in *native-fingerprint.mjs*) echo "$BASE_FINGERPRINT" ;; esac ;;
  reembed-android.sh) echo "$name $(ls "$(dirname "$1")") harness=${HARNESS}" >> "$LOG" ;;
  *) echo "$name $*" >> "$LOG" ;;
esac
case $name in
  measure-sizes.sh) echo '${JSON.stringify(SIZES.slice(0, 2))}' > "$2" ;;
  measure-android-sizes.sh) echo '${JSON.stringify(SIZES.slice(2))}' > "$3" ;;
  download-ci-artifact.sh) [ "$FOUND" = true ] || exit 1; mkdir -p "$2" && touch "$2/from-download" ;;
  build-android-release.sh) mkdir -p "$1" && touch "$1/from-build" ;;
esac
`;
const STUBBED = [
  "scripts/measure-sizes.sh",
  "scripts/measure-android-sizes.sh",
  "scripts/download-ci-artifact.sh",
  "scripts/build-android-release.sh",
  "scripts/reembed-android.sh",
  "bin/pnpm",
];

const stubs = mkdtempSync(path.join(tmpdir(), "cue-measure-base-stub-"));
const stub = path.join(stubs, "stub");
writeFileSync(stub, STUB, { mode: 0o755 });
afterAll(() => rmSync(stubs, { recursive: true }));

const measure = (native: boolean, { base = "head-print", found = false, head = "head-print" }) => {
  const root = tempDirectory("cue-measure-base-");
  const repository = path.join(root, "repository");
  const scripts = path.join(root, "scripts");
  const bin = path.join(root, "bin");
  const headAndroid = path.join(root, "head-android");
  const log = path.join(root, "calls");
  for (const directory of [repository, scripts, bin, headAndroid]) mkdirSync(directory);
  writeFileSync(path.join(headAndroid, "from-head"), "");
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: repository, encoding: "utf8", env: gitEnv() });
  git("init", "--quiet");
  git("config", "user.name", "Cue Tests");
  git("config", "user.email", "cue-tests@example.invalid");
  const manifest = native ? "packages/native/package.json" : "packages/core/package.json";
  mkdirSync(path.join(repository, path.dirname(manifest)), { recursive: true });
  writeFileSync(path.join(repository, manifest), "{}\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");

  symlinkSync(repositoryPath("scripts/measure-base.sh"), path.join(scripts, "measure-base.sh"));
  writeFileSync(
    path.join(scripts, "measure-complexity.mjs"),
    `process.stdout.write(${JSON.stringify(JSON.stringify(COMPLEXITY))});\n`,
  );
  for (const command of STUBBED) symlinkSync(stub, path.join(root, command));

  const output = path.join(root, "base-metrics.json");
  const result = spawnSync(
    path.join(scripts, "measure-base.sh"),
    [repository, path.join(root, "bundletool.jar"), headAndroid, output],
    {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...gitEnv(),
        BASE_FINGERPRINT: base,
        EXPO_PUBLIC_UI_HARNESS: "1",
        FOUND: String(found),
        HEAD_FINGERPRINT: head,
        LOG: log,
        PATH: `${bin}:${process.env["PATH"]}`,
        RUNNER_TEMP: root,
      },
    },
  );
  const calls = () => readFileSync(log, "utf8").trim().split("\n");
  return { result, calls, metrics: () => JSON.parse(readFileSync(output, "utf8")) };
};

describe("measuring the merge base in the pull request's own run", () => {
  it("re-embeds the base JavaScript into the head's native shell when the fingerprints match", () => {
    const { result, calls, metrics } = measure(true, {});

    expect(result.status, result.stderr).toBe(0);
    expect(metrics()).toEqual({ sizes: SIZES, complexity: COMPLEXITY });
    expect(calls()).toEqual([
      expect.stringMatching(/^pnpm --dir \S+ install --frozen-lockfile /),
      expect.stringMatching(
        /^pnpm --filter @cue\/native exec expo export .* harness=unset atlas=true$/,
      ),
      expect.stringMatching(/^measure-sizes\.sh packages\/native /),
      expect.stringMatching(/^pnpm exec node scripts\/native-fingerprint\.mjs android /),
      "reembed-android.sh from-head harness=1",
      expect.stringMatching(/^measure-android-sizes\.sh /),
    ]);
  });

  it("re-embeds into the base fingerprint's published shell when the native code differs", () => {
    const { result, calls } = measure(true, { base: "base-print", found: true });

    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toContainEqual(
      expect.stringMatching(
        /^download-ci-artifact\.sh cue-native-android-base-print \S+ native-android$/,
      ),
    );
    expect(calls()).toContain("reembed-android.sh from-download harness=1");
    expect(calls().join("\n")).not.toMatch(/prebuild|build-android-release/);
  });

  it("builds the base shell when no run has published its fingerprint", () => {
    const { result, calls } = measure(true, { base: "base-print" });

    expect(result.status, result.stderr).toBe(0);
    const order = [
      "expo prebuild --platform android --clean",
      "build-android-release.sh",
      "reembed-android.sh from-build",
    ];
    const indexes = order.map((call) => calls().findIndex((line) => line.includes(call)));
    expect(indexes.every((index) => index !== -1)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it("measures a base without the native app as zero delivered bytes", () => {
    const { result, metrics } = measure(false, {});

    expect(result.status, result.stderr).toBe(0);
    expect(metrics()).toEqual({
      sizes: SIZES.map(({ name }) => ({ name, size: 0 })),
      complexity: COMPLEXITY,
    });
  });

  it("refuses to run without the head build's fingerprint", () => {
    const { result } = measure(true, { head: "" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HEAD_FINGERPRINT");
  });
});
