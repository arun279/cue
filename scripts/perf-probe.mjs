// Measures the harness app on one platform over several passes and reports what each
// interaction cost. The app performs every interaction itself, on a command this process sends
// over a long-poll channel (src/ui/perf-channel.ts), because a test driver reading the view
// hierarchy blocks the app's main thread: XCTest's accessibility snapshots on iOS, and
// UiAutomator's node queries on Android, which run on the app's UI thread. Maestro only signs
// in, before this starts, and must not be running.
// Both platforms record every interaction's screen and time it the same way: a tab switch from
// the tab bar's first change to the content's first change, a push, a sheet, a season or the
// lapsed section from the first change to the last, a scroll by the gaps between the frames
// the recorder captured. Android adds what the platform keeps: frame statistics per segment
// (dumpsys gfxinfo), the views and Compose hosts on screen after a tab switch (dumpsys
// activity top), memory (dumpsys meminfo), overdraw, and cold start (am start -W) as adb
// installed the app, verified the way a Play install without a profile is, and compiled from
// the profile the passes collected. iOS adds the app's resident memory. Nothing gates on any
// number.
// Usage: perf-probe.mjs <ios|android> <output directory> <runs> [simulator]
import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const CROPS = {
  ios: { bar: "iw:ih*0.1:0:ih*0.88", content: "iw:ih*0.72:0:ih*0.1" },
  android: { bar: "iw:ih*0.09:0:ih*0.855", content: "iw:ih*0.72:0:ih*0.1" },
};

const number = (pattern, text) => {
  const match = pattern.exec(text);
  return match === null ? null : Number(match[1]);
};

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
 * The slowest of the first three frames since the reset, and the slowest layout among them.
 * Unknown when the platform has already dropped them from its 120-frame window, and frames
 * the platform flags as unreliable do not count.
 */
function firstFrames(rows, rendered) {
  const first = rows
    .filter((frame) => frame.Flags === 0)
    .sort((a, b) => a.IntendedVsync - b.IntendedVsync)
    .slice(0, 3);
  if (first.length === 0 || rendered > rows.length)
    return { firstFramesMs: null, firstLayoutMs: null };
  return {
    firstFramesMs: nsToMs(
      Math.max(...first.map((frame) => frame.FrameCompleted - frame.IntendedVsync)),
    ),
    firstLayoutMs: nsToMs(
      Math.max(...first.map((frame) => frame.DrawStart - frame.PerformTraversalsStart)),
    ),
  };
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
    ...firstFrames(frameRows(text), frames ?? 0),
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

/** From the first tab bar change to the first content change after it, or null. */
export function swapMs(barChanges, contentChanges) {
  const touched = barChanges[0];
  if (touched === undefined) return null;
  const swapped = contentChanges.find((at) => at > touched);
  return swapped === undefined ? null : ms(swapped - touched);
}

/** From the first content change to the last, or null when nothing changed. */
export function settleMs(contentChanges) {
  return contentChanges.length === 0 ? null : ms(contentChanges.at(-1) - contentChanges[0]);
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
    movingFrames: moving.length,
    hitches: stalls.length,
    longestHitchMs: stalls.length === 0 ? 0 : Math.round(Math.max(...stalls)),
  };
}

const median = (values) => {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
};

const spread = (values) => {
  const known = values.filter((value) => value !== null);
  return known.length === 0 ? "none" : `${Math.min(...known)} to ${Math.max(...known)}`;
};

