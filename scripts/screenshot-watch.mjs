import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const PREDICATE =
  'process == "testmanagerd" AND (eventMessage BEGINSWITH "Requesting screenshot." OR eventMessage BEGINSWITH "Got system UI orientation")';

// Every XCTest screenshot starts with testmanagerd asking SpringBoard, over
// accessibility, for the interface orientation. Healthy lanes get the answer
// within half a second; XCTest gives up on the screenshot after 30 s.
export function screenshotReplies({
  slowMs = 1_000,
  stalledMs = 30_000,
  sample,
  record,
  onStalled,
}) {
  let requested;
  let timers = [];
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };
  const handle = (line) => {
    if (line.includes("Requesting screenshot.")) {
      clear();
      requested = performance.now();
      timers = [
        setTimeout(sample, slowMs),
        setTimeout(() => {
          record(`no reply after ${stalledMs / 1000} s`);
          onStalled(
            `SpringBoard has not answered testmanagerd's accessibility orientation query for ${stalledMs / 1000} s, so XCTest cannot take a screenshot.`,
          );
        }, stalledMs),
      ];
    } else if (line.includes("Got system UI orientation") && requested !== undefined) {
      const waited = performance.now() - requested;
      clear();
      requested = undefined;
      if (waited > slowMs) record(`replied after ${(waited / 1000).toFixed(1)} s`);
    }
  };
  return { handle, stop: clear };
}

export function watchScreenshots({ device, directory, onStalled, ...thresholds }) {
  mkdirSync(directory, { recursive: true });
  const record = (line) =>
    appendFileSync(path.join(directory, "replies.txt"), `${new Date().toISOString()} ${line}\n`);
  let sampling = false;
  const sample = () => {
    if (sampling) return;
    sampling = true;
    execFile("xcrun", ["simctl", "spawn", device, "launchctl", "list"], (error, list) => {
      const pid = (label) =>
        error ? undefined : new RegExp(`^(\\d+)\\s+\\S+\\s+${label}$`, "m").exec(list)?.[1];
      const springBoard = pid("com\\.apple\\.SpringBoard");
      const testManager = pid("com\\.apple\\.testmanagerd");
      if (springBoard === undefined) {
        record("could not find SpringBoard to sample");
        sampling = false;
        return;
      }
      const file = `spindump-${new Date().toISOString().replaceAll(":", "-")}.txt`;
      record(`sampling SpringBoard ${springBoard} into ${file}`);
      execFile(
        "sudo",
        [
          "-n",
          "spindump",
          springBoard,
          "3",
          "10",
          "-onlyTarget",
          ...(testManager === undefined ? [] : ["-proc", testManager]),
          "-noBinary",
          "-noProcessingWhileSampling",
          "-o",
          path.join(directory, file),
        ],
        (failure) => {
          if (failure) record(`spindump failed: ${failure.message.trim()}`);
          sampling = false;
        },
      );
    });
  };
  const replies = screenshotReplies({
    ...thresholds,
    sample,
    record,
    onStalled: (diagnosis) =>
      onStalled(`${diagnosis} Replies and SpringBoard spindumps: ${directory}`),
  });
  const stream = spawn(
    "xcrun",
    ["simctl", "spawn", device, "log", "stream", "--style", "compact", "--predicate", PREDICATE],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  let tail = "";
  stream.stdout.setEncoding("utf8");
  stream.stdout.on("data", (text) => {
    const lines = `${tail}${text}`.split("\n");
    tail = lines.pop();
    lines.forEach(replies.handle);
  });
  return () => {
    replies.stop();
    stream.kill();
  };
}
