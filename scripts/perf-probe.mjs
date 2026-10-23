// Measures the harness app on one platform over several passes and reports what each
// interaction cost. The app performs every interaction itself, on a command this process sends
// over a long-poll channel (src/ui/perf-channel.ts), because a test driver reading the view
// hierarchy blocks the app's main thread: XCTest's accessibility snapshots on iOS, and
// UiAutomator's node queries on Android, which run on the app's UI thread. Maestro only signs
// in, before this starts, and must not be running.
// Both platforms record every interaction's screen and time it the same way: from the command
// to the content region's first change and to its last, and a scroll by the gaps between the
// frames the recorder captured. A change that has not reached the content by the end of the
// window is recorded as censored (">2500"), which ranks above every measured value, once a
// screenshot shows the content changed after all; the probe waits for that before the next
// interaction, so the late change cannot land in its window. Content that never changes fails
// the run, naming the platform, pass and segment, because the probe saw nothing happen. Android
// adds what the platform keeps: frame statistics per segment (dumpsys gfxinfo), the views and
// Compose hosts on screen after a tab switch (dumpsys activity top), memory (dumpsys meminfo),
// overdraw, and cold start (am start -W) as adb installed the app, verified the way a Play
// install without a profile is, and compiled from the profile the passes collected. iOS adds
// the app's resident memory. No number gates anything.
// With two apps, the base and a change, it measures them in alternate passes on the same device
// and adds a line per quantity comparing their medians, so the runner's speed cancels out.
// Usage: DEVICE_ID=<simulator> perf-probe.mjs <ios|android> <output directory> <runs> [base app] [changed app]
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const PACKAGE = "app.cuetracker";
const PORT = 8790;
const MOCK = "http://127.0.0.1:8787";
const FRAME_MS = 1000 / 60;
const PAUSE_MS = 250;
const BUFFER = { maxBuffer: 64 * 1024 * 1024 };
const CONTENT = "iw:ih*0.72:0:ih*0.1";
const CHANGE_THRESHOLD = 0.005;

const number = (pattern, text) => {
  const match = pattern.exec(text);
  return match === null ? null : Number(match[1]);
};

// FrameInfoFlags::SkippedFrame in hwui's FrameInfo.h.
const SKIPPED_FRAME = 1 << 3;
const nsToMs = (ns) => Math.round(ns / 100_000) / 10;

/** Per-frame rows of `dumpsys gfxinfo <package> framestats`, keyed by column name. */
function frameRows(text) {
  const [header = "", ...rows] = (text.split("---PROFILEDATA---")[1] ?? "").trim().split("\n");
  const columns = header.split(",");
  return rows.map((row) =>
    Object.fromEntries(row.split(",").map((value, index) => [columns[index], Number(value)])),
  );
}

/**
 * The slowest of the first three frames since the reset.
 * Unknown when the platform has already dropped them from its 120-frame window. Only frames
 * hwui marks as skipped, whose timestamps are garbage, are left out; a frame that follows a
 * window change is slow by nature, and it is the frame a user waits on.
 */
function firstFrames(rows, rendered, histogram) {
  const first = rows
    .filter((frame) => (frame.Flags & SKIPPED_FRAME) === 0)
    .sort((a, b) => a.IntendedVsync - b.IntendedVsync)
    .slice(0, 3);
  if (first.length > 0 && rendered <= rows.length)
    return nsToMs(Math.max(...first.map((frame) => frame.FrameCompleted - frame.IntendedVsync)));
  return rendered > 0 && rendered <= 3 ? slowestBucket(histogram) : null;
}

/**
 * The slowest bucket the summary's histogram counted a frame in. hwui reuses a skipped
 * frame's slot for the next frame, so after a reset that next frame is counted in the summary
 * but missing from the frame list; with three frames or fewer, every frame is a first frame.
 */
function slowestBucket(histogram) {
  const counted = [...histogram.matchAll(/(\d+)ms=(\d+)/g)]
    .filter(([, , count]) => Number(count) > 0)
    .map(([, bucket]) => Number(bucket));
  return counted.length === 0 ? null : Math.max(...counted);
}

