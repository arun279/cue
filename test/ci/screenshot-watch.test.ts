import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { screenshotReplies, watchScreenshots } from "../../scripts/screenshot-watch.mjs";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const REQUEST =
  "2026-10-21 01:19:59.285 Df testmanagerd[11417:3a1] [com.apple.dt.xctest:Default] Requesting screenshot.";
const REPLY =
  "2026-10-21 01:19:59.300 Df testmanagerd[11417:3a1] [com.apple.dt.xctest:Default] Got system UI orientation ({pid=4849}) 1";

const replies = () => {
  const events = { samples: 0, records: [] as string[] };
  const watch = screenshotReplies({
    sample: () => events.samples++,
    record: (line: string) => events.records.push(line),
  });
  return { ...watch, events };
};

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(() => vi.useRealTimers());

it("leaves a reply within a second alone", () => {
  const { handle, stop, events } = replies();
  handle(REPLY);
  handle(REQUEST);
  vi.advanceTimersByTime(999);
  handle(REPLY);
  vi.advanceTimersByTime(60_000);
  stop();

  expect(events).toEqual({ samples: 0, records: ["1 screenshot requests, 2 replies"] });
});

it("samples SpringBoard once a reply is a second late and records how late it came", () => {
  const { handle, events } = replies();
  handle(REPLY);
  handle(REQUEST);
  vi.advanceTimersByTime(999);
  expect(events.samples).toBe(0);
  vi.advanceTimersByTime(1);
  expect(events.samples).toBe(1);
  vi.advanceTimersByTime(2_400);
  handle(REPLY);
  vi.advanceTimersByTime(60_000);

  expect(events).toEqual({ samples: 1, records: ["replied after 3.4 s"] });
});

it("does not sample before the stream has shown that it carries replies", () => {
  const { handle, stop, events } = replies();
  handle(REQUEST);
  vi.advanceTimersByTime(60_000);
  stop();

  expect(events).toEqual({ samples: 0, records: ["1 screenshot requests, 0 replies"] });
});

it("times each request from its own start", () => {
  const { handle, events } = replies();
  handle(REPLY);
  handle(REQUEST);
  vi.advanceTimersByTime(800);
  handle(REQUEST);
  vi.advanceTimersByTime(800);
  handle(REPLY);

  expect(events).toEqual({ samples: 0, records: [] });
});

const simulator = (launchctl: string) => {
  vi.useRealTimers();
  const bin = tempDirectory("cue-screenshot-watch-bin-");
  const calls = path.join(bin, "calls");
  writeFileSync(
    path.join(bin, "xcrun"),
    `#!/bin/sh
case "$*" in
  *"log stream"*) printf '%s\\n%s\\n' '${REPLY}' '${REQUEST}'; exec sleep 5 ;;
  *"launchctl list"*) printf '%s\\n' "${launchctl}" ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(path.join(bin, "sudo"), `#!/bin/sh\necho "$*" >> "${calls}"\n`, { mode: 0o755 });
  vi.stubEnv("PATH", `${bin}:${process.env["PATH"]}`);
  const directory = tempDirectory("cue-screenshot-watch-");
  const stop = watchScreenshots({ device: "SIM", directory, slowMs: 0 });
  return { calls, directory, stop };
};

afterEach(() => vi.unstubAllEnvs());

it("spindumps the simulator's SpringBoard into the debug output", async () => {
  const { calls, directory, stop } = simulator(
    "PID\tStatus\tLabel\n4849\t0\tcom.apple.SpringBoard\n4870\t0\tcom.apple.backboardd\n11417\t0\tcom.apple.testmanagerd",
  );
  await vi.waitFor(() => expect(existsSync(calls)).toBe(true), { timeout: 4_000 });
  stop();

  const [call] = readFileSync(calls, "utf8").trim().split("\n");
  expect(call).toMatch(
    new RegExp(
      `^-n spindump 4849 3 10 -onlyTarget -proc 11417 -noBinary -noProcessingWhileSampling -o ${directory}/spindump-[\\dT.Z-]+\\.txt$`,
    ),
  );
  expect(readFileSync(path.join(directory, "replies.txt"), "utf8")).toContain(
    "sampling SpringBoard 4849 into spindump-",
  );
});

it("says so when SpringBoard is not running", async () => {
  const { calls, directory, stop } = simulator("PID\tStatus\tLabel\n4870\t0\tcom.apple.backboardd");
  const replies = path.join(directory, "replies.txt");
  await vi.waitFor(() => expect(existsSync(replies)).toBe(true), { timeout: 4_000 });
  stop();

  expect(readFileSync(replies, "utf8")).toContain("could not find SpringBoard to sample");
  expect(existsSync(calls)).toBe(false);
});

it("is started by the Maestro supervisor for the lane's simulator and stopped with Maestro", () => {
  const bin = tempDirectory("cue-supervisor-watch-");
  const calls = path.join(bin, "calls");
  writeFileSync(
    path.join(bin, "xcrun"),
    `#!/bin/sh\necho "xcrun $*" >> "${calls}"\nexec sleep 30\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(bin, "maestro"),
    `#!/bin/sh\nwhile ! grep -q "log stream" "${calls}" 2>/dev/null; do sleep 0.05; done\n`,
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
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}`, DEVICE_ID: "SIM-1" },
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(readFileSync(calls, "utf8")).toMatch(
    /^xcrun simctl spawn SIM-1 log stream --style compact --predicate process == "testmanagerd"/,
  );
  expect(existsSync(path.join(debug, "springboard"))).toBe(true);
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
    `SpringBoard did not answer testmanagerd's accessibility orientation query within XCTest's 30 s screenshot limit, so no screenshot could be taken. Late replies and SpringBoard spindumps, when the lane records them: ${debug}/springboard`,
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
      `^The simulator's accessibility IPC to pid ${process.pid} \\(\\S*node\\) timed out in AXUIElementCopyMultipleAttributeValues, so XCTest could not list the running apps\\. Spindumps, when the lane records them: ${result.debug}/springboard\\n`,
    ),
  );
  expect(result.stderr).not.toContain("XCTest driver died during startup");
  expect(result.calls).toMatch(
    new RegExp(
      `^-n spindump ${process.pid} 3 10 -noBinary -noProcessingWhileSampling -o ${result.debug}/springboard/spindump-`,
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
