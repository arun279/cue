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
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

const job = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).find(
  ({ name }) => name === "pr-media",
);
const userFacing = new RegExp(job?.body.match(/^ {10}USER_FACING: (.+)$/m)?.[1] ?? "(?!)");

const HEAD = "abcdef1234567890";

const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$STATE/calls"
case "$*" in
  "api repos/o/r/actions/runs/"*"/artifacts"*) run=\${2#repos/o/r/actions/runs/}; cat "$STATE/artifacts-\${run%%/*}" 2>/dev/null ;;
  "api repos/o/r/actions/artifacts?name=pr-media-${HEAD}&"*) jq -r "$4" "$STATE/by-name.json" ;;
  "api repos/o/r/actions/artifacts/"*) id=\${2#repos/o/r/actions/artifacts/}; cat "$STATE/\${id%/zip}.zip" ;;
  "api repos/o/r/actions/runs/"*) echo "\${2##*/}000000000000" ;;
  "api repos/o/r/actions/workflows/ci.yml/runs"*) echo 2 ;;
  "pr view 7 -R o/r --json baseRefName"*) echo feat/base ;;
  "pr view 7 -R o/r --json headRefOid"*) echo ${HEAD} ;;
  "api --paginate repos/o/r/issues/7/comments"*) echo 5 ;;
  "pr comment"*)
    cp body.md "$STATE/body.md"
    while [ $# -gt 0 ]; do
      if [ "$1" = --attach ]; then test -s "$2" && echo "$2" >> "$STATE/attached"; fi
      shift
    done ;;
esac
`;

const SHEETS = [
  "contact-ios-light",
  "contact-ios-dark",
  "contact-android-light",
  "contact-android-dark",
];
const LARGE_TEXT = ["library", "profile", "search"].flatMap((page) =>
  ["xxxl", "ax5"].map((size) => `${page}-${size}`),
);

const zip = (root: string, content: string, target: string) =>
  spawnSync("zip", ["-qr", target, "."], { cwd: path.join(root, content) });

const sandbox = () => {
  const root = tempDirectory("pr-media-");
  const state = path.join(root, "state");
  const bin = path.join(root, "bin");
  mkdirSync(state);
  mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), FAKE_GH);
  chmodSync(path.join(bin, "gh"), 0o755);
  const run = (script: string, args: string[]) => {
    const result = spawnSync("bash", [repositoryPath(`scripts/${script}`), ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "o/r",
        PATH: `${bin}:${process.env["PATH"]}`,
        STATE: state,
        TMPDIR: root,
      },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    return result.stdout;
  };
  return { root, state, run };
};

const gather = (artifacts: Record<string, Record<string, string[]>>) => {
  const { root, state, run } = sandbox();
  for (const [runId, byArtifact] of Object.entries(artifacts)) {
    writeFileSync(
      path.join(state, `artifacts-${runId}`),
      `${Object.keys(byArtifact).join("\n")}\n`,
    );
    for (const [id, files] of Object.entries(byArtifact)) {
      mkdirSync(path.join(root, id, "nested"), { recursive: true });
      for (const file of files) writeFileSync(path.join(root, id, "nested", `${file}.png`), file);
      zip(root, id, path.join(state, `${id}.zip`));
    }
  }
  const out = path.join(root, "pr-media");
  run("gather-pr-media.sh", ["7", "1", out]);
  const [, ...rows] = readFileSync(path.join(out, "captions.tsv"), "utf8").trim().split("\n");
  return {
    out,
    files: readdirSync(out).sort(),
    rows: rows.map((row) => {
      const [file, screen, state, platform, appearance, source] = row.split("\t");
      return { file, screen, state, platform, appearance, source };
    }),
  };
};

const attach = (artifacts: Record<string, Record<string, string[]>>) => {
  const { out } = gather(artifacts);
  const { root, state, run } = sandbox();
  zip(path.dirname(out), "pr-media", path.join(state, "30.zip"));
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
  const stdout = run("attach-pr-media.sh", ["7"]);
  const read = (name: string) =>
    existsSync(path.join(state, name)) ? readFileSync(path.join(state, name), "utf8") : "";
  const body = read("body.md");
  const images = [...body.matchAll(/!\[([^\]]+)\]\(([^)]+)\)/g)];
  return {
    body,
    stdout,
    directory: path.join(root, "pr-media-7-abcdef1"),
    calls: read("calls").trim().split("\n"),
    attached: read("attached").trim().split("\n").filter(Boolean),
    images: images.map(([, caption, file]) => ({ caption, file })),
    prose: images.reduce((text, [reference]) => text.replace(reference, ""), body),
  };
};

const ARTIFACT_NAME = /\.png|ui-screenshots|ui-contact-sheets|contact-(ios|android)|-(xxxl|ax5)\b/;

describe("pr-media job", () => {
  it("waits for both screenshot jobs, still runs when they are skipped, and uploads instead of posting", () => {
    expect(job?.body).toContain("needs: [ui-contact-sheets, ui-screenshots-ios-dark]");
    expect(job?.body).toContain("!cancelled() && github.event_name == 'pull_request'");
    expect(job?.body).toContain(
      'scripts/gather-pr-media.sh "$PR_NUMBER" "$GITHUB_RUN_ID" "$RUNNER_TEMP/pr-media"',
    );
    expect(job?.body).toContain("name: pr-media-$" + "{{ github.event.pull_request.head.sha }}");
    expect(job?.body).toContain("path: $" + "{{ runner.temp }}/pr-media");
    expect(job?.body).not.toContain("pr comment");
    expect(job?.body).not.toContain("pull-requests: write");
  });

  it.each([
    "packages/native/src/ui/tokens.ts",
    "packages/native/app/(tabs)/index.tsx",
    "packages/core/src/sync-contract.ts",
    ".maestro/ci/large-text.yaml",
    "scripts/gather-pr-media.sh",
    "scripts/attach-pr-media.sh",
    "scripts/create-ui-contact-sheet.sh",
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

describe("gather-pr-media.sh", () => {
  it("writes every capture and a caption row naming its screen, state, platform and appearance", () => {
    const { files, rows } = gather({
      "1": { "11": SHEETS, "12": [...LARGE_TEXT, "onboarding-ready"] },
    });

    expect(files).toEqual(
      [...SHEETS, ...LARGE_TEXT]
        .map((name) => `${name}.png`)
        .concat("captions.tsv")
        .sort(),
    );
    expect(rows).toHaveLength(10);
    expect(rows).toContainEqual(
      expect.objectContaining({
        file: "profile-ax5.png",
        screen: "Profile",
        state: "largest text (AX5)",
        platform: "iOS",
        appearance: "dark",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        file: "contact-android-light.png",
        screen: "Every screen",
        platform: "Android",
        appearance: "light",
      }),
    );
    expect(new Set(rows.map(({ source }) => source))).toEqual(
      new Set(["[run 1](https://github.com/o/r/actions/runs/1) on this commit"]),
    );
  });

  it("falls back to the base branch and labels the source", () => {
    const { files, rows } = gather({ "1": { "12": ["onboarding-ready"] }, "2": { "21": SHEETS } });

    expect(files).toHaveLength(5);
    expect(rows[0]?.source).toContain("the newest captures from `feat/base` at 2000000");
  });

  it("says when neither the run nor the base branch captured anything", () => {
    const { files, rows } = gather({});

    expect(files).toEqual(["captions.tsv"]);
    expect(rows.every(({ file }) => file === "-")).toBe(true);
    expect(rows[0]?.source).toContain("nothing captured by [run 1]");
  });
});

describe("attach-pr-media.sh", () => {
  it("attaches every capture from the newest artifact inline, captioned in words", () => {
    const posted = attach({ "1": { "11": SHEETS, "12": LARGE_TEXT } });

    expect(posted.calls).toContain("api repos/o/r/actions/artifacts/30/zip");
    expect(posted.images).toHaveLength(10);
    expect(posted.attached.sort()).toEqual(posted.images.map(({ file }) => file).sort());
    expect(posted.images.map(({ caption }) => caption)).toContain(
      "Profile, iOS, dark, largest text (AX5)",
    );
    expect(posted.images.map(({ caption }) => caption)).toContain(
      "Every screen, Android, light, default text",
    );
    expect(posted.body).toContain("| Library | Profile | Search |");
    expect(posted.prose).not.toMatch(ARTIFACT_NAME);
    expect(posted.body).toContain("### UI media for abcdef1");
    expect(posted.body).not.toContain("Missing");
  });

  it("prints the local path of every image so it can be opened before merging", () => {
    const posted = attach({ "1": { "11": SHEETS, "12": LARGE_TEXT } });
    const paths = [...posted.stdout.matchAll(/^(\/\S+\.png) {2}(.+)$/gm)];

    expect(paths).toHaveLength(10);
    for (const [, file] of paths) expect(existsSync(file ?? "")).toBe(true);
    expect(paths.map(([, file]) => path.dirname(file ?? ""))).toContain(posted.directory);
  });

  it("names what a failed lane did not capture in words, not file names", () => {
    const posted = attach({ "1": { "12": ["library-xxxl", "profile-xxxl", "search-xxxl"] } });

    expect(posted.images.map(({ caption }) => caption)).toEqual([
      "Library, iOS, dark, XXXL text",
      "Profile, iOS, dark, XXXL text",
      "Search, iOS, dark, XXXL text",
    ]);
    expect(posted.body).toContain("- Every screen, iOS, light, default text\n");
    expect(posted.body).toContain("- Search, iOS, dark, largest text (AX5)\n");
    expect(posted.prose).not.toMatch(ARTIFACT_NAME);
  });

  it("carries the base branch label into the comment", () => {
    const posted = attach({ "1": { "12": ["onboarding-ready"] }, "2": { "21": SHEETS } });

    expect(posted.images).toHaveLength(4);
    expect(posted.body).toContain("Source: the newest captures from `feat/base` at 2000000");
  });

  it("replaces the previous media comment only after the new one is posted", () => {
    const { calls } = attach({ "1": { "11": SHEETS } });

    expect(calls.findIndex((call) => call.startsWith("pr comment 7"))).toBeLessThan(
      calls.indexOf("api --method DELETE repos/o/r/issues/comments/5"),
    );
  });
});