/** The summary and the first frames from `dumpsys gfxinfo <package> framestats`. */
export function frameStats(text) {
  const frames = number(/Total frames rendered: (\d+)/, text);
  return {
    frames,
    jankyPercent: number(/Janky frames: \d+ \(([\d.]+)%\)/, text),
    p50Ms: number(/50th percentile: (\d+)ms/, text),
    p90Ms: number(/90th percentile: (\d+)ms/, text),
    p99Ms: number(/99th percentile: (\d+)ms/, text),
    slowUiThread: number(/Number Slow UI thread: (\d+)/, text),
    slowBitmapUploads: number(/Number Slow bitmap uploads: (\d+)/, text),
    slowDrawCommands: number(/Number Slow issue draw commands: (\d+)/, text),
    firstFramesMs: firstFrames(
      frameRows(text),
      frames ?? 0,
      /HISTOGRAM:(.*)/.exec(text)?.[1] ?? "",
    ),
  };
}

/** Every view, and every Compose composition, in the top activity's hierarchy. */
export function viewCensus(text) {
  const hierarchy = text.split("View Hierarchy:")[1] ?? "";
  return {
    views: [...hierarchy.matchAll(/^\s+[\w.$]+\{[0-9a-f]+ /gm)].length,
    composeViews: [...hierarchy.matchAll(/\bAndroidComposeView\{/g)].length,
  };
}

/** TotalTime from `am start -W`, in milliseconds. */
export const coldStartOf = (text) => number(/TotalTime: (\d+)/, text);

/** The App Summary of `dumpsys meminfo <package>`, in kilobytes. */
export function memInfo(text) {
  return {
    pssKb: number(/TOTAL PSS:\s+(\d+)/, text),
    nativeHeapKb: number(/Native Heap:\s+(\d+)/, text),
    graphicsKb: number(/Graphics:\s+(\d+)/, text),
  };
}

/** Resident size of the simulator's Cue process from `ps -axo rss=,command=`, in kilobytes. */
export function simulatorRss(ps) {
  const line = ps.split("\n").find((entry) => /\/Cue\.app\/Cue(\s|$)/.test(entry));
  return line === undefined ? null : Number(line.trim().split(/\s+/)[0]);
}

/**
 * Shares of a raw RGB screenshot under Android's overdraw overlay, which tints a pixel blue
 * when it is overdrawn once, green twice, pink three times and red four or more. The tint
 * blends over the screen, so a pixel counts by its dominant channel: pink and red share one
 * count, and red artwork inflates it.
 */
export function overdrawShares(rgb) {
  const counts = { blue: 0, green: 0, red: 0 };
  for (let index = 0; index + 2 < rgb.length; index += 3) {
    const [r, g, b] = [rgb[index], rgb[index + 1], rgb[index + 2]];
    if (b > r + 30 && b > g + 30) counts.blue += 1;
    else if (g > r + 30 && g > b + 30) counts.green += 1;
    else if (r > g + 30 && r > b + 30) counts.red += 1;
  }
  const pixels = rgb.length / 3;
  const share = (count) => Math.round((count / pixels) * 1000) / 10;
  return {
    bluePercent: share(counts.blue),
    greenPercent: share(counts.green),
    redPercent: share(counts.red),
  };
}

const ms = (seconds) => Math.round(seconds * 1000);
const ALIGNMENT_SLACK = 0.1;

/**
 * From the command to the first change in the content region and to the last, or null for both
 * when the content did not change. Times are seconds into the recording; the recorder's first
 * frame is the moment it started, give or take a frame or two, so a change up to
 * ALIGNMENT_SLACK before the command still counts, as 0 ms.
 * @param {number[]} changes
 * @param {number} commandAt
 */
export function changeTimes(changes, commandAt) {
  const from = commandAt - ALIGNMENT_SLACK;
  const after = changes.filter((at) => at >= from);
  const since = (at) => ms(Math.max(0, at - commandAt));
  if (after.length > 0) return { responseMs: since(after[0]), doneMs: since(after.at(-1)) };
  return { responseMs: null, doneMs: null };
}

/**
 * Times for an interaction whose content had not changed by the end of the window: censored as
 * ">window" once the content does change, so the change cannot land in the next interaction's
 * window; still null if it never does.
 * @param {{ responseMs: number | string | null, doneMs: number | string | null }} times
 * @param {() => Promise<boolean>} changes resolves whether the content went on to change
 * @param {number} windowMs
 */
export async function afterWindow(times, changes, windowMs) {
  if (times.responseMs !== null || !(await changes())) return times;
  return { responseMs: `>${windowMs}`, doneMs: `>${windowMs}` };
}

const unsettled = (measured) =>
  Object.values(measured).some((value) => value === null || typeof value === "string");

/** The measurements a sample asked for that came back empty. */
export function missing(sample) {
  return Object.entries(sample)
    .filter(([, value]) => value === null || Number.isNaN(value))
    .map(([field]) => field);
}

/** One failure line per sample with an empty measurement, naming platform, pass and segment. */
export function emptyMeasurements(platform, samples) {
  return samples.flatMap((sample) => {
    const fields = missing(sample);
    return fields.length === 0
      ? []
      : [`${platform} pass ${sample.run} ${labelOf(sample)}: no ${fields.join(", ")}`];
  });
}

/**
 * Frames the recorder captured while the list moved, and the stalls among them: a gap
 * longer than two frames counts as a hitch, and a gap of a quarter second or more is the
 * list at rest between flings rather than a stall.
 */
export function hitches(frameTimes) {
  const gaps = frameTimes.slice(1).map((at, index) => (at - frameTimes[index]) * 1000);
  const moving = gaps.filter((gap) => gap < PAUSE_MS);
  const stalls = moving.filter((gap) => gap > 2 * FRAME_MS);
  return {
    movingFrames: moving.length === 0 ? null : moving.length,
    hitches: stalls.length,
    longestHitchMs: stalls.length === 0 ? 0 : Math.round(Math.max(...stalls)),
  };
}

/** A censored value, ">2400", ranks above every measured one. */
const rank = (value) => (typeof value === "string" ? Number.POSITIVE_INFINITY : value);

const median = (values) => {
  const sorted = values.filter((value) => value !== null).sort((a, b) => rank(a) - rank(b));
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
};

const spread = (values) => {
  const known = values.filter((value) => value !== null).sort((a, b) => rank(a) - rank(b));
  return known.length === 0 ? "none" : `${known[0]} to ${known.at(-1)}`;
};

/**
 * change ÷ base, as a bound when one side is censored.
 * @param {number | string | null} before
 * @param {number | string | null} after
 */
export function ratio(before, after) {
  if (before === null || after === null || before === 0) return "n/a";
  if (typeof before === "string" && typeof after === "string") return "n/a";
  if (typeof before === "string") return `<${(after / Number(before.slice(1))).toFixed(2)}`;
  if (typeof after === "string") return `>${(Number(after.slice(1)) / before).toFixed(2)}`;
  return (after / before).toFixed(2);
}

/** One line per segment: each quantity's median over runs and the range it came from. */
const labelOf = (sample) => [sample.app, sample.segment].filter(Boolean).join(" ");

const valuesOf = (entries, field) => entries.map((entry) => entry[field] ?? null);

/** One line per app and segment: each quantity's median over runs and the range it came from. */
export function summary(platform, samples) {
  return [...Map.groupBy(samples, labelOf)].map(([label, entries]) => {
    const fields = [...new Set(entries.flatMap(Object.keys))].filter(
      (key) => !["segment", "run", "app"].includes(key),
    );
    const parts = fields.map((field) => {
      const values = valuesOf(entries, field);
      return `${field} ${median(values)} (${spread(values)})`;
    });
    return `${platform} ${label}: ${parts.join(", ")} over ${entries.length} runs`;
  });
}

/** For two apps measured in the same job: each quantity's median for both and their ratio. */
export function comparison(platform, samples) {
  const bySegment = Map.groupBy(
    samples.filter((sample) => sample.app !== undefined),
    (sample) => sample.segment,
  );
  return [...bySegment].flatMap(([segment, entries]) => {
    const base = entries.filter((entry) => entry.app === "base");
    const change = entries.filter((entry) => entry.app === "change");
    if (base.length === 0 || change.length === 0) return [];
    const fields = [...new Set(entries.flatMap(Object.keys))].filter(
      (key) => !["segment", "run", "app", "wallMs"].includes(key),
    );
    return fields.map((field) => {
      const [before, after] = [median(valuesOf(base, field)), median(valuesOf(change, field))];
      const proportion = ratio(before, after);
      return `${platform} ${segment} ${field}: base ${before} (${spread(valuesOf(base, field))}), change ${after} (${spread(valuesOf(change, field))}), change/base ${proportion}`;
    });
  });
}

async function sceneChanges(video, crop, threshold) {
  const filter = `fps=60,crop=${crop},select='gt(scene,${threshold})',showinfo`;
  const { stderr } = await run(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", video, "-vf", filter, "-f", "null", "-"],
    BUFFER,
  );
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(([, at]) => Number(at));
}

async function frameTimes(video) {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v",
      "-show_entries",
      "frame=pts_time",
      "-of",
      "csv=p=0",
      video,
    ],
    BUFFER,
  );
  return stdout.split("\n").filter(Boolean).map(Number);
}

