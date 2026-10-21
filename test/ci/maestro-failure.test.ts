import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

it.each([0, 17])("preserves Maestro exit %s and reports the failed command once", (status) => {
  const directory = tempDirectory("cue-maestro-");
  const flow = path.join(directory, "screens", "session", "app-discovery");
  mkdirSync(flow, { recursive: true });
  writeFileSync(
    path.join(flow, "commands.json"),
    JSON.stringify([
      {
        command: { assertConditionCommand: { visible: "screen-search" } },
        metadata: {
          status: "FAILED",
          error: { message: "Element screen-search is not visible" },
          artifacts: [{ kind: "SCREENSHOT", relativePath: "screenshots/step-003.png" }],
        },
      },
    ]),
  );
  writeFileSync(
    path.join(directory, "maestro"),
    '#!/bin/sh\necho run >> "$RUNS"\nexit "$RESULT"\n',
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    [
      repositoryPath("scripts/maestro-test.sh"),
      "test",
      ".maestro/ci/app.yaml",
      "--debug-output",
      path.join(directory, "debug"),
      "--test-output-dir",
      path.join(directory, "screens"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env["PATH"]}`,
        RESULT: String(status),
        RUNS: path.join(directory, "runs"),
      },
    },
  );
  expect(result.status, result.stderr).toBe(status);
  expect(readFileSync(path.join(directory, "runs"), "utf8")).toBe("run\n");
  if (status === 0) expect(result.stderr).toBe("");
  else {
    expect(result.stdout).toContain("Command: maestro --verbose test .maestro/ci/app.yaml");
    expect(result.stderr).toContain(`Failing flow: ${flow}`);
    expect(result.stderr).toContain(
      'Command: {"assertConditionCommand":{"visible":"screen-search"}}',
    );
    expect(result.stderr).toContain("Maestro reason: Element screen-search is not visible");
    expect(result.stderr).toContain(`Failure screenshot: ${flow}/screenshots/step-003.png`);
  }
});

it("prints the startup reason when command metadata is incomplete", () => {
  const directory = tempDirectory("cue-maestro-startup-");
  writeFileSync(path.join(directory, "commands.json"), "[");
  writeFileSync(path.join(directory, "maestro.log"), "Driver failed: connection closed");
  const result = spawnSync(
    process.execPath,
    [repositoryPath("scripts/maestro-failure.mjs"), "--debug-output", directory],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("Driver failed: connection closed");
  expect(result.stderr).toContain("Failure screenshot: not produced by Maestro");
});

it("names touches the simulator dropped before their digitizer was ready", () => {
  const directory = tempDirectory("cue-maestro-dropped-");
  const logs = path.join(directory, "flow", "logs");
  const dropped =
    "2026-10-18 03:41:52.549933+0000  localhost backboardd[4380]: [com.apple.BackBoard:TouchEvents] ignoring digitizer event for display <main> from unsupported service";
  mkdirSync(logs, { recursive: true });
  writeFileSync(
    path.join(logs, "device-simulator.log"),
    `03:41:46 backboardd: Service added: transport:Recap\n${dropped}\n03:41:54 backboardd: Service removed\n`,
  );
  const result = spawnSync(
    process.execPath,
    [repositoryPath("scripts/maestro-failure.mjs"), "--test-output-dir", directory],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(result.stderr.split("\n").filter((line) => line.startsWith("Dropped touch:"))).toEqual([
    `Dropped touch: ${dropped}`,
  ]);
});

const driverDeath = readFileSync(repositoryPath("test/ci/fixtures/ios-driver-death.txt"), "utf8");
const refused =
  "[Failed] Perform XCUITest driver status check on test-device, exception: java.net.ConnectException: Failed to connect to /127.0.0.1:49889";

const outlive = (name: string) =>
  `setTimeout(() => require('node:fs').appendFileSync(process.env.RUNS, '${name} outlived the supervisor\\n'), 60_000)`;

function runDriver(log: string, destination: string, hang = true, runner = "") {
  const directory = tempDirectory("cue-driver-death-");
  writeFileSync(
    path.join(directory, "maestro"),
    `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.RUNS, 'run\\n');
const log = process.env.DRIVER_LOG;
const midpoint = Math.floor(log.length / 2);
if (!process.argv.includes('--verbose')) process.exit(23);
const write = process.env.DESTINATION === 'log'
  ? (text) => { fs.appendFileSync(process.env.LOG_FILE, text); process.stdout.write(text); }
  : (text) => process[process.env.DESTINATION].write(text);
if (process.env.HANG === 'true') {
  require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(outlive("child"))}], {stdio: 'inherit'});
  ${outlive("maestro")};
}
fs.mkdirSync(require('node:path').dirname(process.env.LOG_FILE), {recursive: true});
write(log.slice(0, midpoint));
setImmediate(() => write(log.slice(midpoint)));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    [
      repositoryPath("scripts/maestro-test.sh"),
      "test",
      "flow.yaml",
      "--debug-output",
      path.join(directory, "debug"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env["PATH"]}`,
        DRIVER_LOG: log,
        DESTINATION: destination,
        HANG: String(hang),
        LOG_FILE: path.join(directory, "debug", "session", "maestro.log"),
        RUNS: path.join(directory, "runs"),
        USE_XCODE_TEST_RUNNER: runner,
      },
    },
  );
  expect(result.error).toBeUndefined();
  expect(existsSync(path.join(directory, "runs")), result.stderr).toBe(true);
  expect(readFileSync(path.join(directory, "runs"), "utf8")).toBe("run\n");
  return result;
}

it.each([
  "stdout",
  "stderr",
  "log",
])("kills a hung Maestro process group on deviceInfo 500 from %s, including split writes", (destination) => {
  const result = runDriver(driverDeath, destination);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("XCTest driver died during startup");
  expect(result.stderr).toContain("Timed out while evaluating UI query on SpringBoard");
  expect(result.stderr).toContain("/deviceInfo failed, code: 500");
});

it.each([
  `[Done] Perform XCUITest driver status check on test-device\n${refused}`,
  "XCTestDriver request failed. Status code: 500, path: http://127.0.0.1:49889/deviceInfo, body: unknown",
  "iOS driver not ready in time, consider increasing timeout by configuring MAESTRO_DRIVER_STARTUP_TIMEOUT env variable",
])("fails fast on terminal driver status: %s", (log) => {
  const result = runDriver(log, "log");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("XCTest driver died during startup");
});

it("fails fast on the first refused status check of a runner started before Maestro", () => {
  const result = runDriver(`${refused}\n`, "stdout", true, "1");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("XCTest driver died during startup");
});

it("allows initial connection refusals and unrelated HTTP errors", () => {
  const result = runDriver(
    `${refused}\n[Failed] Perform XCUITest driver status check on test-device, exception: java.net.SocketTimeoutException: timeout\nRequest for http://127.0.0.1:49889/viewHierarchy failed, code: 500\nGot device info: DeviceInfo(platform=IOS)\n`,
    "stdout",
    false,
  );
  expect(result.status).toBe(0);
  expect(result.stderr).not.toContain("XCTest driver died during startup");
});

it("does not mistake an incomplete initial status line for driver death", () => {
  const result = runDriver(
    "[Failed] Perform XCUITest driver status check on test-device",
    "stdout",
    false,
  );
  expect(result.status).toBe(0);
});
