import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { DEFAULT_TRAKT_POLICY } from "../../packages/core/src/data/trakt/policy";
import {
  collectionMoviesBody,
  collectionShowsBody,
  createSeedLibrary,
  historyRows,
  watchedShowsBody,
  watchlistBody,
} from "../../scripts/mock-trakt/seed.mjs";
import {
  appsOf,
  changeTimes,
  coldStartOf,
  comparison,
  createChannel,
  emptyMeasurements,
  frameStats,
  hitches,
  launchLoop,
  memInfo,
  missing,
  overdrawShares,
  PASS,
  ratio,
  simulatorRss,
  summary,
  viewCensus,
  waitForQuiet,
} from "../../scripts/perf-probe.mjs";
import { repositoryPath } from "../support/repository-path";

const GFXINFO = `Applications Graphics Acceleration Info:
Uptime: 1052836 Realtime: 1052836

** Graphics info for pid 4012 [app.cuetracker] **

Stats since: 1049310929604ns
Total frames rendered: 212
Janky frames: 31 (14.62%)
Janky frames (legacy): 40 (18.87%)
50th percentile: 9ms
90th percentile: 21ms
95th percentile: 34ms
99th percentile: 69ms
Number Missed Vsync: 7
Number High input latency: 2
Number Slow UI thread: 12
Number Slow bitmap uploads: 0
Number Slow issue draw commands: 5
Number Frame deadline missed: 31
HISTOGRAM: 5ms=60 6ms=20`;

const COLUMNS =
  "Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameStartTime,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionCompleted,";

const frame = (flags: number, vsyncMs: number, layoutMs: number, totalMs: number) => {
  const at = (offsetMs: number) => String((vsyncMs + offsetMs) * 1_000_000);
  const values: Record<string, string> = {
    Flags: String(flags),
    IntendedVsync: at(0),
    PerformTraversalsStart: at(1),
    DrawStart: at(1 + layoutMs),
    FrameCompleted: at(totalMs),
  };
  return `${COLUMNS.split(",")
    .slice(0, -1)
    .map((column) => values[column] ?? "0")
    .join(",")},`;
};

const framestats = (rendered: number, rows: string[]) =>
  `${GFXINFO.replace("Total frames rendered: 212", `Total frames rendered: ${rendered}`)}
---PROFILEDATA---
${COLUMNS}
${rows.join("\n")}
---PROFILEDATA---
View hierarchy:`;

it("reads the frame summary dumpsys gfxinfo prints for the app", () => {
  expect(frameStats(GFXINFO)).toEqual({
    frames: 212,
    jankyPercent: 14.62,
    p50Ms: 9,
    p90Ms: 21,
    p99Ms: 69,
    slowUiThread: 12,
    slowBitmapUploads: 0,
    slowDrawCommands: 5,
    firstFramesMs: null,
  });
});

it("reports a missing gfxinfo field as unknown rather than zero", () => {
  expect(frameStats("No process found for: app.cuetracker").frames).toBeNull();
});

it("takes the slowest of the first three frames after a reset, leaving out skipped frames", () => {
  const rows = [
    frame(0, 1032, 1, 9),
    frame(0, 1000, 2, 12),
    frame(8, 1010, 30, 90),
    frame(1, 1016, 18, 48.5),
    frame(0, 1048, 40, 80),
  ];

  expect(frameStats(framestats(5, rows))).toMatchObject({ firstFramesMs: 48.5 });
});

it("counts the single frame that follows a window change, as when the lapsed section closes", () => {
  expect(frameStats(framestats(1, [frame(1, 1000, 3, 21.7)]))).toMatchObject({
    firstFramesMs: 21.7,
  });
});

it("leaves the first frames unknown once the 120-frame window has dropped them", () => {
  expect(frameStats(framestats(121, [frame(0, 1000, 2, 12)]))).toMatchObject({
    firstFramesMs: null,
  });
});

