import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  largestProcesses,
  latencySummary,
  pageIns,
  peaks,
  screenshotLatencies,
  silenceWatch,
} from "../../scripts/lane-health.mjs";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const line = (at: string, message: string) =>
  `2026-10-21 ${at} Df testmanagerd[11417:3a1] [com.apple.dt.xctest:Default] ${message}`;
const request = (at: string) => line(at, "Requesting screenshot.");
const reply = (at: string) => line(at, "Got system UI orientation ({pid=4849}) 1");
const SINCE = new Date("2026-10-21T07:00:00");

it("times each screenshot from testmanagerd's request to SpringBoard's reply", () => {
  const timings = screenshotLatencies(
    [
      request("06:59:59.000"),
      reply("06:59:59.100"),
      request("07:00:01.000"),
      reply("07:00:01.250"),
      'Filtering the log data using "process == testmanagerd"',
      request("07:00:02.000"),
      reply("07:00:05.500"),
    ],
    SINCE,
  );

  expect(timings.requests).toBe(2);
  expect(timings.replies).toBe(2);
  expect(timings.latencies.map(({ seconds }) => seconds)).toEqual([0.25, 3.5]);
});

it("counts a request XCTest gave up on as lasting until the next one", () => {
  const timings = screenshotLatencies(
    [request("07:07:54.000"), request("07:08:24.000"), reply("07:08:24.200")],
    SINCE,
  );

  expect(timings.latencies.map(({ seconds }) => seconds)).toEqual([30, 0.2]);
});

it("reports slow replies per 1,000 requests and how many were requested just before a minute", () => {
  const latencies = [
    { requested: new Date("2026-10-21T07:00:58.500"), seconds: 7.4 },
    { requested: new Date("2026-10-21T07:01:20.000"), seconds: 2.5 },
    { requested: new Date("2026-10-21T07:01:30.000"), seconds: 0.4 },
    { requested: new Date("2026-10-21T07:01:57.900"), seconds: 1.5 },
  ];

  expect(latencySummary({ requests: 500, replies: 499, latencies })).toEqual([
    "500 screenshot requests, 499 replies, 3 replies over 1 s (6.0 per 1,000), slowest 7.4 s",
    "1 of the slow replies were requested in the last 2 s of a minute, against 0.1 if timing were random",
  ]);
});

it("reads the bytes paged in from vm_stat", () => {
  expect(
    pageIns(
      "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 21657.\nPageins: 878233.\n",
    ),
  ).toBe(878233 * 16384);
});

it("adds up resident memory per program, largest first", () => {
  const ps = [
    "  395056 /Library/Developer/CoreSimulator/Volumes/iOS/RuntimeRoot/System/Library/CoreServices/SpringBoard.app/SpringBoard",
    " 1200000 /opt/java/bin/java",
    "   20000 /usr/bin/git",
    "   30000 /usr/bin/git",
  ].join("\n");

  expect(largestProcesses(ps, 2)).toEqual([
    ["java", 1200000 * 1024],
    ["SpringBoard", 395056 * 1024],
  ]);
  expect(largestProcesses(ps, 3)[2]).toEqual(["git", 50000 * 1024]);
});

it("keeps each program's largest resident memory across samples", () => {
  const peak = peaks(new Map(), [
    ["java", 900],
    ["SpringBoard", 400],
  ]);
  peaks(peak, [
    ["java", 1200],
    ["SpringBoard", 300],
    ["node", 50],
  ]);

  expect([...peak]).toEqual([
    ["java", 1200],
    ["SpringBoard", 400],
    ["node", 50],
  ]);
});

it("samples once Maestro has said nothing for 20 s, and again each further 20 s", () => {
  vi.useFakeTimers();
  let samples = 0;
  const watch = silenceWatch({ onSilent: () => samples++ });
  vi.advanceTimersByTime(19_999);
  watch.heard();
  vi.advanceTimersByTime(19_999);
  expect(samples).toBe(0);
  vi.advanceTimersByTime(1);
  expect(samples).toBe(1);
  vi.advanceTimersByTime(20_000);
  expect(samples).toBe(2);
  watch.stop();
  vi.advanceTimersByTime(60_000);
  expect(samples).toBe(2);
  vi.useRealTimers();
});

afterEach(() => vi.useRealTimers());

