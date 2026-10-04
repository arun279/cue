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
import { describe, expect, it } from "vitest";
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

type Capture = { clock?: number; content?: number; scroll?: number };
type Lane = { conclusion?: string; captures?: Record<string, Capture> | null };
type Run = Record<string, Lane>;

const LANES: Record<string, string> = {
  "ui-screenshots-ios-light-detail": "native-e2e-ios-light (detail)",
  "ui-screenshots-ios-light-activity": "native-e2e-ios-light (activity)",
  "ui-screenshots-ios-light-discovery": "native-e2e-ios-light (discovery)",
  "ui-screenshots-ios-dark": "ui-screenshots-ios-dark",
  "ui-screenshots-android-light": "android-e2e",
  "ui-screenshots-android-dark": "ui-screenshots-android-dark",
};

const fill = (png: PNG, [x0, y0, x1, y1]: number[], rgb: number[]) => {
  for (let y = y0 ?? 0; y < (y1 ?? 0); y++) {
    for (let x = x0 ?? 0; x < (x1 ?? 0); x++) {
      png.data.set([...rgb, 255], (y * png.width + x) * 4);
    }
  }
};

const CONTENT = [100, 170, 500, 230];
const COLORS = [
  [40, 40, 220],
  [220, 40, 40],
];

const screenshot = (
  file: string,
  width: number,
  { clock = 0, content = 0, scroll = 0 }: Capture,
) => {
  const png = new PNG({ width, height: 240 });
  fill(png, [0, 0, width, 240], [250, 250, 245]);
  fill(png, [100, 60, 300, 110], clock ? [0, 0, 0] : [128, 128, 128]);
  fill(png, CONTENT, COLORS[content] ?? []);
  if (scroll) fill(png, [width - 12, 170, width - 4, 240], [120, 120, 120]);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, PNG.sync.write(png));
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

const record = (root: string, state: string, id: number, lanes: Run) => {
  const artifacts = [];
  for (const [index, [artifact, jobName]] of Object.entries(LANES).entries()) {
    const lane = { conclusion: "success", captures: {}, ...lanes[artifact] };
    if (lane.captures === null) continue;
    const artifactId = id * 100 + index;
    const width = artifact.includes("android") ? 1440 : 1206;
    for (const [name, capture] of Object.entries(lane.captures)) {
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
    artifacts.push({ name: artifact, id: artifactId, expired: false });
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
  record(root, state, 1, after);
  if (before) record(root, state, 2, before);
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
    expect(job?.body.match(/^ {6}- ([a-z0-9-]+)$/gm)?.map((line) => line.trim().slice(2))).toEqual([
      "fingerprint",
      "native-e2e-ios-light",
      "ui-screenshots-ios-dark",
      "android-e2e",
      "ui-screenshots-android-dark",
    ]);
    expect(job?.body).toContain("!cancelled() && github.event_name == 'pull_request'");
    expect(job?.body).toContain("needs.fingerprint.outputs.user-facing == 'true'");
    expect(job?.body).toContain("fetch-depth: 2");
    expect(job?.body).toContain(
      'scripts/gather-pr-media.sh "$GITHUB_RUN_ID" "$(scripts/measured-base.sh pull_request)"',
    );
    expect(job?.body).toContain("name: pr-media-$" + "{{ github.event.pull_request.head.sha }}");
    expect(job?.body).toContain("path: $" + "{{ runner.temp }}/pr-media");
    expect(job?.body).not.toContain("pr comment");
    expect(job?.body).not.toContain("pull-requests: write");
  });

  it("reads each screenshot artifact from the job that uploads it", () => {
    const script = readFileSync(repositoryPath("scripts/gather-pr-media.sh"), "utf8");
    const lanes = [...script.matchAll(/^ {2}"(ui-screenshots-[a-z-]+):([^"]+)"$/gm)];

    expect(Object.fromEntries(lanes.map(([, artifact, name]) => [artifact, name]))).toEqual(LANES);
    for (const [, artifact = "", name = ""] of lanes) {
      const [, id, suite] = /^([a-z0-9-]+)(?: \((.+)\))?$/.exec(name) ?? [];
      const producer = jobs.find((entry) => entry.name === id)?.body ?? "";
      const upload = suite ? artifact.replace(suite, "$" + "{{ matrix.suite }}") : artifact;
      expect(producer).toContain(`name: ${upload}\n`);
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
    "scripts/attach-pr-media.sh",
  ])("gathers media when %s changes", (file) => {
    expect(userFacing.test(file)).toBe(true);
  });

  it.each([
    "packages/native/__tests__/screen.test.tsx",
    "packages/native/app.config.ts",
    "packages/core/test/sync.test.ts",
    "test/ci/pr-media.test.ts",
    "README.md",
  ])("gathers nothing when only %s changes", (file) => {
    expect(userFacing.test(file)).toBe(false);
  });
});