it("counts the views and the Compose compositions in the top activity's hierarchy", () => {
  const dump = `TASK 10 id=12 userId=0
  ACTIVITY app.cuetracker/.MainActivity 3c1a0f pid=4012
    Local FragmentActivity 9a1b2c State:
    View Hierarchy:
      DecorView@5f1e2d[MainActivity]
        android.widget.LinearLayout{8d2e1f0 V.E...... ........ 0,0-1440,3120}
          com.facebook.react.views.view.ReactViewGroup{1a2b3c4 V.E...... ........ 0,0-1440,3120 #12}
            expo.modules.ui.HostView{2b3c4d5 V.E...... ........ 0,0-96,96 #40}
              androidx.compose.ui.platform.AndroidComposeView{3c4d5e6 VFED..... ........ 0,0-96,96}
            expo.modules.ui.HostView{4d5e6f7 V.E...... ........ 96,0-192,96 #41}
              androidx.compose.ui.platform.AndroidComposeView{5e6f708 VFED..... ........ 0,0-96,96}
            androidx.compose.ui.platform.ComposeView{6f708a9 V.E...... ........ 0,96-1440,192}
              androidx.compose.ui.platform.AndroidComposeView{708a9ba VFED..... ........ 0,0-1440,96}
    Looper (main, tid 2) {8f1a2b3}`;

  expect(viewCensus(dump)).toEqual({ views: 8, composeViews: 3 });
});

it("reads cold start from am start -W and memory from dumpsys meminfo", () => {
  expect(
    coldStartOf(`Starting: Intent { cmp=app.cuetracker/.MainActivity }
Status: ok
LaunchState: COLD
Activity: app.cuetracker/.MainActivity
TotalTime: 1834
WaitTime: 1840
Complete`),
  ).toBe(1834);
  expect(
    memInfo(`                   Pss  Private  Private  SwapPss      Rss     Heap
                 Total    Dirty    Clean    Dirty    Total     Size
  Native Heap    61022    60900        0        0    63100    80192
        TOTAL   187301   152044    24120        0   268400   101203
 App Summary
                       Pss(KB)                        Rss(KB)
           Java Heap:    18204                          30120
         Native Heap:    60900                          63100
            Graphics:    23310                          23310
           TOTAL PSS:   187301            TOTAL RSS:   268400       TOTAL SWAP PSS:        0`),
  ).toEqual({ pssKb: 187301, nativeHeapKb: 60900, graphicsKb: 23310 });
});

it("finds the resident size of Cue's simulator process and not another app's", () => {
  const ps = [
    " 90412 /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Simulator",
    " 51200 /Users/runner/Library/Developer/CoreSimulator/Devices/X/data/Containers/Bundle/Application/Y/CueWidgets.app/CueWidgets",
    " 245760 /Users/runner/Library/Developer/CoreSimulator/Devices/X/data/Containers/Bundle/Application/Z/Cue.app/Cue",
  ].join("\n");
  expect(simulatorRss(ps)).toBe(245760);
  expect(simulatorRss(ps.split("\n")[0] ?? "")).toBeNull();
});

it("times an interaction from its command to the content's first and last change after it", () => {
  expect(changeTimes([0.1, 0.71, 0.9, 1.25], 0.3)).toEqual({ responseMs: 410, doneMs: 950 });
  expect(changeTimes([0.5], 0.3)).toEqual({ responseMs: 200, doneMs: 200 });
});

it("reports no timing when nothing in the content region changed after the command", () => {
  expect(changeTimes([], 0.3)).toEqual({ responseMs: null, doneMs: null });
  expect(changeTimes([0.1, 0.15], 0.3)).toEqual({ responseMs: null, doneMs: null });
});

it("names every empty measurement by platform, pass and segment", () => {
  const samples = [
    { run: 1, segment: "tab up-next>library", responseMs: 120, doneMs: 380, jankyPercent: 40 },
    { run: 2, segment: "tab library>calendar", swapMs: null, jankyPercent: 30 },
    { run: 3, segment: "season expand", responseMs: null, doneMs: null },
    { run: 1, segment: "scroll history", movingFrames: null, hitches: 0 },
  ];

  expect(missing(samples[0] ?? {})).toEqual([]);
  expect(emptyMeasurements("android", samples)).toEqual([
    "android pass 2 tab library>calendar: no swapMs",
    "android pass 3 season expand: no responseMs, doneMs",
    "android pass 1 scroll history: no movingFrames",
  ]);
});

it("counts frames held past two refreshes while moving, and not the rests between flings", () => {
  const steady = Array.from({ length: 30 }, (_, index) => index / 60);
  const stalled = [...steady, 0.5 + 0.1, 0.5 + 0.1 + 1 / 60];
  const rested = [...steady, 3, 3 + 1 / 60];

  expect(hitches(steady)).toEqual({ movingFrames: 29, hitches: 0, longestHitchMs: 0 });
  expect(hitches([0, 1, 2])).toMatchObject({ movingFrames: null });
  expect(hitches(stalled)).toMatchObject({ hitches: 1, longestHitchMs: 117 });
  expect(hitches(rested)).toEqual({ movingFrames: 30, hitches: 0, longestHitchMs: 0 });
});