async function analyze(video, segment, commandAt) {
  if (segment.startsWith("scroll ")) return hitches(await frameTimes(video));
  return changeTimes(await sceneChanges(video, CONTENT, CHANGE_THRESHOLD), commandAt);
}

const RAW_RGB = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"];

/** A PNG's pixels as raw RGB, after any ffmpeg arguments given, such as a crop. */
async function pixels(png, ...filter) {
  const { stdout } = await run(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", png, ...filter, ...RAW_RGB],
    { ...BUFFER, encoding: "buffer" },
  );
  return stdout;
}

const startedWhen = (child, stream, marker) =>
  new Promise((resolve, reject) => {
    child[stream].on("data", (chunk) => String(chunk).includes(marker) && resolve());
    child.on("exit", () => reject(new Error(`recorder exited before "${marker}"`)));
  });

const exited = (child) => new Promise((resolve) => child.on("exit", resolve));

function iosRecorder(device) {
  let child;
  return {
    start: (video) => {
      child = spawn("xcrun", [
        "simctl",
        "io",
        device,
        "recordVideo",
        "--codec=h264",
        "--force",
        video,
      ]);
      return startedWhen(child, "stderr", "Recording started");
    },
    stop: async () => {
      const done = exited(child);
      child.kill("SIGINT");
      await done;
    },
  };
}

