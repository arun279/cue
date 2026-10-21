import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { changedPixels } from "../../scripts/changed-pixels.mjs";
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
  case $arg in repos/* | https://*) url=$arg ;; esac
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
  */workflows/ci.yml/runs*) cat "$STATE/runs.json" ;;
  */actions/artifacts\\?name=*) cat "$STATE/by-name.json" ;;
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

const draw = (width: number, { clock, content = 0, shift = 0, scroll, rows, patch }: Capture) => {
  const height = rows === undefined ? 240 : 2622;
  const png = new PNG({ width, height });
  fill(png, [0, 0, width, height], [250, 250, 245]);
  fill(png, [100, 60, 300, 110], clock ? [0, 0, 0] : [128, 128, 128]);
  fill(png, [LEFT + shift, TOP, RIGHT + shift, BOTTOM], COLORS[content] ?? []);
  if (scroll) fill(png, [width - 12, 170, width - 4, 240], [120, 120, 120]);
  for (const row of rows ?? []) fill(png, [0, row, width, row + 1], [60, 60, 60]);
  if (patch) fill(png, [400, patch.top, 420, patch.top + 30], patch.rgb);
  return png;
};

const pixel = (file: string, x: number, y: number) => {
  const png = PNG.sync.read(readFileSync(file));
  return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
};

const sandbox = () => {
  const root = tempDirectory("pr-media-");
  const state = path.join(root, "state");
  const bin = path.join(root, "bin");
  mkdirSync(state);
  mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), FAKE_GH);
  chmodSync(path.join(bin, "gh"), 0o755);
  writeFileSync(path.join(state, "head"), `${HEAD}\n`);
  const run = (script: string, args: string[]) =>
    spawnSync("bash", [repositoryPath(`scripts/${script}`), ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "o/r",
        PATH: `${bin}:${process.env["PATH"]}`,
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

const gather = (before: Run | undefined, after: Run) => {
  const { root, state, run } = sandbox();
  record(root, state, 1, after, "2026-10-04");
  if (before) record(root, state, 2, before, "2026-10-04");
  writeFileSync(
    path.join(state, "runs.json"),
    JSON.stringify({ workflow_runs: before ? [{ id: 2 }] : [] }),
  );
  const out = path.join(root, "pr-media");
  const result = run("gather-pr-media.sh", ["1", BASE, HEAD, out]);
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
      { "ui-screenshots-ios-light-detail": { conclusion: "skipped", captures: null } },
      { "ui-screenshots-ios-light-activity": { captures: { "show-detail-rest": {} } } },
    );
    expect(images).toEqual([]);
    expect(review).toContain("Not compared:");
    expect(review).not.toContain("New:");
  });

  it("reports a failed head sibling shard without calling moved captures removed", () => {
    const { review } = gather(
      { "ui-screenshots-ios-light-detail": { captures: { "show-detail-rest": {} } } },
      { "ui-screenshots-ios-light-activity": { conclusion: "failure", captures: null } },
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

  it("shows clean before and after columns with moved content highlighted only in the changes column", () => {
    const { out, review, images } = gather(
      dark({ "library-shows": { content: 0 } }),
      dark({ "library-shows": { content: 1, shift: 500, clock: 1 } }),
    );

    expect(images).toEqual(["ios-dark-library-shows.png"]);
    const image = PNG.sync.read(readFileSync(path.join(out, images[0] ?? "")));
    expect([image.width, image.height]).toEqual([2448, 159]);
    const file = path.join(out, images[0] ?? "");
    expect(pixel(file, 200, 133)).toEqual(COLORS[0]);
    expect(pixel(file, 500, 133)).toEqual([250, 250, 245]);
    expect(pixel(file, 824 + 200, 133)).toEqual([250, 250, 245]);
    expect(pixel(file, 824 + 500, 133)).toEqual(COLORS[1]);
    expect(pixel(file, 1648 + 200, 133)).toEqual([255, 0, 255]);
    expect(pixel(file, 1648 + 500, 133)).toEqual([255, 0, 255]);
    expect(pixel(file, 1648 + 50, 133)).toEqual([125, 125, 122]);
    expect(pixel(file, 100, 50)).toEqual([128, 128, 128]);
    expect(pixel(file, 824 + 100, 50)).toEqual([0, 0, 0]);
    expect(pixel(file, 1648 + 100, 50)).toEqual([0, 0, 0]);
    expect(review).toContain(
      "**Changed: Library shows, iOS, dark, default text.** Left to right: before, after, changes.\n\n" +
        "![Library shows, iOS, dark, default text](ios-dark-library-shows.png)\n\n" +
        "Verdict: VERDICT_PENDING",
    );
    expect(review).toContain(
      "The changes panel dims the after screen and marks changed pixels in magenta",
    );
    expect(review).not.toContain("Not compared");
  });

  it("names the missing base captures and why instead of calling their screens new", () => {
    const skipped: Run = {
      "ui-screenshots-android-dark": { conclusion: "skipped", captures: null },
    };
    const { review, images } = gather(skipped, {
      "ui-screenshots-android-dark": { captures: { "calendar-rest": {} } },
    });

    expect(images).toEqual([]);
    expect(review).toContain(
      "No compared screen changed between base `bbbbbbb` and head `abcdef1`",
    );
    expect(review).toContain(
      "- Before captures for Android dark are missing because the ui-screenshots-android-dark job was skipped in [run 2](https://github.com/o/r/actions/runs/2).",
    );
  });

  it("names a skipped matrix lane, which GitHub reports without its suite", () => {
    const { review } = gather(
      {},
      { "ui-screenshots-ios-light-detail": { conclusion: "skipped", captures: null } },
    );

    expect(review).toContain(
      "- After captures for iOS light (detail flows) are missing because the native-e2e-ios-light (detail) job was skipped in [run 1](https://github.com/o/r/actions/runs/1).",
    );
  });

  it("names the base commit when it has no push run", () => {
    const { review, images } = gather(undefined, dark({ "library-shows": {} }));

    expect(images).toEqual([]);
    expect(review).toContain(
      "- Before captures for iOS light (detail flows) are missing because no push run of CI exists for base bbbbbbb.",
    );
    expect(review.match(/^- Before captures/gm)).toHaveLength(8);
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
    const { review } = gather(dark({ "settings-rest": {} }), dark({}, "failure"));

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
    expect(pixel(file, 2472 + 200, 133)).toEqual([255, 0, 255]);
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
