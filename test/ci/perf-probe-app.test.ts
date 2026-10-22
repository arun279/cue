import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fakeBin } from "../support/fake-bin";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const APP = "cue-native-ios-abc123";

const bin = fakeBin({
  gh: `#!/usr/bin/env bash
case "$*" in
  *"/runs/42/artifacts"*) printf '101\\tios-harness-bundle\\n' ;;
  *"/artifacts/101/zip"*) cat "$STATE/bundle.zip" ;;
  *) echo "$*" >> "$STATE/unexpected"; exit 1 ;;
esac
`,
});

const helpers = fakeBin({
  "download-ci-artifact.sh": `#!/usr/bin/env bash
[ -n "\${STATE:-}" ] || exit 0
echo "$*" > "$STATE/download"
mkdir -p "$STATE/app/Cue.app" "$2"
tar -czf "$2/Cue.app.tgz" -C "$STATE/app" Cue.app
`,
  "reembed-ios.sh": `#!/usr/bin/env bash
[ -n "\${STATE:-}" ] || exit 0
echo "$*" > "$STATE/reembed"
`,
});

function fetchIos(bundle: Readonly<Record<string, string>>) {
  const state = tempDirectory("cue-probe-app-");
  const work = path.join(state, "work");
  mkdirSync(path.join(state, "bundle"), { recursive: true });
  for (const [name, contents] of Object.entries(bundle)) {
    writeFileSync(path.join(state, "bundle", name), contents);
  }
  spawnSync("zip", ["-qr", path.join(state, "bundle.zip"), "."], {
    cwd: path.join(state, "bundle"),
  });
  mkdirSync(work);
  symlinkSync(helpers, path.join(work, "scripts"));
  const destination = path.join(state, "app-out");
  const result = spawnSync(
    "bash",
    [repositoryPath("scripts/perf-probe-app.sh"), "ios", "42", destination],
    {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "o/r",
        PATH: `${bin}:${process.env["PATH"]}`,
        RUNNER_TEMP: state,
        STATE: state,
      },
    },
  );
  const read = (name: string) =>
    existsSync(path.join(state, name)) ? readFileSync(path.join(state, name), "utf8") : null;
  return { ...result, destination, read };
}

it("puts a run's harness JavaScript into the simulator app its bundle names, reading no run log", () => {
  const { status, stderr, destination, read } = fetchIos({
    "main.hbc": "bytecode",
    "app-artifact": `${APP}\n`,
  });

  expect(stderr).toBe("");
  expect(status).toBe(0);
  expect(read("unexpected")).toBeNull();
  expect(read("download")).toBe(`${APP} ${destination} native-ios\n`);
  expect(read("reembed")).toBe(`${destination}/Cue.app ${destination}/bundle\n`);
});

it("stops with a reason when a harness bundle names no simulator app", () => {
  const { status, stderr, read } = fetchIos({ "main.hbc": "bytecode" });

  expect(status).toBe(1);
  expect(stderr).toBe("run 42's harness bundle names no simulator app\n");
  expect(read("download")).toBeNull();
});