const fileName = (segment) => segment.replaceAll(/[^a-z]+/g, "-");
const adb = async (...args) => (await run("adb", args, BUFFER)).stdout;
const shell = (...args) => adb("shell", ...args);

function androidRecorder() {
  const remote = "/sdcard/cue-perf.mp4";
  let child;
  let local;
  return {
    start: (video) => {
      local = video;
      child = spawn("adb", ["shell", "screenrecord", "--verbose", "--size", "720x1560", remote]);
      return startedWhen(child, "stdout", "Content area");
    },
    stop: async () => {
      const done = exited(child);
      await shell("pkill", "-INT", "screenrecord");
      await done;
      await adb("pull", remote, local);
      await shell("rm", remote);
    },
  };
}

/**
 * The interactions one pass measures, in order. Each runs its setup commands first, outside the
 * measured window, then its command; the app performs both itself, so no test driver reads its
 * view hierarchy while the screen is recorded.
 */
export const PASS = [
  { segment: "tab up-next>library", command: "tab library" },
  { segment: "tab library>calendar", command: "tab calendar" },
  { segment: "tab calendar>library", command: "tab library" },
  { segment: "tab library>up-next", command: "tab up-next" },
  { segment: "tab up-next>calendar", command: "tab calendar" },
  { segment: "tab calendar>up-next", command: "tab up-next" },
  { memory: "after tabs" },
  { segment: "scroll up-next", command: "scroll:up-next", windowMs: 3500 },
  { setup: ["end:up-next"], segment: "lapsed open", command: "lapsed" },
  { segment: "lapsed close", command: "lapsed" },
  { segment: "show detail push", command: "show 8803" },
  { segment: "episode sheet open", command: "episode 8803 2 3" },
  { setup: ["back", "season:2"], segment: "season expand", command: "season:2" },
  {
    setup: ["back", "tab library", "chip not-started"],
    segment: "scroll library not-started",
    command: "scroll:library",
    windowMs: 3500,
  },
  { setup: ["history"], segment: "scroll history", command: "scroll:history", windowMs: 3500 },
  { memory: "after lists" },
];
const WINDOW_MS = 2500;
const SETTLE_MS = 1500;
const RECORDING_LEAD_MS = 300;
const READY_MS = 120_000;
const REPLY_MS = 15_000;

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Resolves once a growing count has stopped growing for quietMs, and rejects after timeoutMs
 * with the reason given. The fake Trakt server logs every request it answers, so a still log
 * means the app has finished the fetches, artwork included, that would otherwise land inside
 * a measured window; on Android, a still frame count means the UI has stopped drawing.
 * @param {() => number | Promise<number>} read
 * @param {{ pollMs: number, quietMs: number, timeoutMs: number }} timing
 * @param {string} busy
 * @param {{ now(): number }} [clock]
 */