it("splits an overdraw capture by the overlay's tint, pink and red counted together", () => {
  const pixels = [
    [180, 180, 255],
    [180, 255, 180],
    [255, 190, 190],
    [255, 128, 128],
    [250, 250, 250],
  ];

  expect(overdrawShares(Buffer.from(pixels.flat()))).toEqual({
    bluePercent: 20,
    greenPercent: 20,
    redPercent: 40,
  });
});

it("reports each segment as the median over runs with its range, keeping unknowns out", () => {
  const lines = summary("android", [
    { run: 1, segment: "tab up-next>library", swapMs: 300, jankyPercent: 10 },
    { run: 2, segment: "tab up-next>library", swapMs: null, jankyPercent: 30 },
    { run: 3, segment: "tab up-next>library", swapMs: 200, jankyPercent: 20 },
    { run: 1, segment: "memory", pssKb: 180000 },
  ]);
  expect(lines).toEqual([
    "android tab up-next>library: swapMs 200 (200 to 300), jankyPercent 20 (10 to 30) over 3 runs",
    "android memory: pssKb 180000 (180000 to 180000) over 1 runs",
  ]);
});

it("serves the probe's synthetic account at the scale of a long-time Trakt user, 50 idle shows among those Cue reads progress for", () => {
  const library = createSeedLibrary("scale");
  const origin = "http://mock";
  const watched: { plays: number; last_watched_at: string; show: { aired_episodes: number } }[] =
    watchedShowsBody(library, "full");
  const lapsedCutoff = library.now - 21 * 86_400_000;
  const unfinished = watched.filter((entry) => entry.plays < entry.show.aired_episodes);
  const progressRead = unfinished
    .toSorted((a, b) => Date.parse(b.last_watched_at) - Date.parse(a.last_watched_at))
    .slice(0, DEFAULT_TRAKT_POLICY.progressBudget);
  const lapsed = progressRead.filter((entry) => Date.parse(entry.last_watched_at) < lapsedCutoff);
  const watchlist = [
    ...watchlistBody(library, origin, "images", "shows"),
    ...watchlistBody(library, origin, "images", "movies"),
  ];
  const collection = [
    ...collectionShowsBody(library, origin, "images"),
    ...collectionMoviesBody(library, origin, "images"),
  ];
  const history = historyRows(library, origin, "images", "all");

  expect(watched.length).toBeGreaterThanOrEqual(105);
  expect(unfinished.length).toBeGreaterThanOrEqual(100);
  expect(lapsed.length).toBeGreaterThanOrEqual(50);
  expect(history.length).toBeGreaterThanOrEqual(900);
  expect(watchlist.length).toBeGreaterThanOrEqual(340);
  expect(collection.length).toBeGreaterThanOrEqual(150);
  expect(history).toContainEqual(
    expect.objectContaining({
      show: expect.objectContaining({ title: expect.stringMatching(/^.{61,}$/) }),
    }),
  );
  expect(history).toContainEqual(
    expect.objectContaining({
      show: expect.objectContaining({ images: expect.objectContaining({ poster: [] }) }),
    }),
  );
  expect(history).toContainEqual(
    expect.objectContaining({
      movie: expect.objectContaining({
        images: expect.objectContaining({ poster: [], fanart: [] }),
      }),
    }),
  );
});

const WORKFLOWS = repositoryPath(".github/workflows");

const triggersOf = (workflow: string) => {
  const source = readFileSync(path.join(WORKFLOWS, workflow), "utf8");
  const block = /^on:\n((?: {2}.*\n|\n)+)/m.exec(source)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/^ {2}(\w[\w-]*):(.*)\n((?: {4}.*\n)*)/gm)].map(([, name, , body]) => [
      name,
      body,
    ]),
  );
};

/** A push trigger's branch filters; a push trigger without them matches every branch. */
const pushBranches = (body: string): string[] => {
  const list = /^ {4}branches: \[(.*)\]$/m.exec(body)?.[1];
  return list === undefined
    ? ["**"]
    : list.split(",").map((entry) => entry.trim().replaceAll('"', ""));
};

const escaped = (text: string) => text.replaceAll(/[.+?^$()|[\]\\{}]/g, "\\$&");

