import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createMockTrakt } from "../../scripts/mock-trakt/server.mjs";
import { provenSimulatorCancel } from "../../scripts/simulator-touch.mjs";
import { fakeBin } from "../support/fake-bin";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const fixture = (name: string) =>
  readFileSync(repositoryPath(`test/ci/fixtures/simulator-touch/${name}`), "utf8");
const DROPPED = fixture("dropped-tap.txt");
const NORMAL = fixture("normal-tap.txt");
// Run 39667013137, native-e2e-ios-light (detail): the press trace of the lost tap.
const CANCELLED =
  "shown; press in +73535 ms native +0 ms; touch start +73539 ms native +0 ms; touch cancel +73601 ms native +233 ms; press out +73679 ms native +233 ms";
const line = (pattern: RegExp) => DROPPED.split("\n").find((entry) => pattern.test(entry)) ?? "";

const bin = fakeBin({ xcrun: '#!/bin/sh\necho "$*" >> "$CALLS"\ncat "$TOUCH_LOG"\n' });

afterEach(() => vi.unstubAllEnvs());

it("proves a dropped tap from the app's cancel and backboardd's dropped touch", () => {
  expect(provenSimulatorCancel(CANCELLED, DROPPED)).toEqual({
    proven: true,
    reason: expect.stringContaining("backboardd"),
  });
  expect(provenSimulatorCancel(CANCELLED, line(/unknown senderID/)).proven).toBe(true);
  expect(provenSimulatorCancel(CANCELLED, line(/canceling paths/)).proven).toBe(true);
});

it.each([
  ["a normal tap's log, whose touchscreen also disappears", CANCELLED, NORMAL],
  ["no simulator log", CANCELLED, ""],
  ["a press that arrived after the cancel", `${CANCELLED}; press +73690 ms`, DROPPED],
  ["a touch the app never saw", "shown", DROPPED],
  ["a touch that also ended in the app", `${CANCELLED}; touch end +73700 ms`, DROPPED],
  ["a cancel after the app saw a drag", `${CANCELLED}; drag +73700 ms`, DROPPED],
])("does not prove a dropped tap from %s", (_, trace, log) => {
  expect(provenSimulatorCancel(trace, log).proven).toBe(false);
});

it("answers the flow through the harness server and records each proven cancel", async () => {
  const temp = tempDirectory("cue-touch-proof-");
  vi.stubEnv("PATH", `${bin}:${process.env["PATH"]}`);
  vi.stubEnv("RUNNER_TEMP", temp);
  vi.stubEnv("CALLS", path.join(temp, "calls"));
  vi.stubEnv("TOUCH_LOG", path.join(temp, "touch.log"));
  vi.stubEnv("DEVICE_ID", "SIM-1");
  const server = createMockTrakt({ port: 0, log: false });
  const origin = await server.listen();
  const proof = async (log: string, trace: string) => {
    writeFileSync(path.join(temp, "touch.log"), log);
    return (
      await fetch(`${origin}/__touch-proof`, { method: "POST", body: JSON.stringify({ trace }) })
    ).json();
  };
  try {
    expect(await proof(DROPPED, CANCELLED)).toMatchObject({ tapAgain: false });
    await fetch(`${origin}/__touch-window`, { method: "POST" });

    expect(await proof(NORMAL, CANCELLED)).toMatchObject({ tapAgain: false });
    expect(await proof(DROPPED, CANCELLED)).toMatchObject({ tapAgain: true });
    expect(readFileSync(path.join(temp, "calls"), "utf8")).toMatch(
      /^simctl spawn SIM-1 log show --style compact --start \d{4}-\d\d-\d\d \d\d:\d\d:\d\d --predicate process == "backboardd"/m,
    );
    expect(
      readFileSync(path.join(temp, "simulator-touch-cancels.log"), "utf8").trim().split("\n"),
    ).toEqual([expect.stringContaining(CANCELLED)]);
  } finally {
    await server.close();
  }
});