export async function waitForQuiet(read, { pollMs, quietMs, timeoutMs }, busy, clock = Date) {
  const started = clock.now();
  let count = await read();
  let since = started;
  for (;;) {
    await pause(pollMs);
    const now = clock.now();
    const next = await read();
    if (next !== count) [count, since] = [next, now];
    if (now - since >= quietMs) return;
    if (now - started >= timeoutMs) throw new Error(`${busy} after ${timeoutMs} ms`);
  }
}

/**
 * Resolves true once read() returns something other than reference, or false after timeoutMs.
 * @param {() => Promise<string>} read
 * @param {string} reference
 * @param {{ pollMs: number, timeoutMs: number }} timing
 * @param {{ now(): number }} [clock]
 */
export async function waitForChange(read, reference, { pollMs, timeoutMs }, clock = Date) {
  const started = clock.now();
  for (;;) {
    if ((await read()) !== reference) return true;
    if (clock.now() - started >= timeoutMs) return false;
    await pause(pollMs);
  }
}

const NETWORK_QUIET = { pollMs: 100, quietMs: 1500, timeoutMs: 30_000 };
const LATE_CHANGE = { pollMs: 250, timeoutMs: 15_000 };
const UI_QUIET = { pollMs: 100, quietMs: 500, timeoutMs: 15_000 };

const networkQuiet = (probe) =>
  waitForQuiet(probe.mockLogSize, NETWORK_QUIET, "the app was still calling Trakt");

const mockLog = () => {
  const file = process.env.PERF_MOCK_LOG;
  if (file === undefined || file === "")
    throw new Error("PERF_MOCK_LOG must name the fake Trakt log");
  return () => statSync(file).size;
};

const within = (promise, milliseconds, what) =>
  Promise.race([
    promise,
    pause(milliseconds).then(() => {
      throw new Error(`${what} took longer than ${milliseconds} ms`);
    }),
  ]);

/**
 * Pairs the app's waiting requests with the host's commands. The app asks for the next command
 * and, in the same request, replies to the previous one; "ready" opens each launch.
 */
export function createChannel() {
  let deliver;
  let replied;
  const launches = [];
  return {
    next(reply) {
      if (reply === "ready") for (const launched of launches.splice(0)) launched();
      else replied?.(reply);
      replied = undefined;
      return new Promise((resolve) => {
        deliver = resolve;
      });
    },
    ready: () => new Promise((resolve) => launches.push(resolve)),
    send(command) {
      if (deliver === undefined) return Promise.reject(new Error("the app is not listening"));
      const reply = new Promise((resolve) => {
        replied = resolve;
      });
      deliver(command);
      deliver = undefined;
      return reply;
    },
  };
}

function serve(channel) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname !== "/next") return response.writeHead(404).end();
    channel.next(url.searchParams.get("reply") ?? "").then((command) => response.end(command));
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

async function command(channel, line) {
  const reply = await within(channel.send(line), REPLY_MS, `"${line}"`);
  if (!reply.startsWith("ran ")) throw new Error(`"${line}": ${reply}`);
}

const stopAndroidApp = () => shell("am", "force-stop", PACKAGE);

async function startAndroidApp(segment) {
  const started = await shell("am", "start", "-W", "-n", `${PACKAGE}/.MainActivity`);
  return { segment, coldStartMs: coldStartOf(started) };
}

async function coldStart(segment) {
  await stopAndroidApp();
  return startAndroidApp(segment);
}

/**
 * Starts the app and waits for its channel; registered after the stop, so a ready from the
 * stopped process cannot count. A launch that never reports ready leaves a screenshot of where
 * it stopped.
 */
async function launched(probe, channel, directory) {
  await probe.stop();
  const ready = channel.ready();
  const launchedAt = Date.now();
  const sample = await probe.start();
  await within(ready, READY_MS, "launch").catch(async (error) => {
    await probe.screenshot(path.join(directory, "launch-timeout.png"));
    throw error;
  });
  return { ...sample, launchToReadyMs: Date.now() - launchedAt };
}