/** GitHub's branch filter syntax: `*` stays within one path segment, `**` crosses them. */
const filterMatches = (pattern: string, branch: string) => {
  const segments = pattern.split("**").map((part) => part.split("*").map(escaped).join("[^/]*"));
  return new RegExp(`^${segments.join(".*")}$`).test(branch);
};

it("matches branch filters the way GitHub does", () => {
  expect(filterMatches("perf-probe/**", "perf-probe/base/147")).toBe(true);
  expect(filterMatches("release/*", "release/1.2")).toBe(true);
  expect(filterMatches("release/*", "release/1/2")).toBe(false);
  expect(filterMatches("main", "perf-probe/main")).toBe(false);
});

it("runs only on perf-probe/** pushes or dispatch, and nothing else runs on those pushes", () => {
  const probe = triggersOf("perf-probe.yml");
  const others = readdirSync(WORKFLOWS).filter(
    (name) => name.endsWith(".yml") && name !== "perf-probe.yml",
  );
  const alsoTriggered = others.filter((workflow) => {
    const push = triggersOf(workflow).push;
    return (
      push !== undefined &&
      pushBranches(push).some((filter) => filterMatches(filter, "perf-probe/baseline"))
    );
  });

  expect(Object.keys(probe)).toEqual(["push", "workflow_dispatch"]);
  expect(pushBranches(probe.push ?? "")).toEqual(["perf-probe/**"]);
  expect(pushBranches(triggersOf("ci.yml").push ?? "")).toEqual([
    "main",
    "feat/expo-native",
    "release/*",
  ]);
  expect(others).toContain("ci.yml");
  expect(alsoTriggered).toEqual([]);
  expect(readFileSync(path.join(WORKFLOWS, "ci.yml"), "utf8")).not.toMatch(
    /perf-probe|\.maestro\/perf\//,
  );
});

it("hands each command to the app's waiting request and resolves with the app's reply", async () => {
  const channel = createChannel();
  const launched = channel.ready();
  await expect(channel.send("tab library")).rejects.toThrow("not listening");

  const first = channel.next("ready", JSON.stringify({ fonts: 120, ready: 940 }));
  expect(await launched).toEqual({ bootFontsMs: 120, bootReadyMs: 940 });
  const reply = channel.send("tab library");
  expect(await first).toBe("tab library");
  void channel.next("ran tab");
  expect(await reply).toBe("ran tab");

  const relaunched = channel.ready();
  const third = channel.next("ready");
  expect(await relaunched).toEqual({});
  const lapsed = channel.send("lapsed");
  expect(await third).toBe("lapsed");
  void channel.next("unknown lapsed");
  expect(await lapsed).toBe("unknown lapsed");
});

it("fails the waiting launch with the reason the app gives when its runtime does not start", async () => {
  const channel = createChannel();
  const launched = channel.ready();

  void channel.next("boot failed: Error: database is locked");

  await expect(launched).rejects.toThrow("boot failed: Error: database is locked");
});

it("relaunches each app in turn and names every launch that did not reach ready", async () => {
  const channel = createChannel();
  const replies = ["ready", "boot failed: Error: database is locked", "ready", "ready"];
  const installed: string[] = [];
  const probe = {
    stop: async () => {},
    install: async (app: string) => {
      installed.push(app);
    },
    start: async () => {
      void channel.next(replies.shift() ?? "");
      return { segment: "launch" };
    },
  };
  const apps = [
    { label: "base", path: "base.apk" },
    { label: "change", path: "change.apk" },
  ];

  const { samples, failures } = await launchLoop(probe, channel, 2, apps);

  expect(installed).toEqual(["base.apk", "change.apk"]);
  expect(failures).toEqual(["launch 2 base: boot failed: Error: database is locked"]);
  expect(samples.map(({ run, app }) => `${app} ${run}`)).toEqual([
    "base 1",
    "change 1",
    "change 2",
  ]);
});

const NATIVE = repositoryPath("packages/native");

