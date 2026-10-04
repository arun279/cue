import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

const job = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).find(
  ({ name }) => name === "pr-media",
);
const userFacing = new RegExp(job?.body.match(/^ {10}USER_FACING: (.+)$/m)?.[1] ?? "(?!)");

const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$STATE/calls"
case "$*" in
  "api repos/o/r/actions/runs/"*"/artifacts"*) run=\${2#repos/o/r/actions/runs/}; cat "$STATE/artifacts-\${run%%/*}" 2>/dev/null ;;
  "api repos/o/r/actions/artifacts/"*) id=\${2#repos/o/r/actions/artifacts/}; cat "$STATE/\${id%/zip}.zip" ;;
  "api repos/o/r/actions/runs/"*) echo "\${2##*/}000000000000" ;;
  "api repos/o/r/actions/workflows/ci.yml/runs"*) echo 2 ;;
  "pr view"*) echo feat/base ;;
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

const postMedia = (artifacts: Record<string, Record<string, string[]>>) => {
  const root = tempDirectory("pr-media-");
  const state = path.join(root, "state");
  const bin = path.join(root, "bin");
  mkdirSync(state);
  mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), FAKE_GH);
  chmodSync(path.join(bin, "gh"), 0o755);
  for (const [run, byArtifact] of Object.entries(artifacts)) {
    writeFileSync(path.join(state, `artifacts-${run}`), `${Object.keys(byArtifact).join("\n")}\n`);
    for (const [id, files] of Object.entries(byArtifact)) {
      const content = path.join(root, id);
      mkdirSync(path.join(content, "nested"), { recursive: true });
      for (const file of files) writeFileSync(path.join(content, "nested", `${file}.png`), "png");
      spawnSync("zip", ["-qr", path.join(state, `${id}.zip`), "."], { cwd: content });
    }
  }
  const result = spawnSync("bash", [repositoryPath("scripts/pr-media.sh"), "7", "1"], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "o/r",
      PATH: `${bin}:${process.env["PATH"]}`,
      STATE: state,
    },
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const read = (name: string) => readFileSync(path.join(state, name), "utf8");
  const body = read("body.md");
  const images = [...body.matchAll(/!\[([^\]]+)\]\(([^)]+)\)/g)];
  return {
    body,
    calls: read("calls").trim().split("\n"),
    attached: read("attached").trim().split("\n"),
    images: images.map(([, caption, file]) => ({ caption, file })),
    prose: images.reduce((text, [reference]) => text.replace(reference, ""), body),
  };
};

const ARTIFACT_NAME = /\.png|ui-screenshots|ui-contact-sheets|contact-(ios|android)|-(xxxl|ax5)\b/;

describe("pr-media job", () => {
  it("waits for both screenshot jobs and still runs when they are skipped", () => {
    expect(job?.body).toContain("needs: [ui-contact-sheets, ui-screenshots-ios-dark]");
    expect(job?.body).toContain("!cancelled() && github.event_name == 'pull_request'");
    expect(job?.body).toContain('scripts/pr-media.sh "$PR_NUMBER" "$GITHUB_RUN_ID"');
  });

  it.each([
    "packages/native/src/ui/tokens.ts",
    "packages/native/app/(tabs)/index.tsx",
    "packages/core/src/sync-contract.ts",
    ".maestro/ci/large-text.yaml",
    "scripts/pr-media.sh",
    "scripts/create-ui-contact-sheet.sh",
  ])("posts media when %s changes", (file) => {
    expect(userFacing.test(file)).toBe(true);
  });

  it.each([
    "packages/native/__tests__/screen.test.tsx",
    "packages/native/app.config.ts",
    "packages/core/test/sync.test.ts",
    "test/ci/pr-media.test.ts",
    "README.md",
  ])("posts nothing when only %s changes", (file) => {
    expect(userFacing.test(file)).toBe(false);
  });
});

describe("pr-media.sh", () => {
  it("attaches every capture inline with a caption naming the screen and state", () => {
    const posted = postMedia({ "1": { "11": SHEETS, "12": [...LARGE_TEXT, "onboarding-ready"] } });

    expect(posted.images).toHaveLength(10);
    expect(posted.attached.sort()).toEqual(posted.images.map(({ file }) => file).sort());
    expect(posted.images.map(({ caption }) => caption)).toContain(
      "Profile, dark, largest text (AX5)",
    );
    expect(posted.images.map(({ caption }) => caption)).toContain("Every Android screen, light");
    expect(posted.prose).not.toMatch(ARTIFACT_NAME);
    expect(posted.body).toContain("### UI media for 1000000");
    expect(posted.body).not.toContain("Missing");
  });

  it("names what a failed lane did not capture in words, not file names", () => {
    const posted = postMedia({ "1": { "12": ["library-xxxl", "profile-xxxl", "search-xxxl"] } });

    expect(posted.images.map(({ caption }) => caption)).toEqual([
      "Library, dark, XXXL text",
      "Profile, dark, XXXL text",
      "Search, dark, XXXL text",
    ]);
    expect(posted.body).toContain("- Every iOS screen, light\n");
    expect(posted.body).toContain("- Search, dark, largest text (AX5)\n");
    expect(posted.prose).not.toMatch(ARTIFACT_NAME);
  });

  it("falls back to the base branch and says so when the run captured nothing", () => {
    const posted = postMedia({ "1": { "12": ["onboarding-ready"] }, "2": { "21": SHEETS } });

    expect(posted.images).toHaveLength(4);
    expect(posted.body).toContain("These are the newest from `feat/base` at 2000000");
  });

  it("replaces the previous media comment only after the new one is posted", () => {
    const { calls } = postMedia({ "1": { "11": SHEETS } });

    expect(calls.findIndex((call) => call.startsWith("pr comment 7"))).toBeLessThan(
      calls.indexOf("api --method DELETE repos/o/r/issues/comments/5"),
    );
  });
});
