import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { waitForIOS } from "../../scripts/wait-ios-ready.mjs";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

it("readies the simulator in its final appearance, then runs Maestro once, in every iOS lane", () => {
  const lanes = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(
    ({ body }) => body.includes("runs-on: macos") && /maestro/i.test(body),
  );
  expect(lanes.map(({ name }) => name)).toEqual([
    "native-e2e-ios-light",
    "ui-screenshots-ios-dark",
  ]);
  for (const { name, body } of lanes) {
    const prepare = body.indexOf("scripts/prepare-ios-ui.sh");
    expect(body).toContain(
      `scripts/prepare-ios-ui.sh "$RUNNER_TEMP/native-ios-app" ${name.includes("dark") ? "dark" : "light"}\n`,
    );
    expect(body).not.toContain("simctl ui");
    const steps = body.slice(body.indexOf("    steps:"));
    expect(steps.startsWith("    steps:\n      - uses: actions/checkout@")).toBe(true);
    const server = steps.indexOf(
      'node scripts/start-ready-process.mjs scripts/mock-trakt/server.mjs "$RUNNER_TEMP/mock-trakt.log"',
    );
    expect(server).toBeGreaterThan(steps.indexOf("actions/checkout@"));
    expect(server).toBeLessThan(steps.indexOf("sudo xcode-select"));
    const boot = steps.indexOf('xcrun simctl boot "$device_id"');
    expect(server).toBeLessThan(boot);
    expect(boot).toBeGreaterThan(steps.indexOf("sudo xcode-select"));
    for (const operation of [
      "actions/setup-node@",
      "actions/download-artifact@",
      "scripts/prepare-ios-ui.sh",
    ]) {
      expect(boot).toBeLessThan(steps.indexOf(operation));
    }
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
  }
});

it("uses the early-booted device and settles after installation and launch", () => {
  const script = readFileSync(repositoryPath("scripts/prepare-ios-ui.sh"), "utf8");
  expect(script).toContain("device_id=${DEVICE_ID:?");
  expect(script).not.toMatch(/simctl boot\s/);
  expect(script).not.toContain("scripts/start-ready-process.mjs");
  expect(script).toContain("https://github.com/mobile-dev-inc/Maestro/releases/download/");
  const sequence = [
    "curl -fsSL",
    'tar -xzf "$app_dir/Cue.app.tgz"',
    'xcrun simctl install "$device_id"',
    'xcrun simctl bootstatus "$device_id" -b',
    'xcrun simctl ui "$device_id" appearance "$appearance"',
    'xcrun simctl launch --terminate-running-process "$device_id"',
    'xcrun simctl terminate "$device_id"',
    'node scripts/wait-ios-ready.mjs "$device_id"',
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
    "tar",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "xcrun",
    "node",
  ]);
  expect(readFileSync(path.join(directory.root, "github-path"), "utf8")).toBe(
    `${directory.root}/maestro/bin\n`,
  );
  expect(calls.at(-1)).toBe("node scripts/wait-ios-ready.mjs test-device");
});

it.each([
  "curl",
  "shasum",
  "unzip",
  "tar",
  "xcrun simctl install",
  "xcrun simctl bootstatus",
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
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  if (cached) mkdirSync(path.join(root, "maestro"));
  const calls = path.join(root, "calls");
  for (const command of ["curl", "shasum", "unzip", "tar", "xcrun", "node"]) {
    writeFileSync(
      path.join(bin, command),
      `#!/bin/sh\nprintf "%s\\n" "${command} $*" >> "$PROBE_CALLS"\ncase "${command} $*" in "$FAIL_COMMAND "*) exit 17 ;; esac\n`,
      { mode: 0o755 },
    );
  }
  return {
    root,
    calls,
    run: (failure = "") =>
      spawnSync("bash", [repositoryPath("scripts/prepare-ios-ui.sh"), root, "light"], {
        cwd: repositoryPath(""),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env["PATH"]}`,
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

it("requires three consecutive prompt successful appearance queries", async () => {
  const calls = probe(String.raw`
const fs = require('node:fs');
fs.appendFileSync(process.env.PROBE_CALLS, process.argv.slice(2).join(' ') + '\n');
const count = fs.readFileSync(process.env.PROBE_CALLS, 'utf8').trim().split('\n').length;
process.exit(count === 2 ? 1 : 0);
`);
  await waitForIOS("test-device", { timeoutMs: 5_000 });
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
