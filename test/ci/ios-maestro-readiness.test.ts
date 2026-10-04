import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

const FAKE_MAESTRO = `#!/usr/bin/env bash
attempt=$(( $(cat "$STATE/attempts" 2>/dev/null || echo 0) + 1 ))
echo "$attempt" > "$STATE/attempts"
while [[ $# -gt 0 ]]; do
  [[ $1 == --debug-output ]] && debug_output=$2
  shift
done
mkdir -p "$debug_output/.maestro/tests/$attempt"
cp "$STATE/log-$attempt" "$debug_output/.maestro/tests/$attempt/maestro.log"
exit "$(cat "$STATE/status-$attempt")"
`;

const start = (command: string) =>
  `[ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: ${command} RUNNING`;
const finish = (command: string, result = "COMPLETED") =>
  `[ INFO] maestro.cli.runner.CliConsoleListener.onCommandFinished: ${command} ${result}`;
const LAUNCH = 'Launch app "app.cuetracker" with clear state and clear keychain';
const ONBOARDING = "Assert that id: screen-onboarding is visible";
const SETUP = [
  start("Define variables"),
  finish("Define variables"),
  start("Apply configuration"),
  finish("Apply configuration"),
  start("Run ../flows/launch.yaml"),
  start("Run lib/connect.yaml"),
  start(LAUNCH),
];
const latch = (call: string) =>
  `[ERROR] xcuitest.XCTestDriverClient.transportCall: Transport unreachable while processing ${call}, latching`;

const FIRST_LAUNCH_EXIT = [...SETUP, latch("setPermissions")];
const MID_FLOW_EXIT = [
  ...SETUP,
  finish(LAUNCH),
  start(ONBOARDING),
  finish(ONBOARDING),
  start("Tap on id: snackbar-undo"),
  latch("deviceInfo"),
];
const LAUNCH_FAILURE = [...SETUP, finish(LAUNCH, "FAILED")];
const ASSERTION_FAILURE = [
  ...SETUP,
  finish(LAUNCH),
  start(ONBOARDING),
  finish(ONBOARDING, "FAILED"),
];
const PASSED = [...SETUP, finish(LAUNCH), start(ONBOARDING), finish(ONBOARDING)];

type Attempt = { log: string[]; status: number };

function run(...attempts: Attempt[]) {
  const directory = tempDirectory("cue-maestro-ios-");
  const state = path.join(directory, "state");
  const bin = path.join(directory, "bin");
  spawnSync("mkdir", ["-p", state, bin]);
  writeFileSync(path.join(bin, "maestro"), FAKE_MAESTRO);
  chmodSync(path.join(bin, "maestro"), 0o755);
  attempts.forEach(({ log, status }, index) => {
    writeFileSync(path.join(state, `log-${index + 1}`), `${log.join("\n")}\n`);
    writeFileSync(path.join(state, `status-${index + 1}`), String(status));
  });
  const result = spawnSync(
    "bash",
    [repositoryPath("scripts/maestro-ios-test.sh"), path.join(directory, "debug"), "flow.yaml"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DEVICE_ID: "device",
        PATH: `${bin}:${process.env["PATH"]}`,
        STATE: state,
      },
    },
  );
  return {
    status: result.status,
    attempts: Number(readFileSync(path.join(state, "attempts"), "utf8")),
  };
}

describe("iOS Maestro driver retry", () => {
  it("runs once when the flow passes", () => {
    expect(run({ log: PASSED, status: 0 })).toEqual({ status: 0, attempts: 1 });
  });

  it("restarts the driver once when it exits during the first launch", () => {
    expect(run({ log: FIRST_LAUNCH_EXIT, status: 1 }, { log: PASSED, status: 0 })).toEqual({
      status: 0,
      attempts: 2,
    });
    expect(
      run({ log: FIRST_LAUNCH_EXIT, status: 1 }, { log: FIRST_LAUNCH_EXIT, status: 1 }),
    ).toEqual({ status: 1, attempts: 2 });
  });

  it("never retries a failure without the driver exit or past the first launch", () => {
    expect(run({ log: LAUNCH_FAILURE, status: 1 })).toEqual({ status: 1, attempts: 1 });
    expect(run({ log: MID_FLOW_EXIT, status: 1 })).toEqual({ status: 1, attempts: 1 });
    expect(run({ log: ASSERTION_FAILURE, status: 1 })).toEqual({ status: 1, attempts: 1 });
  });
});

it("readies the simulator before every iOS Maestro run", () => {
  const lanes = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(
    ({ body }) => body.includes("runs-on: macos") && /maestro/i.test(body),
  );
  expect(lanes.map(({ name }) => name)).toEqual([
    "native-e2e-ios-light",
    "ui-screenshots-ios-dark",
  ]);
  for (const { body } of lanes) {
    const prepare = body.indexOf("scripts/prepare-ios-ui.sh");
    expect(prepare).toBeGreaterThan(-1);
    expect(body.indexOf("scripts/maestro-ios-test.sh")).toBeGreaterThan(prepare);
    expect(body).not.toMatch(/^\s*maestro\s/m);
  }
});