async function screencap(png) {
  const { stdout } = await run("adb", ["exec-out", "screencap", "-p"], {
    ...BUFFER,
    encoding: "buffer",
  });
  writeFileSync(png, stdout);
}

async function overdraw(directory, label) {
  const png = path.join(directory, `overdraw-${fileName(label)}.png`);
  await screencap(png);
  return overdrawShares(await pixels(png));
}

function androidProbe(directory) {
  const probe = {
    recorder: androidRecorder(),
    stop: stopAndroidApp,
    start: () => startAndroidApp("launch"),
    install: (apk) => adb("install", "-r", apk),
    screenshot: screencap,
    driverAttached: async () =>
      (
        await shell("pidof", "dev.mobile.maestro", "dev.mobile.maestro.test").catch(() => "")
      ).trim() !== "",
    reset: () => shell("dumpsys", "gfxinfo", PACKAGE, "reset"),
    idle: async () => {
      await shell("dumpsys", "gfxinfo", PACKAGE, "reset");
      await waitForQuiet(
        async () => frameStats(await shell("dumpsys", "gfxinfo", PACKAGE)).frames ?? 0,
        UI_QUIET,
        "the app was still drawing",
      );
    },
    frames: async (file) => {
      const dump = await shell("dumpsys", "gfxinfo", PACKAGE, "framestats");
      writeFileSync(file, dump);
      return frameStats(dump);
    },
    census: async () => viewCensus(await shell("dumpsys", "activity", "top")),
    memory: async () => memInfo(await shell("dumpsys", "meminfo", PACKAGE)),
    after: async (channel, runs, quiet) => {
      const samples = [];
      for (const [mode, segment] of [
        ["verify", "cold start verified, as a Play install starts"],
        ["speed-profile", "cold start compiled from the profile"],
      ]) {
        await shell("cmd", "package", "compile", "-m", mode, "-f", PACKAGE);
        for (let index = 1; index <= runs; index += 1)
          samples.push({ run: index, ...(await coldStart(segment)) });
      }
      await shell("setprop", "debug.hwui.overdraw", "show");
      await launched(probe, channel, directory);
      await quiet();
      samples.push({
        run: 1,
        segment: "overdraw up-next",
        ...(await overdraw(directory, "up-next")),
      });
      await command(channel, "tab library");
      await pause(SETTLE_MS);
      await quiet();
      samples.push({
        run: 1,
        segment: "overdraw library",
        ...(await overdraw(directory, "library")),
      });
      await shell("setprop", "debug.hwui.overdraw", "false");
      return samples;
    },
  };
  return probe;
}

function iosProbe(device) {
  const simctl = (...args) => run("xcrun", ["simctl", ...args, device, PACKAGE], BUFFER);
  return {
    recorder: iosRecorder(device),
    stop: () => simctl("terminate").catch(() => undefined),
    install: (app) => run("xcrun", ["simctl", "install", device, app], BUFFER),
    screenshot: (png) => run("xcrun", ["simctl", "io", device, "screenshot", png], BUFFER),
    start: async () => {
      await simctl("launch");
      return { segment: "launch" };
    },
    driverAttached: async () =>
      /xctrunner|XCTRunner|maestro-driver/.test(
        (await run("ps", ["-axo", "command="], BUFFER)).stdout,
      ),
    reset: async () => undefined,
    idle: async () => undefined,
    frames: async () => ({}),
    census: async () => ({}),
    memory: async () => ({
      rssKb: simulatorRss((await run("ps", ["-axo", "rss=,command="], BUFFER)).stdout),
    }),
    after: async () => [],
  };
}

/**
 * Records one segment while the app performs its command, keeping the first pass's videos. A
 * screenshot taken just before the command is what the content is compared with if it has not
 * changed by the end of the window.
 */
