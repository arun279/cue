import { readFileSync, writeFileSync } from "node:fs";
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
    'xcrun simctl bootstatus "$device_id" -b',
    'xcrun simctl ui "$device_id" appearance "$appearance"',
    'xcrun simctl install "$device_id"',
    'xcrun simctl launch --terminate-running-process "$device_id"',
    'xcrun simctl terminate "$device_id"',
    'node scripts/wait-ios-ready.mjs "$device_id"',
  ].map((command) => script.indexOf(command));
  expect(sequence.every((index) => index !== -1)).toBe(true);
  expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
});

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
