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
  const events = { samples: 0, records: [] as string[], stalls: [] as string[] };
  const watch = screenshotReplies({
    sample: () => events.samples++,
    record: (line: string) => events.records.push(line),
    onStalled: (diagnosis: string) => events.stalls.push(diagnosis),
  });
  return { ...watch, events };
};

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(() => vi.useRealTimers());

it("leaves a reply within a second alone", () => {
  const { handle, events } = replies();
  handle(REQUEST);
  vi.advanceTimersByTime(999);
  handle(REPLY);
  vi.advanceTimersByTime(60_000);

  expect(events).toEqual({ samples: 0, records: [], stalls: [] });
});

it("samples SpringBoard once a reply is a second late and records how late it came", () => {
  const { handle, events } = replies();
  handle(REQUEST);
  vi.advanceTimersByTime(1_000);
  expect(events.samples).toBe(1);
  vi.advanceTimersByTime(2_400);
  handle(REPLY);
  vi.advanceTimersByTime(60_000);

  expect(events).toEqual({ samples: 1, records: ["replied after 3.4 s"], stalls: [] });
});

it("stops the flow when SpringBoard has not answered within XCTest's 30 s", () => {
  const { handle, events } = replies();
  handle(REQUEST);
  vi.advanceTimersByTime(29_999);
  expect(events.stalls).toEqual([]);
  vi.advanceTimersByTime(1);

  expect(events.records).toEqual(["no reply after 30 s"]);
  expect(events.stalls).toEqual([
    "SpringBoard has not answered testmanagerd's accessibility orientation query for 30 s, so XCTest cannot take a screenshot.",
  ]);
});

it("times each request from its own start", () => {
  const { handle, events } = replies();
  handle(REQUEST);
  vi.advanceTimersByTime(20_000);
  handle(REQUEST);
  vi.advanceTimersByTime(20_000);

  expect(events.stalls).toEqual([]);
  expect(events.samples).toBe(2);
});

it("ignores a reply nobody is waiting for", () => {
  const { handle, events } = replies();
  vi.advanceTimersByTime(5_000);
  handle(REPLY);

  expect(events).toEqual({ samples: 0, records: [], stalls: [] });
});

const simulator = (launchctl: string) => {
  vi.useRealTimers();
  const bin = tempDirectory("cue-screenshot-watch-bin-");
  const calls = path.join(bin, "calls");
  writeFileSync(
    path.join(bin, "xcrun"),
    `#!/bin/sh
case "$*" in
  *"log stream"*) echo '${REQUEST}'; exec sleep 5 ;;
  *"launchctl list"*) printf '%s\\n' "${launchctl}" ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(path.join(bin, "sudo"), `#!/bin/sh\necho "$*" >> "${calls}"\n`, { mode: 0o755 });
  vi.stubEnv("PATH", `${bin}:${process.env["PATH"]}`);
  const directory = tempDirectory("cue-screenshot-watch-");
  const stop = watchScreenshots({ device: "SIM", directory, slowMs: 0, onStalled: () => {} });
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