async function measure(probe, channel, directory, runIndex, step, app) {
  for (const line of step.setup ?? []) await command(channel, line);
  if (step.setup !== undefined) await pause(SETTLE_MS);
  await networkQuiet(probe);
  await probe.idle();
  const video = path.join(
    directory,
    `run-${runIndex}-${fileName([app, step.segment].filter(Boolean).join(" "))}.mp4`,
  );
  const screen = path.join(directory, "screen.png");
  const content = async () => {
    await probe.screenshot(screen);
    return createHash("sha256")
      .update(await pixels(screen, "-vf", `crop=${CONTENT}`))
      .digest("hex");
  };
  const before = await content();
  await probe.reset();
  await probe.recorder.start(video);
  const recordingAt = Date.now();
  await pause(RECORDING_LEAD_MS);
  const started = Date.now();
  await command(channel, step.command);
  const commandAt = (started - recordingAt) / 1000;
  await pause(step.windowMs ?? WINDOW_MS);
  const windowEnd = (Date.now() - recordingAt) / 1000;
  await probe.recorder.stop();
  const wallMs = Date.now() - started;
  const frames = await probe.frames(video.replace(/\.mp4$/, "-gfxinfo.txt"));
  const census = step.segment.startsWith("tab ") ? await probe.census() : {};
  const measured = await afterWindow(
    await analyze(video, step.segment, commandAt),
    () => waitForChange(content, before, LATE_CHANGE),
    ms(windowEnd - commandAt),
  );
  if (runIndex > 1 && !unsettled(measured)) rmSync(video, { force: true });
  return { run: runIndex, segment: step.segment, wallMs, ...measured, ...frames, ...census };
}

async function pass(probe, channel, directory, runIndex, app) {
  await fetch(`${MOCK}/__reset?seed=scale`, { method: "POST" });
  const samples = [{ run: runIndex, ...(await launched(probe, channel, directory)) }];
  for (const step of PASS) {
    if (step.memory !== undefined) {
      samples.push({ run: runIndex, segment: `memory ${step.memory}`, ...(await probe.memory()) });
      continue;
    }
    samples.push(await measure(probe, channel, directory, runIndex, step, app));
  }
  return samples;
}

function report(platform, directory, samples, failures) {
  const lines = [...summary(platform, samples), ...comparison(platform, samples), ...failures];
  writeFileSync(
    path.join(directory, `perf-${platform}.json`),
    `${JSON.stringify(samples, null, 2)}\n`,
  );
  writeFileSync(path.join(directory, `perf-${platform}.txt`), `${lines.join("\n")}\n`);
  for (const line of lines) process.stdout.write(`Perf probe: ${line}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const body = lines.map((line) => `- ${line}`).join("\n");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Perf probe, ${platform}\n\n${body}\n`);
  }
}

/** Apps to measure by label: one app, or a base and a change measured in alternate passes. */
export function appsOf(paths) {
  if (paths.length === 0) return [{ label: undefined, path: undefined }];
  if (paths.length === 1) return [{ label: undefined, path: paths[0] }];
  return [
    { label: "base", path: paths[0] },
    { label: "change", path: paths[1] },
  ];
}

const tagged = (app, samples) => samples.map((sample) => ({ ...sample, app }));

async function measureApps(probe, channel, directory, runs, apps) {
  const samples = [];
  for (let index = 1; index <= runs; index += 1) {
    for (const app of apps) {
      if (apps.length > 1) await probe.install(app.path);
      samples.push(...tagged(app.label, await pass(probe, channel, directory, index, app.label)));
    }
  }
  for (const app of apps) {
    if (apps.length > 1) await probe.install(app.path);
    const quiet = () => networkQuiet(probe);
    samples.push(...tagged(app.label, await probe.after(channel, runs, quiet)));
  }
  return samples;
}

async function main() {
  const [platform, directory, runsArgument = "3", ...paths] = process.argv.slice(2);
  if (platform !== "ios" && platform !== "android") {
    throw new Error(
      "usage: perf-probe.mjs <ios|android> <output directory> <runs> [base app] [changed app]",
    );
  }
  mkdirSync(directory, { recursive: true });
  const probe = {
    ...(platform === "android" ? androidProbe(directory) : iosProbe(process.env.DEVICE_ID)),
    mockLogSize: mockLog(),
  };
  if (await probe.driverAttached())
    throw new Error("a test driver is still running; stop it first");
  const channel = createChannel();
  const server = await serve(channel);
  const samples = [];
  const failures = [];
  try {
    samples.push(
      ...(await measureApps(probe, channel, directory, Number(runsArgument), appsOf(paths))),
    );
  } catch (error) {
    failures.push(`stopped: ${error.message}`);
  }
  server.close();
  server.closeAllConnections();
  failures.push(...emptyMeasurements(platform, samples));
  report(platform, directory, samples, failures);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
