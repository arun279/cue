import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const workflow = readFileSync(repositoryPath(".github/workflows/ci.yml"), "utf8");
const job = (name: string) =>
  workflow.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|(?![\\s\\S]))`, "m"),
  )?.[1] ?? "";

describe("fast pull request validation", () => {
  it("gates each native build on its platform fingerprint", () => {
    const fingerprint = job("fingerprint");
    const ios = job("native-ios");
    const android = job("native-android");

    expect(fingerprint).toContain("node scripts/native-fingerprint.mjs ios");
    expect(fingerprint).toContain("node scripts/native-fingerprint.mjs android");
    expect(ios).toContain("needs: fingerprint");
    expect(ios).toContain("if: steps.native-cache.outputs.hit != 'true'");
    expect(ios).toContain("if: steps.native-cache.outputs.hit == 'true'");
    expect(android).toContain("needs: fingerprint");
    expect(android).toContain("if: steps.native-cache.outputs.hit != 'true'");
    expect(android).toContain("if: steps.native-cache.outputs.hit == 'true'");
    expect(android.match(/--build-cache --configuration-cache/g)).toHaveLength(2);
    expect(android.match(/--configuration-cache-problems=warn/g)).toHaveLength(2);
    expect(android).toContain("-PreactNativeArchitectures=arm64-v8a,x86_64");
    expect(android).toContain("configuration-cache-problems=warn assembleRelease");
    expect(android).not.toContain("bundleRelease assembleRelease");
    expect(android).toContain("lib/x86_64/lib" + "react" + "native\\.so");
  });

  it("keeps every build command out of footprint", () => {
    const footprint = job("footprint");

    expect(footprint).not.toMatch(/expo (?:export|prebuild)/);
    expect(footprint).not.toContain("grad" + "lew");
    expect(footprint).not.toMatch(/(?:xcodebuild|measure-play-size)/);
    expect(footprint).not.toContain("cue-native-ios-sizes");
    expect(footprint).toContain("cue-native-android-sizes");
    expect(footprint).toContain("cue-js-bundles");
    expect(footprint).toMatch(
      /name: Upload Expo Atlas[\s\S]*name: expo-atlas[\s\S]*path: packages\/native\/\.expo\/atlas\.jsonl/,
    );
    expect(footprint).not.toContain("summarize-atlas");
    expect(workflow).toContain("branches: [main, feat/expo-native");
    expect(footprint).toContain(
      "name: cue-footprint-$" + "{{ github.event.pull_request.head.sha || github.sha }}",
    );
    expect(footprint).toContain(
      'download-ci-artifact.sh "$ARTIFACT_NAME" "$RUNNER_TEMP/base-metrics" footprint',
    );
    expect(footprint).toContain("Measured merge base $BASE_SHA from CI run $run_id artifacts");
    expect(footprint).toContain("Missing merge-base measurements and successful CI artifacts");
    expect(footprint).toContain('startswith("cue-native-android-")');
    expect(footprint).toContain('java -jar "$RUNNER_TEMP/bundletool.jar" get-size total');
  });

  it("gates changed core lines from the generated LCOV file", () => {
    const check = job("check");

    expect(check).toContain('check-changed-coverage.mjs "origin/$BASE_REF" coverage/lcov.info');
    expect(check).toContain('PR_BODY=$(gh pr view "$PR_NUMBER" --json body --jq .body)');
    expect(check).not.toContain("github.event.pull_request.body");
  });

  it("runs the app-idle measurement after flows that relaunch the app", () => {
    const suite = readFileSync(repositoryPath(".maestro/ci/app.yaml"), "utf8");
    const android = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(suite).toMatch(
      /file: \.\.\/flows\/returning-user-app-idle\.yaml\n {4}when:\n {6}platform: iOS/,
    );
    expect(android).not.toContain("APP_IDLE_CEILING_MS");
    expect(android).not.toContain("6000");
  });

  it("runs one shared Maestro suite on iOS and Android", () => {
    const ios = job("native-ios");
    const android = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(ios).toContain("suite=.maestro/ci/app.yaml");
    expect(android).toContain("suite=.maestro/ci/app.yaml");
    expect(ios).toContain("suite=.maestro/ci/screenshots.yaml");
    expect(android).toContain("suite=.maestro/ci/screenshots.yaml");
  });

  it("uses a fixed Maestro driver port outside Android's ephemeral range", () => {
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(verification.match(/--driver-host-port 7001/g)).toHaveLength(1);
  });

  it("publishes both screenshot artifacts with contact sheets for 14 days", () => {
    const ios = job("native-ios");
    const android = job("android-e2e");
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(ios).toContain("name: ui-screenshots-ios");
    expect(ios).toContain('--test-output-dir "$RUNNER_TEMP/screenshots/ios/$appearance"');
    expect(ios).toContain("create-ui-contact-sheet.sh");
    expect(ios).toContain("brew install imagemagick");
    expect(android).toContain("name: ui-screenshots-android");
    expect(verification).toContain('--test-output-dir "$screenshots/$appearance"');
    expect(android).toContain("create-ui-contact-sheet.sh");
    expect(android).toContain("apt-get install --no-install-recommends -y imagemagick");
    expect(ios.match(/retention-days: 14/g)).toHaveLength(1);
    expect(android.match(/retention-days: 14/g)).toHaveLength(1);
  });

  it("settles animations before every shared screenshot", () => {
    const flows = [
      "lib/connect.yaml",
      "launch.yaml",
      "up-next-mark-and-undo.yaml",
      "show-detail-bulk-mark.yaml",
      "episode-sheet.yaml",
      "calendar.yaml",
      "library.yaml",
      "tabs.yaml",
      "dark-traversal.yaml",
    ];
    for (const flow of flows) {
      const lines = readFileSync(repositoryPath(`.maestro/flows/${flow}`), "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.includes("takeScreenshot:")) {
          expect(lines[index - 1]?.trim()).toBe("- waitForAnimationToEnd");
        }
      }
    }
  });

  it("keeps the dark pass to a shared visit and screenshot traversal", () => {
    const suite = readFileSync(repositoryPath(".maestro/ci/screenshots.yaml"), "utf8");
    const traversal = readFileSync(repositoryPath(".maestro/flows/dark-traversal.yaml"), "utf8");

    expect(suite).toContain("runFlow: ../flows/dark-traversal.yaml");
    expect(traversal).not.toMatch(/^\s*- assert/m);
    expect(traversal).not.toMatch(/id: ".*(?:mark|check)/);
    expect(traversal.match(/takeScreenshot:/g)?.length).toBe(9);
  });

  it("asserts all four Android tabs from the final UI tree", () => {
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(verification).toContain('for label in "Up Next" "Library" "Calendar" "Search"');
    expect(verification).toContain(String.raw`grep -Fq "text=\"$label\"" "$output/tabs.xml"`);
  });

  it("measures render performance base then head on one runner", () => {
    const render = job("render-performance");

    expect(render).toMatch(
      /git worktree add[\s\S]*perf:render --baseline --compare=false[\s\S]*perf:render\n/,
    );
    expect(render).toContain("packages/native/.reassure/baseline.perf");
    expect(render).toContain("Gate render counts");
    expect(render).toContain("include-hidden-files: true");
  });

  it("asserts zero Android ANRs after exercising the release app", () => {
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(verification).toContain("settings put global hide_error_dialogs 1");
    expect(verification).toContain("dumpsys activity exit-info app.cuetracker");
    expect(verification).toContain("scripts/assert-no-anr.sh");
  });
});