describe("gather-pr-media.sh", { timeout: 30_000 }, () => {
  it("says in one line that nothing changed when only the clock and scroll indicator moved", () => {
    const { review, images } = gather(
      {
        ...dark({ "library-shows": {} }),
        "ui-screenshots-android-light": { captures: { "up-next": {} } },
      },
      {
        ...dark({ "library-shows": { clock: 1 } }),
        "ui-screenshots-android-light": { captures: { "up-next": { clock: 1, scroll: 1 } } },
      },
    );

    expect(images).toEqual([]);
    expect(review).toBe(
      "<!-- media-review -->\n\nNo screen changed between base `bbbbbbb` and head `abcdef1`; 2 screens compared.\n",
    );
  });

  it("puts a changed screen before and after in one image with the change tinted and a verdict to fill", () => {
    const { out, review, images } = gather(
      dark({ "library-shows": { content: 0 } }),
      dark({ "library-shows": { content: 1 } }),
    );

    expect(images).toEqual(["ios-dark-library-shows.png"]);
    const image = PNG.sync.read(readFileSync(path.join(out, images[0] ?? "")));
    expect([image.width, image.height]).toEqual([1624, 159]);
    expect(pixel(path.join(out, images[0] ?? ""), 200, 133)).toEqual(COLORS[0]);
    expect(pixel(path.join(out, images[0] ?? ""), 824 + 200, 133)).toEqual([237, 20, 147]);
    expect(review).toContain(
      "**Changed: Library shows, iOS, dark, default text.** Left to right: before, after.\n\n" +
        "![Library shows, iOS, dark, default text](ios-dark-library-shows.png)\n\n" +
        "Verdict: VERDICT_PENDING",
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
    expect(review.match(/^- Before captures/gm)).toHaveLength(6);
  });

  it("shows a new screen as after only", () => {
    const { out, review, images } = gather(dark({}), dark({ "profile-rest": {} }));

    expect(images).toEqual(["ios-dark-profile-rest.png"]);
    expect(PNG.sync.read(readFileSync(path.join(out, images[0] ?? ""))).width).toBe(800);
    expect(review).toContain(
      "**New: Profile rest, iOS, dark, default text.** Left to right: after.",
    );
  });

  it("lists removed screens in text, unless the head lane failed before capturing them", () => {
    const removed = gather(dark({ "settings-rest": {} }), dark({}));
    const failed = gather(dark({ "settings-rest": {} }), dark({}, "failure"));

    expect(removed.images).toEqual([]);
    expect(removed.review).toContain(
      "Removed screens:\n\n- Settings rest, iOS, dark, default text\n",
    );
    expect(failed.review).not.toContain("Removed");
    expect(failed.review).toContain(
      "- After captures for iOS dark may be incomplete because the ui-screenshots-ios-dark job failed in [run 1](https://github.com/o/r/actions/runs/1).",
    );
  });

  it("shows a large-text capture only when it changed, beside its default-size pair", () => {
    const { out, review, images } = gather(
      dark({ "library-shows": {}, "library-shows-xxxl": {}, "search-empty-ax5": {} }),
      dark({ "library-shows": {}, "library-shows-xxxl": { content: 1 }, "search-empty-ax5": {} }),
    );

    expect(images).toEqual(["ios-dark-library-shows-xxxl.png"]);
    expect(PNG.sync.read(readFileSync(path.join(out, images[0] ?? ""))).width).toBe(2448);
    expect(review).toContain(
      "**Changed: Library shows, iOS, dark, XXXL text.** Left to right: default text after, before, after.",
    );
  });
});

const prepare = () => {
  const { out } = gather(
    dark({ "library-shows": {}, "settings-rest": {} }),
    dark({ "library-shows": { content: 1 }, "settings-rest": { content: 1 } }),
  );
  const { root, state, run } = sandbox();
  spawnSync("zip", ["-qr", path.join(state, "30.zip"), "."], { cwd: out });
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
    return { ...result, calls: read("calls"), uploads: read("uploads"), posted: read("review.md") };
  };
  const decide = () => {
    const file = path.join(directory, "review.md");
    writeFileSync(file, readFileSync(file, "utf8").replaceAll("VERDICT_PENDING", "Intended."));
  };
  return { state, directory, attach, decide };
};

describe("attach-pr-media.sh", { timeout: 30_000 }, () => {
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
