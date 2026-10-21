import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { waitForIOS } from "../../scripts/wait-ios-ready.mjs";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

it("readies the simulator in its final appearance, starts the runner, then runs Maestro once, in every iOS lane", () => {
  const lanes = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(
    ({ body }) => body.includes("runs-on: macos") && body.includes("scripts/maestro-test.sh"),
  );
  expect(lanes.map(({ name }) => name)).toEqual([
    "native-e2e-ios-light",
    "ui-screenshots-ios-dark",
  ]);
  for (const { name, body } of lanes) {
    const prepare = body.indexOf("scripts/prepare-ios-ui.sh");
    expect(body).toContain(
      `scripts/prepare-ios-ui.sh "$RUNNER_TEMP/native-ios-app/Cue.app" ${name.includes("dark") ? "dark" : "light"}\n`,
    );
    expect(body).not.toContain("simctl ui");
    const steps = body.slice(body.indexOf("    steps:"));
    expect(steps.startsWith("    steps:\n      - uses: actions/checkout@")).toBe(true);
    const server = steps.indexOf(
      'node scripts/start-ready-process.mjs scripts/mock-trakt/server.mjs "$RUNNER_TEMP/mock-trakt.log"',
    );
    const boot = steps.indexOf('xcrun simctl boot "$device_id"');
    expect(boot).toBeGreaterThan(steps.indexOf("sudo xcode-select"));
    expect(steps.indexOf("sudo xcode-select")).toBeGreaterThan(steps.indexOf("actions/checkout@"));
    for (const operation of [
      "actions/download-artifact@",
      "name: Unpack the simulator app",
      "name: Embed the harness JavaScript",
      "name: Cache Maestro CLI",
      "name: Unpack the Maestro runner",
    ]) {
      expect(boot).toBeLessThan(steps.indexOf(operation));
      expect(server).toBeGreaterThan(steps.indexOf(operation));
    }
    expect(server).toBeLessThan(steps.indexOf("scripts/prepare-ios-ui.sh"));
    expect(steps).toContain('echo "DEVICE_ID=$device_id" >> "$GITHUB_ENV"');
    const cache = steps
      .split(/^ {6}- /m)
      .find((step) => step.startsWith("name: Cache Maestro CLI"));
    const script = readFileSync(repositoryPath("scripts/prepare-ios-ui.sh"), "utf8");
    const version = script.match(/releases\/download\/cli-([\d.]+)\//)?.[1];
    const checksum = script.match(/echo "([a-f0-9]{64}) /)?.[1];
    expect(version).toBeDefined();
    expect(checksum).toBeDefined();
    expect(cache).toContain("actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0");
    expect(cache).toContain("path: $" + "{{ runner.temp }}/maestro\n");
    expect(cache).toContain(
      `key: maestro-\${{ runner.os }}-\${{ runner.arch }}-${version}-${checksum}\n`,
    );
    expect(cache).not.toContain("restore-keys:");
    expect(steps.indexOf("name: Cache Maestro CLI")).toBeGreaterThan(boot);
    expect(steps.indexOf("name: Cache Maestro CLI")).toBeLessThan(
      steps.indexOf("scripts/prepare-ios-ui.sh"),
    );
    const runs = [...body.matchAll(/^\s*bash scripts\/maestro-test\.sh\s.*$/gm)];
    expect(prepare).toBeGreaterThan(-1);
    expect(runs.map(([run]) => run.trim())).toEqual([
      expect.stringMatching(/^bash scripts\/maestro-test\.sh --device "\$DEVICE_ID" test /),
    ]);
    expect(runs[0]?.index).toBeGreaterThan(prepare);
    const runner = body.indexOf(
      'node scripts/start-ready-process.mjs scripts/maestro-runner.mjs "$RUNNER_TEMP/maestro-runner.log" 300000\n',
    );
    expect(runner).toBeGreaterThan(prepare);
    expect(runs[0]?.index).toBeGreaterThan(runner);
    expect(runs[0]?.[0]).toContain(' test --driver-host-port "$MAESTRO_RUNNER_PORT" ');
    expect(body).toContain('      USE_XCODE_TEST_RUNNER: "1"\n');
    expect(body).not.toContain("MAESTRO_DRIVER_STARTUP_TIMEOUT");
    expect(body).toContain("$" + "{{ runner.temp }}/maestro-runner.log\n");
  }
});

it("freezes backboardd under the started runner before the dark flow and checks its taps after", () => {
  const dark =
    readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).find(
      ({ name }) => name === "ui-screenshots-ios-dark",
    )?.body ?? "";
  const order = [
    "scripts/maestro-runner.mjs",
    'scripts/check-runner-survives-freeze.sh "$RUNNER_TEMP/maestro-runner.log"\n',
    'echo "FLOW_STARTED=$(date \'+%Y-%m-%d %H:%M:%S\')" >> "$GITHUB_ENV"\n',
    "bash scripts/maestro-test.sh",
    'node scripts/check-tap-lead-in.mjs "$DEVICE_ID" "$FLOW_STARTED" "$RUNNER_TEMP/tap-evidence.ndjson"\n',
  ].map((text) => dark.indexOf(text));

  expect(order.every((index) => index !== -1)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(dark).toContain("$" + "{{ runner.temp }}/tap-evidence.ndjson\n");
});

it("uses the early-booted device and settles after installation and launch", () => {
  const script = readFileSync(repositoryPath("scripts/prepare-ios-ui.sh"), "utf8");
  expect(script).toContain("device_id=${DEVICE_ID:?");
  expect(script).not.toMatch(/simctl boot\s/);
  expect(script).not.toContain("scripts/start-ready-process.mjs");
  expect(script).toContain("https://github.com/mobile-dev-inc/Maestro/releases/download/");
  const sequence = [
    "curl -fsSL",
    'xcrun simctl install "$device_id" "$app"',
    'xcrun simctl bootstatus "$device_id" -b\nscripts/disable-ios-daemons.sh "$device_id" --booted\n',
    'xcrun simctl ui "$device_id" appearance "$appearance"',
    'xcrun simctl launch --terminate-running-process "$device_id"',
    'xcrun simctl terminate "$device_id"',
    'node scripts/wait-ios-ready.mjs "$device_id"',
    'scripts/snapshot-host-resources.sh "$RUNNER_TEMP/host-resources-prepared.txt"',
  ].map((command) => script.indexOf(command));
  expect(sequence.every((index) => index !== -1)).toBe(true);
  expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
});

it.each([false, true])("prepares the app with a Maestro cache hit of %s", (cached) => {
  const directory = preparation(cached);
  const result = directory.run();
  expect(result.status, result.stderr).toBe(0);
  const calls = readFileSync(directory.calls, "utf8").trim().split("\n");
  expect(calls.map((call) => call.split(" ")[0])).toEqual([
    ...(cached ? [] : ["curl", "shasum", "unzip"]),
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "node",
    "sysctl",
    "vm_stat",
    "ps",
  ]);
  expect(readFileSync(path.join(directory.root, "github-path"), "utf8")).toBe(
    `${directory.root}/maestro/bin\n`,
  );
  expect(calls).toContain(`xcrun simctl install test-device ${directory.root}/Cue.app`);
  const booted = calls.indexOf("xcrun simctl bootstatus test-device -b");
  expect(calls.slice(booted + 1, booted + 3)).toEqual(
    Array(2).fill("xcrun simctl spawn test-device launchctl list"),
  );
  expect(calls).toContain(
    "xcrun simctl spawn test-device defaults write com.apple.launchservices.schemeapproval com.apple.CoreSimulator.CoreSimulatorBridge-->cue -string app.cuetracker",
  );
  expect(calls).toContain("node scripts/wait-ios-ready.mjs test-device");
  expect(
    readFileSync(path.join(directory.root, "host-resources-prepared.txt"), "utf8").split("\n"),
  ).toEqual(["sysctl vm.swapusage", "vm_stat ", "ps -axo pid,ppid,time,rss,comm", ""]);
});

it.each([
  "curl",
  "shasum",
  "unzip",
  "xcrun simctl install",
  "xcrun simctl bootstatus",
  "xcrun simctl spawn",
])("stops preparation when %s fails", (command) => {
  const directory = preparation(false);
  const result = directory.run(command);
  expect(result.status, result.stderr).toBe(17);
  const calls = readFileSync(directory.calls, "utf8").trim().split("\n");
  expect(calls.at(-1)?.startsWith(`${command} `)).toBe(true);
  expect(calls.some((call) => call.startsWith("node "))).toBe(false);
});

function preparation(cached: boolean) {
  const root = tempDirectory("cue-ios-prepare-");
  if (cached) mkdirSync(path.join(root, "maestro"));
  const calls = path.join(root, "calls");
  const stubs = path.join(root, "stubs.sh");
  writeFileSync(
    stubs,
    ["curl", "shasum", "unzip", "xcrun", "node", "sysctl", "vm_stat", "ps"]
      .map(
        (command) =>
          `${command}() {\n${command === "shasum" ? "  cat > /dev/null\n" : ""}  printf "%s\\n" "${command} $*" >> "$PROBE_CALLS"\n  ${["sysctl", "vm_stat", "ps"].includes(command) ? `echo "${command} $*"\n  ` : ""}case "${command} $*" in "$FAIL_COMMAND "*) return 17 ;; esac\n}\n`,
      )
      .join(""),
  );
  return {
    root,
    calls,
    run: (failure = "") =>
      spawnSync("bash", [repositoryPath("scripts/prepare-ios-ui.sh"), `${root}/Cue.app`, "light"], {
        cwd: repositoryPath(""),
        encoding: "utf8",
        env: {
          ...process.env,
          BASH_ENV: stubs,
          RUNNER_TEMP: root,
          GITHUB_PATH: path.join(root, "github-path"),
          DEVICE_ID: "test-device",
          PROBE_CALLS: calls,
          FAIL_COMMAND: failure,
        },
      }),
  };
}

afterEach(() => vi.unstubAllEnvs());

function probe(source: string) {
  const directory = tempDirectory("cue-ios-ready-");
  const calls = path.join(directory, "calls");
  writeFileSync(path.join(directory, "xcrun"), `#!${process.execPath}\n${source}`, { mode: 0o755 });
  vi.stubEnv("PATH", `${directory}:${process.env["PATH"]}`);
  vi.stubEnv("PROBE_CALLS", calls);
  return calls;
}

it("requires three consecutive successful appearance queries", async () => {
  const calls = probe(String.raw`
const fs = require('node:fs');
fs.appendFileSync(process.env.PROBE_CALLS, process.argv.slice(2).join(' ') + '\n');
const count = fs.readFileSync(process.env.PROBE_CALLS, 'utf8').trim().split('\n').length;
process.exit(count === 2 ? 1 : 0);
`);
  await waitForIOS("test-device", { timeoutMs: 5_000, promptMs: Number.POSITIVE_INFINITY });
  expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(
    Array(5).fill("simctl ui test-device appearance"),
  );
});

it("does not count a slow successful query as ready", async () => {
  probe("process.exit(0);");
  await expect(waitForIOS("test-device", { timeoutMs: 2_000, promptMs: 0 })).rejects.toThrow(
    "iOS readiness watchdog expired",
  );
});

it("kills a stuck query under the single overall watchdog", async () => {
  probe("setTimeout(() => {}, 10_000);");
  const started = performance.now();
  await expect(waitForIOS("test-device", { timeoutMs: 200 })).rejects.toThrow(
    "iOS readiness watchdog expired after 200 ms for test-device",
  );
  expect(performance.now() - started).toBeLessThan(2_000);
});
