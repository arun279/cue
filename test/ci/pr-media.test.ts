import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { changedPixels } from "../../scripts/changed-pixels.mjs";
import { fakeBin } from "../support/fake-bin";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

const jobs = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml"));
const job = jobs.find(({ name }) => name === "pr-media");
const fingerprint = jobs.find(({ name }) => name === "fingerprint");
const userFacing = new RegExp(fingerprint?.body.match(/^ {10}USER_FACING: (.+)$/m)?.[1] ?? "(?!)");

const HEAD = "abcdef1234567890";
const BASE = "bbbbbbb123456789";

const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$STATE/calls"
case "$1 $2" in
  "pr view")
    cat "$STATE/head"
    if [ -f "$STATE/next-head" ]; then mv "$STATE/next-head" "$STATE/head"; fi
    exit ;;
  "pr review") while [ "$1" != --body ]; do shift; done; printf '%s' "$2" > "$STATE/review.md"; exit ;;
esac
for arg; do
  case $prev in --jq) filter=$arg ;; --input) input=$arg ;; esac
  case $arg in repos/* | https://* | graphql) url=$arg ;; esac
  prev=$arg
done
case $url in */zip) id=\${url%/zip}; cat "$STATE/\${id##*/}.zip"; exit ;; esac
case $url in
  https://uploads.github.com/*)
    name=\${url#*name=}
    echo "$input" >> "$STATE/uploads"
    jq -n --arg name "\${name%%&*}" '{url: ("https://github.com/user-attachments/assets/" + $name)}' ;;
  */jobs*) run=\${url#*/runs/}; cat "$STATE/jobs-\${run%%/*}.json" ;;
  */runs/*/artifacts*) run=\${url#*/runs/}; cat "$STATE/artifacts-\${run%%/*}.json" ;;
  graphql) cat "$STATE/suites.json" ;;
  */actions/artifacts\\?name=*) cat "$STATE/by-name.json" ;;
  */reviews*) cat "$STATE/reviews.json" ;;
  repos/o/r) echo '{"id": 99}' ;;