it("reports lane health after Maestro exits, from the simulator's stored log rather than a live stream", () => {
  const bin = tempDirectory("cue-lane-health-");
  const calls = path.join(bin, "calls");
  const now = new Date();
  const clock = (offset: number) => {
    const at = new Date(now.getTime() + offset);
    const pad = (value: number, size = 2) => String(value).padStart(size, "0");
    return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
  };
  const log = [
    request(clock(-60_000)),
    request(clock(2_000)),
    reply(clock(2_100)),
    request(clock(3_000)),
    reply(clock(5_000)),
  ]
    .map((entry) => entry.replace("2026-10-21", now.toLocaleDateString("sv")))
    .join("\n");
  writeFileSync(path.join(bin, "log"), `${log}\n`);
  writeFileSync(
    path.join(bin, "xcrun"),
    `#!/bin/sh\necho "xcrun $*" >> "${calls}"\ncat "${path.join(bin, "log")}"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(bin, "vm_stat"),
    `#!/bin/sh\ncount=$(grep -c vm_stat "${calls}" 2>/dev/null)\necho "vm_stat" >> "${calls}"\necho "Mach Virtual Memory Statistics: (page size of 16384 bytes)"\necho "Pageins: $((1000 + count * 64000))."\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(bin, "ps"),
    `#!/bin/sh\necho " 1048576 /opt/java/bin/java"\necho "  204800 /RuntimeRoot/SpringBoard.app/SpringBoard"\n`,
    { mode: 0o755 },
  );
  writeFileSync(path.join(bin, "maestro"), "#!/bin/sh\nsleep 3\n", { mode: 0o755 });
  const debug = path.join(bin, "debug");
  const result = spawnSync(
    process.execPath,
    [
      repositoryPath("scripts/maestro-supervisor.mjs"),
      "test",
      "flow.yaml",
      "--debug-output",
      debug,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}`, DEVICE_ID: "SIM-1" },
    },
  );

  expect(result.status).toBe(0);
  expect(readFileSync(calls, "utf8")).not.toContain("log stream");
  expect(readFileSync(calls, "utf8")).toMatch(
    /^xcrun simctl spawn SIM-1 log show --style compact --last \dm --predicate process == "testmanagerd"/m,
  );
  expect(result.stdout.split("\n").filter((entry) => entry.startsWith("Lane health:"))).toEqual([
    "Lane health: 2 screenshot requests, 2 replies, 1 replies over 1 s (500.0 per 1,000), slowest 2.0 s",
    expect.stringMatching(
      /^Lane health: [01] of the slow replies were requested in the last 2 s of a minute, against 0\.0 if timing were random$/,
    ),
    "Lane health: 1000 MB paged in during the flow",
    "Lane health: largest resident memory, sampled each minute: java 1024 MB, SpringBoard 200 MB",
  ]);
  expect(readFileSync(path.join(debug, "lane-health", "health.txt"), "utf8")).toContain(
    "1000 MB paged in during the flow",
  );
});

it("stops Maestro at once and names SpringBoard when XCTest's screenshot request times out", () => {
  const bin = tempDirectory("cue-supervisor-timeout-");
  writeFileSync(
    path.join(bin, "maestro"),
    `#!/bin/sh
echo '[ WARN] XCTestDriver request failed. Status code: 500, path: isScreenStatic, body: {"code":"internal","errorMessage":"Failed to get screenshot: Timed out while requesting screenshot."}'
exec sleep 30
`,
    { mode: 0o755 },
  );
  const debug = path.join(bin, "debug");
  const result = spawnSync(
    process.execPath,
    [
      repositoryPath("scripts/maestro-supervisor.mjs"),
      "test",
      "flow.yaml",
      "--debug-output",
      debug,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}`, DEVICE_ID: "" },
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    `SpringBoard did not answer testmanagerd's accessibility orientation query within XCTest's 30 s screenshot limit, so no screenshot could be taken. Screenshot timings and SpringBoard spindumps, when the lane records them: ${debug}/lane-health`,
  );
  expect(result.stderr).toContain("path: isScreenStatic");
});

const accessibilityTimeout = (pid: number) => {
  const bin = tempDirectory("cue-supervisor-ax-");
  const calls = path.join(bin, "calls");
  writeFileSync(
    path.join(bin, "maestro"),
    `#!/bin/sh
echo '[ WARN] XCTestDriver request failed. Status code: 500, path: http://127.0.0.1:7001/deviceInfo, body: {"code":"internal","errorMessage":"Failed to get list of active applications: Accessibility error kAXErrorIPCTimeout from AXUIElementCopyMultipleAttributeValues for ${pid}"}'
exec sleep 30
`,
    { mode: 0o755 },
  );
  writeFileSync(path.join(bin, "sudo"), `#!/bin/sh\necho "$*" >> "${calls}"\n`, { mode: 0o755 });
  const debug = path.join(bin, "debug");
  const result = spawnSync(
    process.execPath,
    [
      repositoryPath("scripts/maestro-supervisor.mjs"),
      "test",
      "flow.yaml",
      "--debug-output",
      debug,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}`, DEVICE_ID: "" },
    },
  );
  return { ...result, calls: existsSync(calls) ? readFileSync(calls, "utf8") : "", debug };
};

it("names the process an accessibility IPC timeout was waiting on and spindumps it", () => {
  const result = accessibilityTimeout(process.pid);

  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(
    new RegExp(
      `^The simulator's accessibility IPC to pid ${process.pid} \\(\\S*node\\) timed out in AXUIElementCopyMultipleAttributeValues, so XCTest could not list the running apps\\. Spindumps, when the lane records them: ${result.debug}/lane-health\\n`,
    ),
  );
  expect(result.stderr).not.toContain("XCTest driver died during startup");
  expect(result.calls).toMatch(
    new RegExp(
      `^-n spindump ${process.pid} 3 10 -noBinary -noProcessingWhileSampling -o ${result.debug}/lane-health/spindump-`,
    ),
  );
});

it("says when the process an accessibility IPC timeout waited on has already exited", () => {
  const exited = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
    encoding: "utf8",
  });
  const result = accessibilityTimeout(Number(exited.stdout));

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`to pid ${exited.stdout} (no longer running) timed out`);
  expect(result.calls).toBe("");
});