const sourcesUnder = (directory: string): string[] =>
  readdirSync(path.join(NATIVE, directory), { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => readFileSync(path.join(NATIVE, directory, name), "utf8"));

it("sends only commands the app registers", () => {
  const sources = [...sourcesUnder("app"), ...sourcesUnder("src")].join("\n");
  const channel = readFileSync(path.join(NATIVE, "src/ui/perf-channel.ts"), "utf8");
  const registered = [
    ...[...channel.matchAll(/^ {2}\[\s*"([\w:-]+)",/gm)].map(([, name = ""]) => name),
    ...[...sources.matchAll(/usePerfCommand\(\s*["`]([\w:-]+)/g)].map(([, name = ""]) => name),
    ...[...sources.matchAll(/usePerfScroll\(\s*"([\w-]+)"/g)].map(
      ([, name = ""]) => `scroll:${name}`,
    ),
  ];
  const sent = PASS.flatMap((step) => [
    ...(step.setup ?? []),
    ...(step.command ? [step.command] : []),
  ]);
  const unregistered = sent
    .map((line) => line.split(" ")[0] ?? "")
    .filter(
      (name) =>
        !registered.some(
          (known) => known === name || (known.endsWith(":") && name.startsWith(known)),
        ),
    );

  expect(registered).toEqual(
    expect.arrayContaining(["tab", "back", "lapsed", "season:", "scroll:history"]),
  );
  expect(unregistered).toEqual([]);
});

it("samples memory right after launch, after the tab tour and after the lists, in that order", () => {
  expect(PASS.flatMap((step) => ("memory" in step ? [step.memory] : []))).toEqual([
    "after launch",
    "after tabs",
    "after lists",
  ]);
  expect(PASS[0]).toEqual({ memory: "after launch" });
});

const transformed = (harness: boolean) =>
  spawnSync(
    process.execPath,
    [
      "-e",
      `const babel = require(require.resolve("@babel/core", { paths: [process.cwd()] }));
      const { code } = babel.transformSync(process.argv[1], { filename: "Row.tsx", configFile: "./babel.config.js" });
      process.stdout.write(code);`,
      `import { useBootMark, usePerfCommand, usePerfScroll } from "./harness";
      export function Row({ onToggle, list, restoring }) {
        usePerfCommand("lapsed", onToggle);
        usePerfScroll("history", (y) => list.scrollTo(y));
        useBootMark("restored", !restoring());
        return null;
      }`,
    ],
    {
      cwd: NATIVE,
      encoding: "utf8",
      env: { ...process.env, EXPO_PUBLIC_UI_HARNESS: harness ? "1" : "" },
    },
  ).stdout;

it("removes perf channel registrations and boot marks from store builds and keeps them in harness builds", () => {
  const store = transformed(false);
  const harness = transformed(true);

  expect(store).toContain("function Row");
  expect(store).not.toMatch(/usePerf(Command|Scroll)\)?\(|useBootMark\)?\(|restoring\(/);
  expect(store).not.toContain("./harness");
  expect(harness).toMatch(/usePerfCommand\)?\("lapsed"/);
  expect(harness).toMatch(/usePerfScroll\)?\("history"/);
  expect(harness).toMatch(/useBootMark\)?\("restored", ?!restoring\(\)\)/);
  expect(harness).toContain("./harness");
});

it("measures one app as is, and two as a base and a change in alternate passes", () => {
  expect(appsOf([])).toEqual([{ label: undefined, path: undefined }]);
  expect(appsOf(["a.apk"])).toEqual([{ label: undefined, path: "a.apk" }]);
  expect(appsOf(["a.apk", "b.apk"])).toEqual([
    { label: "base", path: "a.apk" },
    { label: "change", path: "b.apk" },
  ]);
});

it("compares a change with its base per segment and quantity, and labels empty samples by app", () => {
  const samples = [
    { run: 1, app: "base", segment: "lapsed open", wallMs: 2600, responseMs: 300, doneMs: 330 },
    { run: 1, app: "change", segment: "lapsed open", wallMs: 2500, responseMs: 240, doneMs: 240 },
    { run: 2, app: "base", segment: "lapsed open", wallMs: 2600, responseMs: 320, doneMs: 360 },
    { run: 2, app: "change", segment: "lapsed open", wallMs: 2500, responseMs: 260, doneMs: null },
  ];

  expect(comparison("ios", samples)).toEqual([
    "ios lapsed open responseMs: base 300 (300 to 320), change 240 (240 to 260), change/base 0.80",
    "ios lapsed open doneMs: base 330 (330 to 360), change 240 (240 to 240), change/base 0.73",
  ]);
  expect(summary("ios", samples)[0]).toMatch(/^ios base lapsed open: wallMs 2600/);
  expect(emptyMeasurements("ios", samples)).toEqual(["ios pass 2 change lapsed open: no doneMs"]);
});

const ticking = (sizes: number[], stepMs: number) => {
  let now = 0;
  let read = 0;
  return {
    clock: { now: () => now },
    readSize: () => {
      const size = sizes[Math.min(read, sizes.length - 1)] ?? 0;
      read += 1;
      now += stepMs;
      return size;
    },
  };
};

it("waits until the fake Trakt log stops growing before a measurement", async () => {
  const { clock, readSize } = ticking([10, 20, 30, 30, 30, 30, 30], 100);
  await waitForQuiet(readSize, { pollMs: 0, quietMs: 300, timeoutMs: 5000 }, "busy", clock);
  expect(clock.now()).toBeGreaterThanOrEqual(600);
});

it("fails when the app keeps calling Trakt", async () => {
  const sizes = Array.from({ length: 100 }, (_, index) => index);
  const { clock, readSize } = ticking(sizes, 100);
  await expect(
    waitForQuiet(
      readSize,
      { pollMs: 0, quietMs: 300, timeoutMs: 2000 },
      "the app was still calling Trakt",
      clock,
    ),
  ).rejects.toThrow("the app was still calling Trakt after 2000 ms");
});

it("prepares the emulator for the probe the way the Android device lanes do", () => {
  const lanes = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");
  const probe = readFileSync(repositoryPath("scripts/perf-probe-android.sh"), "utf8");
  const setup = /^adb shell (settings put|wm |am broadcast).*$/gm;
  const count = (text: string, line: string) =>
    text.split("\n").filter((entry) => entry === line).length;
  const short = [...new Set(lanes.match(setup) ?? [])].filter(
    (line) => count(probe, line) < count(lanes, line),
  );

  expect(lanes.match(setup)?.length).toBeGreaterThan(0);
  expect(short).toEqual([]);
});

it("waits on a count read asynchronously, such as the frames the Android UI has drawn", async () => {
  const { clock, readSize } = ticking([0, 3, 7, 7, 7, 7, 7, 7], 100);
  await waitForQuiet(
    async () => readSize(),
    { pollMs: 0, quietMs: 400, timeoutMs: 5000 },
    "the app was still drawing",
    clock,
  );
  expect(clock.now()).toBeGreaterThanOrEqual(700);
});

it("reads a frame the summary counted but the frame list lost from the summary's histogram", () => {
  const lost = framestats(1, []).replace(
    "HISTOGRAM: 5ms=60 6ms=20",
    "HISTOGRAM: 5ms=0 6ms=0 101ms=1 150ms=0",
  );

  expect(frameStats(lost)).toMatchObject({ frames: 1, firstFramesMs: 101 });
  expect(frameStats(framestats(4, []).replace("5ms=60 6ms=20", "5ms=4"))).toMatchObject({
    firstFramesMs: null,
  });
});

it("censors a change that had not reached the content by the end of the window", () => {
  expect(changeTimes([], 0.3, { anywhere: [0.55, 1.07], windowEnd: 2.8 })).toEqual({
    responseMs: ">2500",
    doneMs: ">2500",
  });
  expect(changeTimes([], 0.3, { anywhere: [0.1], windowEnd: 2.8 })).toEqual({
    responseMs: null,
    doneMs: null,
  });
});

it("ranks censored values above measured ones and bounds the ratio", () => {
  const samples = [
    { run: 1, app: "base", segment: "tab up-next>library", responseMs: ">2500" },
    { run: 2, app: "base", segment: "tab up-next>library", responseMs: 900 },
    { run: 3, app: "base", segment: "tab up-next>library", responseMs: ">2400" },
    { run: 1, app: "change", segment: "tab up-next>library", responseMs: 750 },
    { run: 2, app: "change", segment: "tab up-next>library", responseMs: 700 },
    { run: 3, app: "change", segment: "tab up-next>library", responseMs: 800 },
  ];

  expect(comparison("ios", samples)).toEqual([
    "ios tab up-next>library responseMs: base >2500 (900 to >2400), change 750 (700 to 800), change/base <0.30",
  ]);
  expect(emptyMeasurements("ios", samples)).toEqual([]);
  expect(ratio(500, ">2000")).toBe(">4.00");
  expect(ratio(">1", ">2")).toBe("n/a");
});

it("counts a change the recorder dated a frame or two before the command, as 0 ms", () => {
  expect(changeTimes([0.29, 0.33], 0.31)).toEqual({ responseMs: 0, doneMs: 20 });
});
