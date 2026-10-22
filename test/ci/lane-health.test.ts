import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  galleryRefreshes,
  heapAfterCollections,
  largestProcesses,
  latencySummary,
  launchLines,
  pageIns,
  peaks,
  screenshotLatencies,
  silenceWatch,
  springBoardPid,
  swapInUse,
} from "../../scripts/lane-health.mjs";
import { fakeBin } from "../support/fake-bin";
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

it("reads the swap in use from sysctl", () => {
  expect(
    swapInUse("vm.swapusage: total = 1024.00M  used = 535.81M  free = 488.19M  (encrypted)"),
  ).toBe(535.81 * 1024 * 1024);
  expect(swapInUse("vm.swapusage: total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)")).toBe(0);
});

// Run 39862150429, native-e2e-ios-light (discovery): PosterBoard's gallery refresh, as
// `log show --style compact` prints it, beside a line of the same refresh that is not its start.
const refresh =
  "2026-10-22 22:12:01.097 Df PosterBoard[3471:1c3f] (PosterBoard) [com.apple.PosterBoard:Gallery] [A9F1A6BC-8515-4AED-A8C9-164CE6C97B46] pushUpdatedPosterDescriptors begin";

it("keeps one line per wallpaper gallery refresh", () => {
  const log = `${refresh}\n${refresh.replace("begin", "; enqueuing")}\n`;
  expect(galleryRefreshes(log)).toEqual([refresh]);
});

it("finds SpringBoard under a simulator runtime whose path has a space in it", () => {
  // `ps -axo pid=,comm=` in the same run, where the lookup used to come back empty.
  const ps = [
    " 3347 /sbin/launchd_sim",
    " 3359 /Library/Developer/CoreSimulator/Volumes/iOS_23E254a/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 26.4.simruntime/Contents/Resources/RuntimeRoot/System/Library/CoreServices/SpringBoard.app/SpringBoard",
  ].join("\n");
  expect(springBoardPid(ps)).toBe("3359");
});

it("reads the most heap Java kept alive after a collection from its GC log", () => {
  const log = [
    "[0.512s][info][gc] Using G1",
    "[2.101s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 24M->9M(64M) 3.120ms",
    "[9.870s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 61M->38M(128M) 5.004ms",
    "[30.44s][info][gc] GC(2) Pause Young (Normal) (G1 Evacuation Pause) 102M->31M(128M) 4.871ms",
  ].join("\n");

  expect(heapAfterCollections(log)).toEqual({ collections: 3, live: 38, committed: 128 });
  expect(heapAfterCollections("")).toEqual({ collections: 0, live: 0, committed: 0 });
});

it("keeps only the log lines about launching MobileCal", () => {
  const log = [
    "2026-10-21 09:58:01.120 Df runningboardd[1408:5a] [com.apple.runningboard:job] Launch request for app<com.apple.mobilecal> from <dasd> with reason: Background Fetch",
    "2026-10-21 09:58:01.300 Df runningboardd[1408:5a] [com.apple.runningboard:process] app<com.apple.mobilecal(501)> suspended",
    "2026-10-21 09:58:02.010 Df SpringBoard[1376:2b] Launching app<app.cuetracker> for background refresh",
  ].join("\n");

  expect(launchLines(log)).toEqual([log.split("\n")[0]]);
});

it("keeps each program's largest single process, largest first", () => {
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
  expect(largestProcesses(ps, 3)[2]).toEqual(["git", 30000 * 1024]);
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

const laneBin = fakeBin({
  xcrun:
    '#!/bin/sh\necho "xcrun $*" >> "$CALLS"\ncase "$*" in *mobilecal*) echo "launch request for app<com.apple.mobilecal> from <dasd>" ;; *Tapping*) cat "$TAP_LOG" 2>/dev/null ;; *pushUpdatedPosterDescriptors*) echo "PosterBoard pushUpdatedPosterDescriptors begin" ;; *) cat "$SIM_LOG" ;; esac\n',
  vm_stat:
    '#!/bin/sh\ncount=$(grep -c vm_stat "$CALLS" 2>/dev/null)\necho "vm_stat" >> "$CALLS"\necho "Mach Virtual Memory Statistics: (page size of 16384 bytes)"\necho "Pageins: $((1000 + count * 64000))."\n',
  ps: '#!/bin/sh\necho " 1048576 /opt/java/bin/java"\necho "  204800 /RuntimeRoot/SpringBoard.app/SpringBoard"\n',
  sysctl:
    '#!/bin/sh\ncount=$(grep -c sysctl "$CALLS" 2>/dev/null)\necho "sysctl" >> "$CALLS"\necho "vm.swapusage: total = 1024.00M  used = $((count * 512)).00M  free = 512.00M  (encrypted)"\n',
  maestro: `#!/bin/sh\necho "$MAESTRO_OPTS" > "$OPTIONS"\necho "[1.0s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 500M->\${LIVE}M(640M) 2.0ms" > "\${MAESTRO_OPTS#*file=}"\n`,
});

const hungMaestro = '#!/bin/sh\nprintf \'%s\\n\' "$MAESTRO_LINE"\nexec sleep "$HOLD"\n';
const screenshotBin = fakeBin({ maestro: hungMaestro });
const accessibilityBin = fakeBin({
  maestro: hungMaestro,
  sudo: '#!/bin/sh\necho "$*" >> "$CALLS"\n',
});

const laneRun = (
  live: number,
  proxiedTaps: readonly object[] = [],
  runnerTaps: readonly string[] = [],
) => {
  const bin = tempDirectory("cue-lane-health-");
  if (proxiedTaps.length > 0) {
    writeFileSync(
      path.join(bin, "tap-proxy.ndjson"),
      proxiedTaps.map((tap) => `${JSON.stringify(tap)}\n`).join(""),
    );
  }
  writeFileSync(path.join(bin, "taps"), runnerTaps.map((tap) => `${tap}\n`).join(""));
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
      timeout: 60_000,
      env: {
        ...process.env,
        PATH: `${laneBin}:${process.env["PATH"]}`,
        DEVICE_ID: "SIM-1",
        CALLS: calls,
        SIM_LOG: path.join(bin, "log"),
        TAP_LOG: path.join(bin, "taps"),
        OPTIONS: path.join(bin, "options"),
        LIVE: String(live),
        RUNNER_TEMP: bin,
      },
    },
  );
  return { result, calls, debug, options: readFileSync(path.join(bin, "options"), "utf8").trim() };
};