/** One line per segment: each quantity's median over runs and the range it came from. */
export function summary(platform, samples) {
  return [...Map.groupBy(samples, (sample) => sample.segment)].map(([segment, entries]) => {
    const fields = [...new Set(entries.flatMap(Object.keys))].filter(
      (key) => key !== "segment" && key !== "run",
    );
    const parts = fields.map((field) => {
      const values = entries.map((entry) => entry[field] ?? null);
      return `${field} ${median(values)} (${spread(values)})`;
    });
    return `${platform} ${segment}: ${parts.join(", ")} over ${entries.length} runs`;
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

async function analyse(video, segment, crops) {
  if (segment.startsWith("tab ")) {
    const [bar, content] = await Promise.all([
      sceneChanges(video, crops.bar, 0.005),
      sceneChanges(video, crops.content, 0.01),
    ]);
    return { swapMs: swapMs(bar, content) };
  }
  if (segment.startsWith("scroll ")) return hitches(await frameTimes(video));
  return { settleMs: settleMs(await sceneChanges(video, crops.content, 0.003)) };
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
  { setup: ["back"], segment: "season expand", command: "season:1" },
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
const READY_MS = 120_000;
const REPLY_MS = 15_000;

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

async function coldStart(segment) {
  await shell("am", "force-stop", PACKAGE);
  const started = await shell("am", "start", "-W", "-n", `${PACKAGE}/.MainActivity`);
  return { segment, coldStartMs: coldStartOf(started) };
}

async function overdraw(directory, label) {
  const png = path.join(directory, `overdraw-${fileName(label)}.png`);
  const { stdout: image } = await run("adb", ["exec-out", "screencap", "-p"], {
    ...BUFFER,
    encoding: "buffer",
  });
  writeFileSync(png, image);
  const { stdout } = await run(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { ...BUFFER, encoding: "buffer" },
  );
  return overdrawShares(stdout);
}

function androidProbe(directory) {
  return {
    recorder: androidRecorder(),
    crops: CROPS.android,
    launch: () => coldStart("launch"),
    driverAttached: async () =>
      (
        await shell("pidof", "dev.mobile.maestro", "dev.mobile.maestro.test").catch(() => "")
      ).trim() !== "",
    reset: () => shell("dumpsys", "gfxinfo", PACKAGE, "reset"),
    frames: async () => frameStats(await shell("dumpsys", "gfxinfo", PACKAGE, "framestats")),
    census: async () => viewCensus(await shell("dumpsys", "activity", "top")),
    memory: async () => memInfo(await shell("dumpsys", "meminfo", PACKAGE)),
    after: async (channel, runs) => {
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
      const ready = channel.ready();
      await coldStart("overdraw launch");
      await within(ready, READY_MS, "launch");
      await pause(SETTLE_MS);
      samples.push({
        run: 1,
        segment: "overdraw up-next",
        ...(await overdraw(directory, "up-next")),
      });
      await command(channel, "tab library");
      await pause(SETTLE_MS);
      samples.push({
        run: 1,
        segment: "overdraw library",
        ...(await overdraw(directory, "library")),
      });
      await shell("setprop", "debug.hwui.overdraw", "false");
      return samples;
    },
  };
}

function iosProbe(device) {
  const simctl = (...args) => run("xcrun", ["simctl", ...args, device, PACKAGE], BUFFER);
  return {
    recorder: iosRecorder(device),
    crops: CROPS.ios,
    launch: async () => {
      await simctl("terminate").catch(() => undefined);
      await simctl("launch");
      return { segment: "launch" };
    },
    driverAttached: async () =>
      /xctrunner|XCTRunner|maestro-driver/.test(
        (await run("ps", ["-axo", "command="], BUFFER)).stdout,
      ),
    reset: async () => undefined,
    frames: async () => ({}),
    census: async () => ({}),
    memory: async () => ({
      rssKb: simulatorRss((await run("ps", ["-axo", "rss=,command="], BUFFER)).stdout),
    }),
    after: async () => [],
  };
}

/** Records one segment while the app performs its command, keeping the first pass's videos. */
async function measure(probe, channel, directory, runIndex, step) {
  for (const line of step.setup ?? []) await command(channel, line);
  if (step.setup !== undefined) await pause(SETTLE_MS);
  const video = path.join(directory, `run-${runIndex}-${fileName(step.segment)}.mp4`);
  await probe.reset();
  await probe.recorder.start(video);
  const started = Date.now();
  await command(channel, step.command);
  await pause(step.windowMs ?? WINDOW_MS);
  await probe.recorder.stop();
  const wallMs = Date.now() - started;
  const frames = await probe.frames();
  const census = step.segment.startsWith("tab ") ? await probe.census() : {};
  return {
    analysis: analyse(video, step.segment, probe.crops).then((measured) => {
      if (runIndex > 1) rmSync(video, { force: true });
      return { run: runIndex, segment: step.segment, wallMs, ...measured, ...frames, ...census };
    }),
  };
}

async function pass(probe, channel, directory, runIndex) {
  await fetch(`${MOCK}/__reset?seed=scale`, { method: "POST" });
  const ready = channel.ready();
  const launchedAt = Date.now();
  const launched = await probe.launch();
  await within(ready, READY_MS, "launch");
  const samples = [{ run: runIndex, ...launched, launchToReadyMs: Date.now() - launchedAt }];
  const pending = [];
  for (const step of PASS) {
    if (step.memory !== undefined) {
      samples.push({ run: runIndex, segment: `memory ${step.memory}`, ...(await probe.memory()) });
      continue;
    }
    pending.push((await measure(probe, channel, directory, runIndex, step)).analysis);
  }
  return [...samples, ...(await Promise.all(pending))];
}

function report(platform, directory, samples, failures) {
  const lines = [...summary(platform, samples), ...failures];
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

async function main() {
  const [platform, directory, runsArgument = "3", device] = process.argv.slice(2);
  if (platform !== "ios" && platform !== "android") {
    throw new Error("usage: perf-probe.mjs <ios|android> <output directory> <runs> [simulator]");
  }
  const runs = Number(runsArgument);
  mkdirSync(directory, { recursive: true });
  const probe = platform === "android" ? androidProbe(directory) : iosProbe(device);
  if (await probe.driverAttached())
    throw new Error("a test driver is still running; stop it first");
  const channel = createChannel();
  const server = await serve(channel);
  const samples = [];
  const failures = [];
  try {
    for (let index = 1; index <= runs; index += 1)
      samples.push(...(await pass(probe, channel, directory, index)));
    samples.push(...(await probe.after(channel, runs)));
  } catch (error) {
    failures.push(`stopped: ${error.message}`);
  }
  server.close();
  server.closeAllConnections();
  report(platform, directory, samples, failures);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
