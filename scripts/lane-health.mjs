import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { provenCancels } from "./simulator-touch.mjs";

const run = promisify(execFile);
const PREDICATE =
  'process == "testmanagerd" AND (eventMessage BEGINSWITH "Requesting screenshot." OR eventMessage BEGINSWITH "Got system UI orientation")';
const LAUNCHES =
  'eventMessage CONTAINS "com.apple.mobilecal" AND (process == "runningboardd" OR process == "SpringBoard" OR process == "dasd")';
const SLOW_MS = 1_000;
// Twice the most live heap Maestro used in #144's run (235 MB), rounded up.
export const MAESTRO_HEAP_MB = 512;
const HEAP_WARNING = 0.8;
const BEFORE_MINUTE_S = 2;
// The longest a healthy flow stays silent is Maestro's 15 s wait for animations
// to end, so 20 s without output means the simulator is stuck somewhere.
const SILENT_MS = 20_000;

const timestamp = (line) => {
  const [, at] = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)/.exec(line) ?? [];
  return at === undefined ? undefined : new Date(at.replace(" ", "T"));
};

// Every XCTest screenshot starts with testmanagerd asking SpringBoard, over
// accessibility, for the interface orientation; the gap to its reply is how
// long SpringBoard took to answer. A request XCTest gave up on lasts until the
// next one.
export function screenshotLatencies(lines, since) {
  const latencies = [];
  let requests = 0;
  let replies = 0;
  let requested;
  for (const line of lines) {
    const at = timestamp(line);
    if (at === undefined || at < since) continue;
    if (line.includes("Requesting screenshot.")) {
      requests++;
      if (requested !== undefined) latencies.push({ requested, seconds: (at - requested) / 1000 });
      requested = at;
    } else if (line.includes("Got system UI orientation")) {
      replies++;
      if (requested !== undefined) latencies.push({ requested, seconds: (at - requested) / 1000 });
      requested = undefined;
    }
  }
  return { requests, replies, latencies };
}

export function latencySummary({ requests, replies, latencies }) {
  const slow = latencies.filter(({ seconds }) => seconds * 1000 > SLOW_MS);
  const beforeMinute = slow.filter(
    ({ requested }) =>
      requested.getSeconds() + requested.getMilliseconds() / 1000 >= 60 - BEFORE_MINUTE_S,
  );
  const slowest = Math.max(0, ...latencies.map(({ seconds }) => seconds));
  const perThousand = requests === 0 ? 0 : (slow.length * 1000) / requests;
  return [
    `${requests} screenshot requests, ${replies} replies, ${slow.length} replies over ${SLOW_MS / 1000} s (${perThousand.toFixed(1)} per 1,000), slowest ${slowest.toFixed(1)} s`,
    `${beforeMinute.length} of the slow replies were requested in the last ${BEFORE_MINUTE_S} s of a minute, against ${((slow.length * BEFORE_MINUTE_S) / 60).toFixed(1)} if timing were random`,
  ];
}

export const pageIns = (vmStat) => {
  const pageSize = Number(/page size of (\d+) bytes/.exec(vmStat)?.[1] ?? 0);
  return pageSize * Number(/^Pageins:\s+(\d+)\./m.exec(vmStat)?.[1] ?? 0);
};

export function largestProcesses(ps, count) {
  const largest = new Map();
  for (const line of ps.split("\n")) {
    const [, kilobytes, command] = /^\s*(\d+)\s+(.+)$/.exec(line) ?? [];
    if (command === undefined) continue;
    const name = path.basename(command);
    largest.set(name, Math.max(largest.get(name) ?? 0, Number(kilobytes) * 1024));
  }
  return [...largest].sort(([, a], [, b]) => b - a).slice(0, count);
}

// Java's unified GC log prints each collection as "<before>M-><after>M(<committed>M)";
// the heap left after a collection is what the flow actually keeps alive.
export function heapAfterCollections(gcLog) {
  const collections = [...gcLog.matchAll(/(\d+)M->(\d+)M\((\d+)M\)/g)];
  return {
    collections: collections.length,
    live: Math.max(0, ...collections.map(([, , after]) => Number(after))),
    committed: Math.max(0, ...collections.map(([, , , committed]) => Number(committed))),
  };
}

export const heapWarning = ({ live }) =>
  live > MAESTRO_HEAP_MB * HEAP_WARNING
    ? `Maestro's live heap reached ${live} MB, over ${HEAP_WARNING * 100}% of its ${MAESTRO_HEAP_MB} MB cap`
    : undefined;

export const launchLines = (log) =>
  log.split("\n").filter((line) => /launch/i.test(line) && line.includes("com.apple.mobilecal"));