it("reports lane health after Maestro exits, from the simulator's stored log rather than a live stream", () => {
  const { result, calls, debug, options } = laneRun(12);

  expect(options).toMatch(/^-Xmx512m -Xlog:gc:file=\S+\/lane-health\/maestro-gc\.log$/);
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
    "Lane health: swap in use went from 0 MB to 512 MB during the flow",
    "Lane health: 1 wallpaper gallery refreshes by PosterBoard during the flow",
    "Lane health: Maestro's Java heap after 1 collections: at most 12 MB live of 640 MB committed",
    "Lane health: 1 log lines about launching MobileCal",
    "Lane health: largest single process per program, sampled each minute: java 1024 MB, SpringBoard 200 MB",
    "Lane health: tap proxy checked 0 taps, matched playback for 0, saw 0 cancels, tapped again 0, p95 log wait 0 ms",
  ]);
  expect(result.stdout).not.toContain("::notice");
  expect(readFileSync(path.join(debug, "lane-health", "health.txt"), "utf8")).toContain(
    "1000 MB paged in during the flow",
  );
});

// Run 39728254091, ui-screenshots-ios-dark: the runner's own line for each synthesized tap.
const runnerTap =
  "2026-10-22 05:39:23.271 Df maestro-driver-iosUITests-Runner[7613:2c0d] (Foundation) Tapping 349.0, 84.0";
const delivered = { x: 349, y: 84, status: 200, waitMs: 40 };

it("counts the taps the proxy checked and played again, and raises a job notice for them", () => {
  const again = {
    ...delivered,
    cancel: true,
    again: true,
    reason: "canceling paths contacts: [touching] under Done",
  };
  const { result, debug } = laneRun(
    12,
    [delivered, again, again],
    [runnerTap, runnerTap, runnerTap],
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    "Lane health: tap proxy checked 3 taps, matched playback for 3, saw 2 cancels, tapped again 2, p95 log wait 40 ms\n",
  );
  expect(result.stdout).toContain(
    "::notice title=Simulator touch cancel::The simulator dropped 2 taps and the tap proxy tapped again; see Lane health\n",
  );
  expect(readFileSync(path.join(debug, "lane-health", "health.txt"), "utf8")).toContain(
    `proven simulator touch cancel, tapped again: ${again.reason}`,
  );
});

it.each([
  [
    "the CLI bypassed the proxy",
    [],
    "the tap proxy checked none, so it was not in the request path",
  ],
  [
    "the simulator log stream showed nothing",
    [{ x: 349, y: 84, status: 200, reason: "no playback in the simulator log" }],
    "no playback for 1 of the 1 taps the runner answered",
  ],
])("fails the lane when %s", (_, proxied, failure) => {
  const { result } = laneRun(12, proxied, [runnerTap]);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain("::error title=Tap proxy::");
  expect(result.stdout).toContain(failure);
});

it("warns in the job log when Maestro's live heap passes 80% of its cap", () => {
  const { result } = laneRun(450);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    "::warning title=Lane health::Maestro's live heap reached 450 MB, over 80% of its 512 MB cap\n",
  );
});

it("does not warn while Maestro's live heap stays within 80% of its cap", () => {
  expect(laneRun(409).result.stdout).not.toContain("::warning");
});

it("stops Maestro at once and names SpringBoard when XCTest's screenshot request times out", () => {
  const bin = tempDirectory("cue-supervisor-timeout-");
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
      env: {
        ...process.env,
        PATH: `${screenshotBin}:${process.env["PATH"]}`,
        DEVICE_ID: "",
        MAESTRO_LINE:
          '[ WARN] XCTestDriver request failed. Status code: 500, path: isScreenStatic, body: {"code":"internal","errorMessage":"Failed to get screenshot: Timed out while requesting screenshot."}',
        HOLD: "30",
      },
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
      env: {
        ...process.env,
        PATH: `${accessibilityBin}:${process.env["PATH"]}`,
        DEVICE_ID: "",
        CALLS: calls,
        MAESTRO_LINE: `[ WARN] XCTestDriver request failed. Status code: 500, path: http://127.0.0.1:7001/deviceInfo, body: {"code":"internal","errorMessage":"Failed to get list of active applications: Accessibility error kAXErrorIPCTimeout from AXUIElementCopyMultipleAttributeValues for ${pid}"}`,
        HOLD: "30",
      },
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