esac | jq -r "$filter"
`;

type Capture = {
  clock?: number;
  content?: number;
  shift?: number;
  scroll?: number;
  empty?: boolean;
  rows?: number[];
  patch?: { top: number; rgb: number[] };
  grid?: number;
};
type Lane = {
  conclusion?: string;
  captures?: Record<string, Capture> | null;
  stale?: Record<string, Capture>;
};
type Run = Record<string, Lane>;
type Box = [number, number, number, number];

const LANES: Record<string, string> = {
  "ui-screenshots-ios-light-detail": "native-e2e-ios-light (detail)",
  "ui-screenshots-ios-light-activity": "native-e2e-ios-light (activity)",
  "ui-screenshots-ios-light-discovery": "native-e2e-ios-light (discovery)",
  "ui-screenshots-ios-dark": "ui-screenshots-ios-dark",
  "ui-screenshots-android-light-detail": "android-e2e-light (detail)",
  "ui-screenshots-android-light-activity": "android-e2e-light (activity)",
  "ui-screenshots-android-light-discovery": "android-e2e-light (discovery)",
  "ui-screenshots-android-dark": "ui-screenshots-android-dark",
};

const fill = (png: PNG, [x0, y0, x1, y1]: Box, rgb: number[]) => {
  const pixel = Buffer.from([...rgb, 255]);
  for (let y = y0; y < y1; y++) {
    png.data.fill(pixel, (y * png.width + x0) * 4, (y * png.width + x1) * 4);
  }
};

const [LEFT, TOP, RIGHT, BOTTOM] = [100, 170, 500, 230];
const COLORS = [
  [40, 40, 220],
  [220, 40, 40],
];

const encoded = new Map<string, Buffer>();
const screenshot = (file: string, width: number, capture: Capture) => {
  const key = `${width} ${JSON.stringify(capture)}`;
  const png = encoded.get(key) ?? PNG.sync.write(draw(width, capture));
  encoded.set(key, png);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, capture.empty ? "" : png);
};

const chips = (png: PNG, top: number) => {
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 6; column++) {
      const [x, y] = [60 + column * 180, top + row * 110];
      fill(png, [x, y, x + 150, y + 90], [160, 160, 155]);
      for (let glyph = 0; glyph < 3; glyph++) {
        fill(png, [x + 42 + glyph * 24, y + 30, x + 54 + glyph * 24, y + 60], [60, 60, 60]);
      }
    }
  }
};

const decorate = (png: PNG, { scroll, rows, patch, grid }: Capture) => {
  if (scroll) fill(png, [png.width - 12, 170, png.width - 4, 240], [120, 120, 120]);
  for (const row of rows ?? []) fill(png, [0, row, png.width, row + 1], [60, 60, 60]);
  if (patch) fill(png, [400, patch.top, 420, patch.top + 30], patch.rgb);
  if (grid !== undefined) chips(png, grid);
};

const draw = (width: number, capture: Capture) => {
  const { clock, content = 0, shift = 0 } = capture;
  const height = capture.rows === undefined && capture.grid === undefined ? 240 : 2622;
  const png = new PNG({ width, height });
  fill(png, [0, 0, width, height], [250, 250, 245]);
  fill(png, [100, 60, 300, 110], clock ? [0, 0, 0] : [128, 128, 128]);
  fill(png, [LEFT + shift, TOP, RIGHT + shift, BOTTOM], COLORS[content] ?? []);
  decorate(png, capture);
  return png;
};

const pixel = (file: string, x: number, y: number) => {
  const png = PNG.sync.read(readFileSync(file));
  return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
};

const PANEL = 824;
const OUTLINE = [255, 0, 0];
const IOS_RATIO = 1206 / 800;

const rgbAt = (png: PNG, x: number, y: number) => [
  ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3),
];

const strokes = (png: PNG, after: number) => {
  const stroke = new Set<number>();
  const altered: number[][] = [];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < 800; x++) {
      const shown = rgbAt(png, (after + 1) * PANEL + x, y).join();
      if (shown === OUTLINE.join()) stroke.add(y * 800 + x);
      else if (shown !== rgbAt(png, after * PANEL + x, y).join()) altered.push([x, y]);
    }
  }
  return { stroke, altered };
};

const component = (stroke: Set<number>, seen: Set<number>, start: number) => {
  const box: Box = [800, Number.MAX_SAFE_INTEGER, 0, 0];
  let pixels = 0;
  const queue = [start];
  seen.add(start);
  for (let at = queue.pop(); at !== undefined; at = queue.pop()) {
    const [x, y] = [at % 800, Math.floor(at / 800)];
    pixels++;
    box.splice(
      0,
      4,
      Math.min(box[0], x),
      Math.min(box[1], y),
      Math.max(box[2], x + 1),
      Math.max(box[3], y + 1),
    );
    const next = [at - 800, at + 800, x > 0 ? at - 1 : -1, x < 799 ? at + 1 : -1];
    for (const pixel of next.filter((n) => stroke.has(n) && !seen.has(n))) {
      seen.add(pixel);
      queue.push(pixel);
    }
  }
  return { box, pixels };
};

const changesPanel = (file: string, after: number) => {
  const { stroke, altered } = strokes(PNG.sync.read(readFileSync(file)), after);
  const seen = new Set<number>();
  const boxes = [...stroke].flatMap((at) => (seen.has(at) ? [] : [component(stroke, seen, at)]));
  return { altered, boxes };
};

const hollow = ([x0, y0, x1, y1]: Box) =>
  (x1 - x0) * (y1 - y0) - Math.max(0, x1 - x0 - 6) * Math.max(0, y1 - y0 - 6);

const changedInPanel = (before: Capture, after: Capture) => {
  const [a, b] = [draw(1206, before), draw(1206, after)];
  const changed: number[][] = [];
  for (let y = 162; y < a.height; y++) {
    for (let x = 0; x < 1206 - 18; x++) {
      if (rgbAt(a, x, y).join() !== rgbAt(b, x, y).join()) {
        changed.push([Math.floor(x / IOS_RATIO), Math.floor(y / IOS_RATIO)]);
      }
    }
  }
  return changed;
};

const within = ([x, y]: number[], boxes: { box: Box }[]) =>
  boxes.some(
    ({ box: [x0, y0, x1, y1] }) =>
      (x ?? -1) >= x0 + 3 && (x ?? -1) < x1 - 3 && (y ?? -1) >= y0 + 3 && (y ?? -1) < y1 - 3,
  );

const ghBin = fakeBin({ gh: FAKE_GH });

const sandbox = () => {
  const root = tempDirectory("pr-media-");
  const state = path.join(root, "state");
  mkdirSync(state);
  writeFileSync(path.join(state, "head"), `${HEAD}\n`);
  const run = (script: string, args: string[]) =>
    spawnSync("bash", [repositoryPath(`scripts/${script}`), ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "o/r",
        PATH: `${ghBin}:${process.env["PATH"]}`,
        STATE: state,
        TMPDIR: root,
      },
    });
  return { root, state, run };
};

const record = (root: string, state: string, id: number, lanes: Run, day: string) => {
  const artifacts: { name: string; id: number; expired: boolean; created_at: string }[] = [];
  for (const [index, [artifact, jobName]] of Object.entries(LANES).entries()) {
    const lane = { conclusion: "success", captures: {}, ...lanes[artifact] };
    if (lane.captures === null) continue;
    const width = artifact.includes("android") ? 1440 : 1206;
    const upload = (artifactId: number, captures: Record<string, Capture>, createdAt: string) => {
      for (const [name, capture] of Object.entries(captures)) {
        screenshot(
          path.join(root, `${artifactId}`, "run", "takeScreenshot", `${name}.png`),
          width,
          capture,
        );
      }
      screenshot(path.join(root, `${artifactId}`, "screenshots", `${jobName}.png`), width, {});
      spawnSync("zip", ["-qr", path.join(state, `${artifactId}.zip`), "."], {
        cwd: path.join(root, `${artifactId}`),
      });
      artifacts.push({ name: artifact, id: artifactId, expired: false, created_at: createdAt });
    };
    if (lane.stale) upload(id * 100 + index + 50, lane.stale, `${day}T00:00:00Z`);
    upload(id * 100 + index, lane.captures, `${day}T01:00:00Z`);
  }
  writeFileSync(path.join(state, `artifacts-${id}.json`), JSON.stringify({ artifacts }));
  writeFileSync(
    path.join(state, `jobs-${id}.json`),
    JSON.stringify({
      jobs: Object.entries(LANES).map(([artifact, name]) => {
        const conclusion = lanes[artifact]?.conclusion ?? "success";
        return { name: conclusion === "skipped" ? name.replace(/ \(.+\)$/, "") : name, conclusion };
      }),
    }),
  );
};

const suite = (databaseId: number, event: string, workflow: string, status = "COMPLETED") => ({
  status,
  workflowRun: {
    databaseId,
    event,
    workflow: { resourcePath: `/o/r/actions/workflows/${workflow}` },
  },
});
// Higher run ids than base's push run of CI, so picking any of them fails the run.
const OTHER_SUITES = [
  suite(3, "pull_request", "ci.yml"),
  suite(4, "push", "codeql.yml"),
  { status: "COMPLETED", workflowRun: null },
];

const attempt = (before: Run, after: Run, suites = [suite(2, "push", "ci.yml")]) => {
  const { root, state, run } = sandbox();
  record(root, state, 1, after, "2026-10-04");
  record(root, state, 2, before, "2026-10-04");
  writeFileSync(
    path.join(state, "suites.json"),
    JSON.stringify({
      data: { repository: { object: { checkSuites: { nodes: [...suites, ...OTHER_SUITES] } } } },
    }),
  );
  const out = path.join(root, "pr-media");
  return { root, out, result: run("gather-pr-media.sh", ["1", BASE, HEAD, out]) };
};

const gather = (before: Run, after: Run) => {
  const { root, out, result } = attempt(before, after);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const review = readFileSync(path.join(out, "review.md"), "utf8");
  return {
    out,
    review,
    images: readdirSync(out).filter((file) => file.endsWith(".png")),
    root,
  };
};

const dark = (captures: Record<string, Capture>, conclusion = "success"): Run => ({
  "ui-screenshots-ios-dark": { conclusion, captures },
});
const steady: Run = { "ui-screenshots-android-light-detail": { captures: { "up-next": {} } } };

describe("pr-media job", () => {
  it("waits for every screenshot job, still runs when they are skipped, and uploads instead of posting", () => {
    const body = job?.body ?? "";
    expect(body.match(/^ {6}- ([a-z0-9-]+)$/gm)?.map((line) => line.trim().slice(2))).toEqual([
      "fingerprint",
      "native-e2e-ios-light",
      "ui-screenshots-ios-dark",
      "android-e2e-light",
      "ui-screenshots-android-dark",
    ]);
    expect(body).toContain("!cancelled() && github.event_name == 'pull_request'");
    expect(body).toContain("needs.fingerprint.outputs.user-facing == 'true'");
    expect(body).toContain("fetch-depth: 2");
    expect(body).toContain(
      'scripts/gather-pr-media.sh "$GITHUB_RUN_ID" "$(scripts/measured-base.sh pull_request)"',
    );
    expect(body).toContain("name: pr-media-$" + "{{ github.event.pull_request.head.sha }}");
    expect(body).toContain("path: $" + "{{ runner.temp }}/pr-media");
    expect(body).not.toContain("pr comment");
    expect(body).not.toContain("pull-requests: write");
  });

  it("reads each screenshot artifact from the job that uploads it", () => {
    const script = readFileSync(repositoryPath("scripts/gather-pr-media.sh"), "utf8");
    const lanes = [...script.matchAll(/^ {2}"(ui-screenshots-[a-z-]+):([^"]+)"$/gm)];

    expect(Object.fromEntries(lanes.map(([, artifact, name]) => [artifact, name]))).toEqual(LANES);
    for (const [, artifact = "", name = ""] of lanes) {
      const [, id, suite] = /^([a-z0-9-]+)(?: \((.+)\))?$/.exec(name) ?? [];
      const producer = jobs.find((entry) => entry.name === id)?.body ?? "";
      const upload = suite ? artifact.replace(suite, "$" + "{{ matrix.suite }}") : artifact;
      expect(producer).toContain(`name: ${upload}\${{ inputs.copy }}\n`);
      if (suite) expect(producer).toMatch(new RegExp(`suite: \\[.*\\b${suite}\\b.*\\]`));
    }
  });

  it("pairs every large-text capture with a default-size capture of the same screen", () => {
    const read = (flow: string) => readFileSync(repositoryPath(`.maestro/${flow}`), "utf8");
    const screens = [
      ...read("flows/large-text.yaml").matchAll(/takeScreenshot: (.+)-\$\{SIZE\}$/gm),
    ];
    const sizes = [...read("ci/screenshots.yaml").matchAll(/^ {6}SIZE: (.+)$/gm)];
    const traversal = read("flows/dark-traversal.yaml");

    expect(screens.map(([, screen]) => screen)).toEqual([
      "library-shows",
      "profile-rest",
      "search-empty",
    ]);
    for (const [, screen] of screens) expect(traversal).toContain(`takeScreenshot: ${screen}\n`);
    expect(sizes.map(([, size]) => size)).toEqual(["xxxl", "ax5"]);
  });

  it.each([
    "packages/native/src/ui/tokens.ts",
    "packages/native/app/(tabs)/index.tsx",
    "packages/core/src/sync-contract.ts",
    ".maestro/flows/large-text.yaml",
    "scripts/mock-trakt/seed.mjs",
    "scripts/gather-pr-media.sh",
    "scripts/compare-screenshots.mjs",
    "scripts/changed-pixels.mjs",
    "scripts/attach-pr-media.sh",
    "packages/native/entry.ts",
    "packages/native/babel.config.js",
    "packages/native/metro.config.js",
    "packages/native/assets/splash.png",
    "patches/@expo__metro-config@57.0.13.patch",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "scripts/start-ready-process.mjs",
    "scripts/download-ci-artifact.sh",
    "scripts/bundle-ios.sh",
    "scripts/reembed-ios.sh",
    "scripts/compile-hermes.sh",
    "scripts/prepare-ios-ui.sh",
    "scripts/wait-ios-ready.mjs",
    "scripts/wait-ios-accessibility.mjs",
    "scripts/enable-ios-accessibility.sh",
    "scripts/maestro-test.sh",
    "scripts/maestro-supervisor.mjs",
    "scripts/maestro-failure.mjs",
    "scripts/maestro-runner.mjs",
    "scripts/simulator-touch.mjs",
    "scripts/tap-proxy.mjs",
    "scripts/build-maestro-runner.sh",
    "scripts/check-runner-survives-freeze.sh",
    "scripts/check-tap-lead-in.mjs",
    "scripts/disable-ios-daemons.sh",
    "scripts/snapshot-host-resources.sh",
    "patches/maestro-runner/0001-keep-serving-after-xctest-issues.patch",
  ])("gathers media when %s changes", (file) => {
    expect(userFacing.test(file)).toBe(true);
  });

  it.each([
    "packages/native/__tests__/screen.test.tsx",
    "packages/native/app.config.ts",
    "packages/core/test/sync.test.ts",
    "test/ci/pr-media.test.ts",
    "README.md",
    "packages/native/entry.test.ts",
    "packages/native/assets.json",
    "pnpm-lock.yaml.orig",
    ".github/workflows/codeql.yml",
    "scripts/maestro-test.sh.bak",
    "scripts/native-e2e-rollup.mjs",
  ])("gathers nothing when only %s changes", (file) => {
    expect(userFacing.test(file)).toBe(false);
  });
});

describe("gather-pr-media.sh", { timeout: 30_000 }, () => {
  it.each([0, 1])("compares a capture moved between light shards with content %s", (content) => {
    const { review, images } = gather(
      { "ui-screenshots-ios-light-detail": { captures: { "show-detail-rest": {} } } },
      { "ui-screenshots-ios-light-activity": { captures: { "show-detail-rest": { content } } } },
    );

    expect(review).toContain("1 screen compared.");
    expect(review).not.toMatch(/New:|Removed screens:/);
    expect(images).toEqual(content === 0 ? [] : ["ios-light-show-detail-rest.png"]);
    if (content === 1) {
      expect(review).toContain("**Changed: Show detail rest, iOS, light, default text.");
      expect(review).toContain("Left to right: before, after, changes.");
    }
  });

  it.each([
    "ui-screenshots-ios-dark",
    "ui-screenshots-android-light-activity",
  ])("keeps captures from %s separate when light shards move", (artifact) => {
    const { review } = gather(
      { [artifact]: { captures: { "show-detail-rest": {} } } },
      { "ui-screenshots-ios-light-activity": { captures: { "show-detail-rest": {} } } },
    );
    expect(review).toContain("0 screens compared.");
    expect(review).toContain("**New: Show detail rest, iOS, light, default text.");
  });

  it.each([
    "ui-screenshots-ios-dark",
    "ui-screenshots-android-light-activity",
  ])("lists a light-shard capture as removed when only %s still has it", (artifact) => {
    const { review } = gather(
      { "ui-screenshots-ios-light-detail": { captures: { "show-detail-rest": {} } } },
      { [artifact]: { captures: { "show-detail-rest": {} } } },
    );
    expect(review).toContain("Removed screens:\n\n- Show detail rest, iOS, light, default text");
  });

  it("reports a skipped base sibling shard without calling moved captures new", () => {
    const { review, images } = gather(
      { ...steady, "ui-screenshots-ios-light-detail": { conclusion: "skipped", captures: null } },
      { ...steady, "ui-screenshots-ios-light-activity": { captures: { "show-detail-rest": {} } } },
    );
    expect(images).toEqual([]);
    expect(review).toContain("Not compared:");
    expect(review).not.toContain("New:");
  });

  it("reports a failed head sibling shard without calling moved captures removed", () => {
    const { review } = gather(
      { ...steady, "ui-screenshots-ios-light-detail": { captures: { "show-detail-rest": {} } } },
      { ...steady, "ui-screenshots-ios-light-activity": { conclusion: "failure", captures: null } },
    );
    expect(review).toContain("Not compared:");
    expect(review).not.toContain("Removed screens:");
  });

  it("says in one line that nothing changed when only the clock and scroll indicator moved", () => {
    const { review, images } = gather(
      {
        ...dark({ "library-shows": {} }),
        "ui-screenshots-android-light-activity": { captures: { "up-next": {} } },
      },
      {
        ...dark({ "library-shows": { clock: 1, scroll: 1 } }),
        "ui-screenshots-android-light-activity": {
          captures: { "up-next": { clock: 1, scroll: 1 } },
        },
      },
    );

    expect(images).toEqual([]);
    expect(review).toBe(
      "<!-- media-review -->\n\nNo screen changed between base `bbbbbbb` and head `abcdef1`; 2 screens compared.\n",
    );
  });

  it("shows the after screen unchanged in the changes column apart from one box per separate change", () => {
    const before = { content: 0 };
    const after = { content: 1, shift: 500, clock: 1 };
    const { out, review, images } = gather(
      dark({ "library-shows": before }),
      dark({ "library-shows": after }),
    );

    expect(images).toEqual(["ios-dark-library-shows.png"]);
    const file = path.join(out, images[0] ?? "");
    const image = PNG.sync.read(readFileSync(file));
    expect([image.width, image.height]).toEqual([2448, 159]);
    expect(pixel(file, 200, 133)).toEqual(COLORS[0]);
    expect(pixel(file, PANEL + 500, 133)).toEqual(COLORS[1]);
    expect(pixel(file, 100, 50)).toEqual([128, 128, 128]);
    expect(pixel(file, PANEL + 100, 50)).toEqual([0, 0, 0]);
    const { altered, boxes } = changesPanel(file, 1);
    expect(altered).toEqual([]);
    expect(boxes).toHaveLength(2);
    for (const { box, pixels } of boxes) expect(pixels).toBe(hollow(box));
    const changed = changedInPanel(before, after);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.filter((point) => !within(point, boxes))).toEqual([]);
    expect(review).toContain(
      "**Changed: Library shows, iOS, dark, default text.** Left to right: before, after, changes.\n\n" +
        "![Library shows, iOS, dark, default text](ios-dark-library-shows.png)\n\n" +
        "Verdict: VERDICT_PENDING",
    );
    expect(review).toContain(
      "The changes panel is the after screen with a red box around each changed area",
    );
    expect(review).not.toContain("Not compared");
  });

  it("draws one box around changes closer together than the gap between controls", () => {
    const { out, images } = gather(
      dark({ "up-next-queue-rest": { rows: [] } }),
      dark({ "up-next-queue-rest": { rows: [1000, 1010] } }),
    );

    const { altered, boxes } = changesPanel(path.join(out, images[0] ?? ""), 1);
    expect(altered).toEqual([]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.pixels).toBe(hollow(boxes[0]?.box ?? [0, 0, 0, 0]));
  });

  it("draws one box around a block of controls that moved down a row", () => {
    const before = { grid: 1100 };
    const after = { grid: 1176 };
    const { out, images } = gather(
      dark({ "history-jump": before }),
      dark({ "history-jump": after }),
    );

    const { altered, boxes } = changesPanel(path.join(out, images[0] ?? ""), 1);
    expect(altered).toEqual([]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.pixels).toBe(hollow(boxes[0]?.box ?? [0, 0, 0, 0]));
    expect(changedInPanel(before, after).filter((point) => !within(point, boxes))).toEqual([]);
  });

  it("names the missing base captures and why instead of calling their screens new", () => {
    const { review, images } = gather(
      { ...steady, "ui-screenshots-android-dark": { conclusion: "skipped", captures: null } },
      { ...steady, "ui-screenshots-android-dark": { captures: { "calendar-rest": {} } } },
    );

    expect(images).toEqual([]);
    expect(review).toContain(
      "No compared screen changed between base `bbbbbbb` and head `abcdef1`",
    );
    expect(review).toContain(
      "- Before captures for Android dark are missing because the ui-screenshots-android-dark job was skipped in [run 2](https://github.com/o/r/actions/runs/2).",
    );
  });

  it("names a skipped matrix lane, which GitHub reports without its suite", () => {
    const { review } = gather(steady, {
      ...steady,
      "ui-screenshots-ios-light-detail": { conclusion: "skipped", captures: null },
    });

    expect(review).toContain(
      "- After captures for iOS light (detail flows) are missing because the native-e2e-ios-light (detail) job was skipped in [run 1](https://github.com/o/r/actions/runs/1).",
    );
  });

  it("stops without a review when base has no push run of CI", () => {
    const { out, result } = attempt(
      dark({ "library-shows": {} }),
      dark({ "library-shows": {} }),
      [],
    );

    expect(result.stderr).toBe(
      "No push run of CI exists for base bbbbbbb, so head's screens have nothing to be compared with.\n",
    );
    expect(result.status).toBe(1);
    expect(existsSync(path.join(out, "review.md"))).toBe(false);
  });

  it("stops without a review and asks for a re-run while base's push run of CI is unfinished", () => {
    const { out, result } = attempt(dark({ "library-shows": {} }), dark({ "library-shows": {} }), [
      suite(2, "push", "ci.yml", "IN_PROGRESS"),
    ]);

    expect(result.stderr).toBe(
      "Base CI not finished: push run https://github.com/o/r/actions/runs/2 for base bbbbbbb is IN_PROGRESS. Re-run pr-media after it completes.\n",
    );
    expect(result.status).toBe(1);
    expect(existsSync(path.join(out, "review.md"))).toBe(false);
  });

  it("stops without a review when no screen could be compared", () => {
    const { out, result } = attempt(
      { "ui-screenshots-ios-dark": { conclusion: "skipped", captures: null } },
      dark({ "library-shows": {} }),
    );

    expect(result.stderr).toContain(
      "No screen was compared, added or removed between base `bbbbbbb` and head `abcdef1`.\n- Before captures for iOS dark",
    );
    expect(result.status).toBe(1);
    expect(existsSync(path.join(out, "review.md"))).toBe(false);
  });

  it("reads the newest artifact when a retried job uploaded the same name twice", () => {
    const { review, images } = gather(dark({ "library-shows": {} }), {
      "ui-screenshots-ios-dark": {
        captures: { "library-shows": {} },
        stale: { "library-shows": { content: 1 } },
      },
    });

    expect(images).toEqual([]);
    expect(review).toContain("No screen changed between base `bbbbbbb` and head `abcdef1`");
  });

  it("names a capture it cannot read instead of failing", () => {
    const { review, images } = gather(
      dark({ "onboarding-ready": { empty: true }, "library-shows": {} }),
      dark({ "onboarding-ready": {}, "library-shows": { content: 1 } }),
    );

    expect(images).toEqual(["ios-dark-library-shows.png"]);
    expect(review).toContain(
      "- The before capture of Onboarding ready, iOS, dark, default text could not be read as a PNG.",
    );
  });

  it("shows a new screen as after only", () => {
    const { out, review, images } = gather(dark({}), dark({ "profile-rest": {} }));

    expect(images).toEqual(["ios-dark-profile-rest.png"]);
    expect(PNG.sync.read(readFileSync(path.join(out, images[0] ?? ""))).width).toBe(800);
    expect(review).toContain(
      "**New: Profile rest, iOS, dark, default text.** Left to right: after.",
    );
  });

  it("lists removed screens in text", () => {
    const { review, images } = gather(dark({ "settings-rest": {} }), dark({}));

    expect(images).toEqual([]);
    expect(review).toContain("Removed screens:\n\n- Settings rest, iOS, dark, default text\n");
  });

  it("does not list removed screens when the head lane failed before capturing them", () => {
    const { review } = gather(
      { ...steady, ...dark({ "settings-rest": {} }) },
      { ...steady, ...dark({}, "failure") },
    );

    expect(review).not.toContain("Removed");
    expect(review).toContain(
      "- After captures for iOS dark may be incomplete because the ui-screenshots-ios-dark job failed in [run 1](https://github.com/o/r/actions/runs/1).",
    );
  });

  it("shows a large-text capture only when it changed, beside its default-size pair", () => {
    const { out, review, images } = gather(
      dark({ "library-shows": {}, "library-shows-xxxl": {}, "search-empty-ax5": {} }),
      dark({ "library-shows": {}, "library-shows-xxxl": { content: 1 }, "search-empty-ax5": {} }),
    );

    expect(images).toEqual(["ios-dark-library-shows-xxxl.png"]);
    const file = path.join(out, images[0] ?? "");
    expect(PNG.sync.read(readFileSync(file)).width).toBe(3272);
    expect(pixel(file, 200, 133)).toEqual(COLORS[0]);
    expect(pixel(file, 824 + 200, 133)).toEqual(COLORS[0]);
    expect(pixel(file, 1648 + 200, 133)).toEqual(COLORS[1]);
    expect(changesPanel(file, 2).altered).toEqual([]);
    expect(changesPanel(file, 2).boxes).toHaveLength(1);
    expect(review).toContain(
      "**Changed: Library shows, iOS, dark, XXXL text.** Left to right: default text after, before, after, changes.",
    );
  });
});

describe("changed-pixels.mjs", () => {
  const compare = (platform: string, before: Capture, after: Capture) => {
    const width = platform === "Android" ? 1440 : 1206;
    return changedPixels(draw(width, before), draw(width, after), platform) !== undefined;
  };

  it("ignores the top edge of the iOS tab bar's glass", () => {
    expect(compare("iOS", { rows: [] }, { rows: [2373, 2384] })).toBe(false);
  });

  it.each([
    ["the content above the iOS tab bar", "iOS", 2372],
    ["the iOS tab items", "iOS", 2385],
    ["Android at the same rows", "Android", 2373],
  ])("still compares %s", (_, platform, row) => {
    expect(compare(platform, { rows: [] }, { rows: [row] })).toBe(true);
  });

  const GLASS = [39, 35, 32];
  it.each([
    ["is ignored in the iOS tab bar's glass", "iOS", 2400, [71, 62, 51], false],
    ["still counts above the iOS tab bar", "iOS", 2300, [71, 62, 51], true],
    ["still counts on Android", "Android", 2400, [71, 62, 51], true],
    ["leaves a changed iOS tab icon or label flagged", "iOS", 2400, [235, 235, 235], true],
  ])("translucency difference %s", (_, platform, top, rgb, changed) => {
    const glass = { rows: [], patch: { top, rgb: GLASS } };
    expect(compare(platform, glass, { ...glass, patch: { top, rgb } })).toBe(changed);
  });
});

describe("attach-pr-media.sh", { timeout: 30_000 }, () => {
  let artifact: Buffer;
  beforeAll(() => {
    const { out } = gather(
      dark({ "library-shows": {}, "settings-rest": {} }),
      dark({ "library-shows": { content: 1 }, "settings-rest": { content: 1 } }),
    );
    artifact = spawnSync("zip", ["-qr", "-", "."], { cwd: out }).stdout;
  });

  const prepare = () => {
    const { root, state, run } = sandbox();
    writeFileSync(path.join(state, "30.zip"), artifact);
    writeFileSync(path.join(state, "reviews.json"), "[]");
    writeFileSync(
      path.join(state, "by-name.json"),
      JSON.stringify({
        artifacts: [
          { id: 20, expired: false, created_at: "2026-10-01T00:00:00Z" },
          { id: 30, expired: false, created_at: "2026-10-03T00:00:00Z" },
          { id: 40, expired: true, created_at: "2026-10-04T00:00:00Z" },
        ],
      }),
    );
    const read = (name: string) =>
      existsSync(path.join(state, name)) ? readFileSync(path.join(state, name), "utf8") : "";
    const directory = path.join(root, "pr-media-7-abcdef1");
    const attach = () => {
      const result = run("attach-pr-media.sh", ["7"]);
      return {
        ...result,
        calls: read("calls"),
        uploads: read("uploads"),
        posted: read("review.md"),
      };
    };
    const decide = () => {
      const file = path.join(directory, "review.md");
      writeFileSync(file, readFileSync(file, "utf8").replaceAll("VERDICT_PENDING", "Intended."));
    };
    return { state, directory, attach, decide };
  };

  it("prints each image from the newest artifact and refuses to post while a verdict is pending", () => {
    const { directory, attach } = prepare();
    const first = attach();

    expect(first.calls).toContain("api repos/o/r/actions/artifacts/30/zip");
    expect(first.stdout.trim().split("\n")).toEqual([
      path.join(directory, "ios-dark-library-shows.png"),
      path.join(directory, "ios-dark-settings-rest.png"),
    ]);
    for (const file of first.stdout.trim().split("\n")) expect(existsSync(file)).toBe(true);
    expect(first.status).toBe(1);
    expect(first.stderr).toContain(
      `replace all 2 VERDICT_PENDING placeholders in ${directory}/review.md`,
    );
    expect(first.uploads).toBe("");
    expect(first.calls).not.toContain("pr review");
  });

  it("uploads every image and posts one review that embeds them once each verdict is filled", () => {
    const { directory, attach, decide } = prepare();
    attach();
    decide();
    const posted = attach();

    expect(posted.stderr).toBe("");
    expect(posted.status).toBe(0);
    expect(posted.calls.match(/api repos\/o\/r\/actions\/artifacts\/30\/zip/g)).toHaveLength(1);
    expect(posted.uploads.trim().split("\n")).toEqual([
      path.join(directory, "ios-dark-library-shows.png"),
      path.join(directory, "ios-dark-settings-rest.png"),
    ]);
    expect(posted.calls).toContain("repository_id=99");
    expect(posted.calls).toContain("pr review 7 -R o/r --comment --body <!-- media-review -->");
    expect(posted.posted.startsWith("<!-- media-review -->\n")).toBe(true);
    expect(posted.posted).toContain(
      "![Library shows, iOS, dark, default text](https://github.com/user-attachments/assets/ios-dark-library-shows.png)",
    );
    expect(posted.posted).not.toContain("](ios-");
    expect(posted.posted).toContain("Verdict: Intended.");
  });

  it.each([
    ["another review on the head commit", HEAD, "Looks good."],
    ["a media review on an earlier commit", BASE, "<!-- media-review -->\n\nOld."],
  ])("still posts when the pull request only has %s", (_, commit, body) => {
    const { state, attach, decide } = prepare();
    writeFileSync(
      path.join(state, "reviews.json"),
      JSON.stringify([{ commit_id: commit, body, html_url: "https://github.com/o/r/pull/7#r1" }]),
    );
    attach();
    decide();
    const posted = attach();

    expect(posted.status).toBe(0);
    expect(posted.calls).toContain("pr review 7 -R o/r --comment");
  });

  it("posts nothing when a media review is already on the head commit", () => {
    const { state, attach } = prepare();
    writeFileSync(
      path.join(state, "reviews.json"),
      JSON.stringify([
        {
          commit_id: HEAD,
          body: "<!-- media-review -->\n\nDone.",
          html_url: "https://github.com/o/r/pull/7#r2",
        },
      ]),
    );
    const again = attach();

    expect(again.status).toBe(0);
    expect(again.stderr).toBe(
      "A media review is already posted on abcdef1: https://github.com/o/r/pull/7#r2\n",
    );
    expect(again.calls).not.toContain("artifacts/30/zip");
    expect(again.uploads).toBe("");
    expect(again.calls).not.toContain("pr review");
  });

  it("refuses to post once the pull request moved to another commit", () => {
    const { state, attach, decide } = prepare();
    attach();
    decide();
    writeFileSync(path.join(state, "next-head"), "fedcba9876543210\n");
    const moved = attach();

    expect(moved.status).toBe(1);
    expect(moved.stderr).toContain("The pull request moved past abcdef1.");
    expect(moved.uploads).toBe("");
    expect(moved.calls).not.toContain("pr review");
  });
});
