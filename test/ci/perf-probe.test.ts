import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import {
  collectionMoviesBody,
  collectionShowsBody,
  createSeedLibrary,
  historyRows,
  watchedShowsBody,
  watchlistBody,
} from "../../scripts/mock-trakt/seed.mjs";
import {
  coldStartOf,
  createChannel,
  frameStats,
  hitches,
  memInfo,
  overdrawShares,
  PASS,
  settleMs,
  simulatorRss,
  summary,
  swapMs,
  viewCensus,
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
    firstLayoutMs: null,
  });
});

it("reports a missing gfxinfo field as unknown rather than zero", () => {
  expect(frameStats("No process found for: app.cuetracker").frames).toBeNull();
});

it("takes the slowest of the first three reliable frames after a reset, and its layout", () => {
  const rows = [
    frame(0, 1032, 1, 9),
    frame(0, 1000, 2, 12),
    frame(1, 1010, 30, 90),
    frame(0, 1016, 18, 48.5),
    frame(0, 1048, 40, 80),
  ];

  expect(frameStats(framestats(5, rows))).toMatchObject({ firstFramesMs: 48.5, firstLayoutMs: 18 });
});

it("leaves the first frames unknown once the 120-frame window has dropped them", () => {
  expect(frameStats(framestats(121, [frame(0, 1000, 2, 12)]))).toMatchObject({
    firstFramesMs: null,
    firstLayoutMs: null,
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

it("times a tab switch from the tab bar's first change to the content's next change", () => {
  expect(swapMs([1.2, 1.25, 1.6], [0.4, 1.41, 1.5])).toBe(210);
  expect(swapMs([], [1])).toBeNull();
  expect(swapMs([1.2], [0.9])).toBeNull();
});

it("times a section opening from its first visible change to its last", () => {
  expect(settleMs([2.1, 2.2, 2.45])).toBe(350);
  expect(settleMs([])).toBeNull();
});

it("counts frames held past two refreshes while moving, and not the rests between flings", () => {
  const steady = Array.from({ length: 30 }, (_, index) => index / 60);
  const stalled = [...steady, 0.5 + 0.1, 0.5 + 0.1 + 1 / 60];
  const rested = [...steady, 3, 3 + 1 / 60];

  expect(hitches(steady)).toEqual({ movingFrames: 29, hitches: 0, longestHitchMs: 0 });
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

it("serves the probe's synthetic account at the scale of a long-time Trakt user", () => {
  const library = createSeedLibrary("scale");
  const origin = "http://mock";
  const watched: { plays: number; last_watched_at: string; show: { aired_episodes: number } }[] =
    watchedShowsBody(library, "full");
  const lapsedCutoff = library.now - 21 * 86_400_000;
  const unfinished = watched.filter((entry) => entry.plays < entry.show.aired_episodes);
  const lapsed = unfinished.filter((entry) => Date.parse(entry.last_watched_at) < lapsedCutoff);
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
    expect.objectContaining({ show: expect.objectContaining({ images: { poster: [] } }) }),
  );
  expect(history).toContainEqual(
    expect.objectContaining({
      movie: expect.objectContaining({ images: { poster: [], fanart: [] } }),
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

  const first = channel.next("ready");
  await launched;
  const reply = channel.send("tab library");
  expect(await first).toBe("tab library");
  void channel.next("ran tab");
  expect(await reply).toBe("ran tab");

  const relaunched = channel.ready();
  const third = channel.next("ready");
  await relaunched;
  const lapsed = channel.send("lapsed");
  expect(await third).toBe("lapsed");
  void channel.next("unknown lapsed");
  expect(await lapsed).toBe("unknown lapsed");
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