export const peaks = (current, sample) => {
  for (const [name, bytes] of sample) current.set(name, Math.max(current.get(name) ?? 0, bytes));
  return current;
};

export const megabytes = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

export function silenceWatch({ silentMs = SILENT_MS, onSilent }) {
  let timer;
  const heard = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      onSilent();
      heard();
    }, silentMs);
  };
  heard();
  return { heard, stop: () => clearTimeout(timer) };
}

export const recorder = (directory) => {
  mkdirSync(directory, { recursive: true });
  return (line) =>
    appendFileSync(path.join(directory, "health.txt"), `${new Date().toISOString()} ${line}\n`);
};

export function spindump({ directory, pid, label, options = [], record, done = () => {} }) {
  const file = `spindump-${new Date().toISOString().replaceAll(":", "-")}.txt`;
  record(`sampling ${label} ${pid} into ${file}`);
  execFile(
    "sudo",
    [
      "-n",
      "spindump",
      pid,
      "3",
      "10",
      ...options,
      "-noBinary",
      "-noProcessingWhileSampling",
      "-o",
      path.join(directory, file),
    ],
    (failure) => {
      if (failure) record(`spindump failed: ${failure.message.trim()}`);
      done();
    },
  );
}

const springBoardPid = (ps) => /^\s*(\d+)\s+\S*\/SpringBoard\.app\/SpringBoard$/m.exec(ps)?.[1];

// Reads the lane's health without a live log stream, which would make every
// simulator process reflect each log call to it while the flow runs.
export function laneHealth({ device, directory }) {
  const record = recorder(directory);
  const gcLog = path.join(directory, "maestro-gc.log");
  const since = new Date();
  const started = run("vm_stat").then(({ stdout }) => pageIns(stdout));
  const peak = new Map();
  const census = async () =>
    peaks(peak, largestProcesses((await run("ps", ["-axo", "rss=,comm="])).stdout, Infinity));
  const minutely = setInterval(census, 60_000);
  let sampling = false;
  const silence = silenceWatch({
    onSilent: async () => {
      if (sampling) return;
      sampling = true;
      const pid = springBoardPid((await run("ps", ["-axo", "pid=,comm="])).stdout);
      if (pid === undefined) {
        record("could not find SpringBoard to sample");
        sampling = false;
        return;
      }
      spindump({ directory, pid, label: "SpringBoard", record, done: () => (sampling = false) });
    },
  });
  const stop = async () => {
    silence.stop();
    clearInterval(minutely);
    const minutes = Math.ceil((Date.now() - since) / 60_000) + 1;
    const show = (predicate) =>
      run(
        "xcrun",
        [
          "simctl",
          "spawn",
          device,
          "log",
          "show",
          "--style",
          "compact",
          "--last",
          `${minutes}m`,
          "--predicate",
          predicate,
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      );
    const [log, launches, vmStat] = await Promise.all([
      show(PREDICATE),
      show(LAUNCHES),
      run("vm_stat"),
      census(),
    ]);
    const heap = heapAfterCollections(existsSync(gcLog) ? readFileSync(gcLog, "utf8") : "");
    const calendar = launchLines(launches.stdout);
    for (const line of calendar.slice(0, 5)) record(`MobileCal launch: ${line}`);
    const warning = heapWarning(heap);
    const cancels = provenCancels();
    for (const cancel of cancels) record(`proven simulator touch cancel: ${cancel}`);
    const lines = [
      ...latencySummary(screenshotLatencies(log.stdout.split("\n"), since)),
      `${megabytes(pageIns(vmStat.stdout) - (await started))} paged in during the flow`,
      `Maestro's Java heap after ${heap.collections} collections: at most ${heap.live} MB live of ${heap.committed} MB committed`,
      `${calendar.length} log lines about launching MobileCal`,
      `largest single process per program, sampled each minute: ${[...peak]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([name, bytes]) => `${name} ${megabytes(bytes)}`)
        .join(", ")}`,
      `${cancels.length} taps the simulator proved it dropped, each tapped again`,
    ];
    for (const line of lines) record(line);
    if (warning !== undefined) record(`warning: ${warning}`);
    const notice =
      cancels.length === 0
        ? undefined
        : `The simulator dropped ${cancels.length === 1 ? "a tap" : `${cancels.length} taps`} and the flow tapped again; see Lane health`;
    return { lines, warning, notice };
  };
  return {
    heard: silence.heard,
    stop,
    javaOptions: `-Xmx${MAESTRO_HEAP_MB}m -Xlog:gc:file=${gcLog}`,
  };
}
