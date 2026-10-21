import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const PREDICATE =
  'process == "testmanagerd" AND (eventMessage BEGINSWITH "Requesting screenshot." OR eventMessage BEGINSWITH "Got system UI orientation")';

// Every XCTest screenshot starts with testmanagerd asking SpringBoard, over
// accessibility, for the interface orientation. Healthy lanes get the answer
// within half a second. A late reply is only sampled once the stream has shown
// a reply, so a stream that misses replies cannot pass for a stalled SpringBoard.
export function screenshotReplies({ slowMs = 1_000, sample, record }) {
  let requested;
  let timer;
  const counts = { requests: 0, replies: 0 };
  const handle = (line) => {
    if (line.includes("Requesting screenshot.")) {
      clearTimeout(timer);
      counts.requests++;
      requested = performance.now();
      if (counts.replies > 0) timer = setTimeout(sample, slowMs);
    } else if (line.includes("Got system UI orientation")) {
      clearTimeout(timer);
      counts.replies++;
      if (requested === undefined) return;
      const waited = performance.now() - requested;
      requested = undefined;
      if (waited > slowMs) record(`replied after ${(waited / 1000).toFixed(1)} s`);
    }
  };
  const stop = () => {
    clearTimeout(timer);
    record(`${counts.requests} screenshot requests, ${counts.replies} replies`);
  };
  return { handle, stop };
}

export function watchScreenshots({ device, directory, slowMs }) {
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
  const replies = screenshotReplies({ slowMs, sample, record });
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
