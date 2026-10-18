import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { leadInMs, tapAttachDelays } from "../../scripts/check-tap-lead-in.mjs";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const executable = (directory: string, name: string, source: string) =>
  writeFileSync(path.join(directory, name), source, { mode: 0o755 });

describe("check-runner-survives-freeze.sh", () => {
  const ISSUE = '{"code":"internal","errorMessage":"Failed to get screenshot: Timed out"}';
  const check = (overrides: Record<string, string> = {}) => {
    const root = tempDirectory("cue-freeze-");
    const calls = path.join(root, "calls");
    const stubs = path.join(root, "stubs.sh");
    writeFileSync(
      stubs,
      String.raw`
xcrun() { echo "xcrun $*" >> "$PROBE_CALLS"; printf 'PID\tStatus\tLabel\n%s\n' "$LAUNCHCTL"; }
kill() { echo "kill $*" >> "$PROBE_CALLS"; }
curl() {
  echo "curl $*" >> "$PROBE_CALLS"
  case "$*" in
    *"/screenshot"*)
      while [ $# -gt 0 ]; do [ "$1" = -o ] && printf '%s' "$SCREENSHOT_BODY" > "$2"; shift; done
      printf '%s' "$SCREENSHOT_STATUS" ;;
    *"/deviceInfo"*) [ "$DEVICE_INFO" = ok ] || return 22; echo '{"widthPoints":402}' ;;
  esac
}
`,
    );
    const log = path.join(root, "runner.log");
    writeFileSync(
      log,
      overrides["LOG"] ?? "Test Case '-[maestro_driver_iosUITests testHttpServer]' started.\n",
    );
    const result = spawnSync(
      "bash",
      [repositoryPath("scripts/check-runner-survives-freeze.sh"), log],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BASH_ENV: stubs,
          PROBE_CALLS: calls,
          DEVICE_ID: "test-device",
          MAESTRO_RUNNER_PORT: "7001",
          LAUNCHCTL: "4242\t0\tcom.apple.backboardd",
          SCREENSHOT_STATUS: "500",
          SCREENSHOT_BODY: ISSUE,
          DEVICE_INFO: "ok",
          ...overrides,
        },
      },
    );
    const made = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
    return { result, calls: made.map((call) => call.split(" ").slice(0, 2).join(" ")) };
  };

  it("freezes backboardd only around the screenshot, then requires the runner to answer", () => {
    const { result, calls } = check();

    expect(result.status, result.stderr).toBe(0);
    expect(calls).toEqual(["xcrun simctl", "kill -STOP", "curl -s", "kill -CONT", "curl -sSf"]);
    expect(result.stdout).toContain(`Screenshot with backboardd frozen: 500 ${ISSUE}`);
  });

  it.each([
    ["the screenshot succeeds", { SCREENSHOT_STATUS: "200", SCREENSHOT_BODY: "png" }],
    ["the server dies", { SCREENSHOT_STATUS: "000", SCREENSHOT_BODY: "" }],
    ["the runner answers without its issue", { SCREENSHOT_BODY: "{}" }],
    [
      "the handler reports a missing image instead of the issue",
      {
        SCREENSHOT_STATUS: "400",
        SCREENSHOT_BODY: '{"code":"precondition","errorMessage":"incorrect request body"}',
      },
    ],
    [
      "the server test ends",
      { LOG: "Test case 'maestro_driver_iosUITests.testHttpServer()' failed (31 seconds)\n" },
    ],
    ["the runner stops answering", { DEVICE_INFO: "dead" }],
  ])("fails and thaws backboardd when %s", (_, overrides) => {
    const { result, calls } = check(overrides);

    expect(result.status).not.toBe(0);
    expect(calls.slice(1, 4)).toEqual(["kill -STOP", "curl -s", "kill -CONT"]);
  });

  it("freezes nothing when backboardd is not running", () => {
    const { result, calls } = check({ LAUNCHCTL: "-\t0\tcom.apple.backboardd" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("backboardd is not running on test-device");
    expect(calls).toEqual(["xcrun simctl"]);
  });
});

describe("check-tap-lead-in.mjs", () => {
  const entry = (time: string, eventMessage: string) =>
    JSON.stringify({ timestamp: `2026-10-17 21:46:${time}-0700`, eventMessage });
  const ATTACH =
    "Service added: <IOHIDServiceClient 0x1 id:4294968795 primaryUsagePage:0xd transport:Recap>";

  it("measures each tap from its request to the next digitizer attach", () => {
    const delays = tapAttachDelays(
      [
        entry("00.990000", ATTACH),
        entry("01.000000", "Tapping 100.0, 200.0"),
        entry("01.020500", ATTACH),
        entry("01.130000", "Tapping took 0.13"),
        entry("02.000000", "Tapping 50.5, 60.0"),
        entry("02.080000", ATTACH),
        entry("03.000000", "Tapping 10.0, 10.0"),
        '{"count":7,"finished":1}',
      ].join("\n"),
    );

    expect(delays).toEqual([
      { tap: "Tapping 100.0, 200.0", delayMs: 20 },
      { tap: "Tapping 50.5, 60.0", delayMs: 80 },
      { tap: "Tapping 10.0, 10.0", delayMs: null },
    ]);
  });

  it("reads the lead-in from the runner patch", () => {
    expect(
      leadInMs(
        readFileSync(
          repositoryPath("patches/maestro-runner/0002-lead-in-touch-paths.patch"),
          "utf8",
        ),
      ),
    ).toBe(50);
  });

  it.each([
    [40, 0],
    [60, 1],
  ])("requires a tap whose digitizer attached within the lead-in (attached after %s ms)", (delay, status) => {
    const root = tempDirectory("cue-taps-");
    const output = path.join(root, "taps.ndjson");
    const log = [entry("01.000000", "Tapping 1.0, 2.0"), entry(`01.0${delay}000`, ATTACH)].join(
      "\n",
    );
    executable(
      root,
      "xcrun",
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${root}/args"\nprintf '%s\\n' '${log}'\n`,
    );
    const result = spawnSync(
      process.execPath,
      [
        repositoryPath("scripts/check-tap-lead-in.mjs"),
        "test-device",
        "2026-10-17 21:40:00",
        output,
      ],
      { encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env["PATH"]}` } },
    );

    expect(result.status, result.stderr).toBe(status);
    expect(result.stdout).toBe(`Tapping 1.0, 2.0: digitizer attached after ${delay} ms\n`);
    expect(readFileSync(output, "utf8")).toBe(`${log}\n`);
    expect(readFileSync(path.join(root, "args"), "utf8")).toContain(
      "simctl spawn test-device log show --style ndjson --info --start 2026-10-17 21:40:00 --predicate",
    );
  });
});
