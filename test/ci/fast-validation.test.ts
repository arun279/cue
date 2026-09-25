import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const workflow = readFileSync(repositoryPath(".github/workflows/ci.yml"), "utf8");
const job = (name: string) =>
  workflow.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|(?![\\s\\S]))`, "m"),
  )?.[1] ?? "";

describe("fast pull request validation", () => {
  it("gates each native build on its platform fingerprint", () => {
    const fingerprint = job("fingerprint");
    const ios = job("native-ios");
    const android = job("native-android");

    expect(fingerprint).toContain("pnpm exec node scripts/native-fingerprint.mjs ios");
    expect(fingerprint).toContain("pnpm exec node scripts/native-fingerprint.mjs android");
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

  it("reports the footprint whenever its inputs were published", () => {
    const check = job("check");
    const footprint = job("footprint");
    const condition = footprint.match(/^ {4}if: >-\n((?: {6}.*\n)+)/m)?.[1] ?? "";

    expect(footprint).toContain("needs: [check, native-android]");
    expect(condition).toMatch(/^ {6}!cancelled\(\) && /);
    expect(condition).not.toMatch(/always\(\)|needs\.check\.result/);
    expect(condition).toContain("needs.check.outputs.js-bundles != ''");
    expect(condition).toContain("needs.native-android.result == 'success'");
    expect(check).toContain("js-bundles: $" + "{{ steps.js-bundles.outputs.artifact-id }}");
    expect(check).toMatch(
      /- run: pnpm check\n(?: {8}.*\n)*? {6}- name: Upload JavaScript bundles\n {8}id: js-bundles\n/,
    );
  });

  it("gates changed core lines from the generated LCOV file", () => {
    const check = job("check");

    expect(check).toContain('check-changed-coverage.mjs "origin/$BASE_REF" coverage/lcov.info');
    expect(check).toContain('PR_BODY=$(gh pr view "$PR_NUMBER" --json body --jq .body)');
    expect(check).not.toContain("github.event.pull_request.body");
  });

  it("runs the app-idle measurement after flows that relaunch the app", () => {
    const suite = readFileSync(repositoryPath(".maestro/ci/app-discovery.yaml"), "utf8");
    const android = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(suite).toMatch(
      /file: \.\.\/flows\/returning-user-app-idle\.yaml\n {4}when:\n {6}platform: iOS/,
    );
    expect(android).not.toContain("APP_IDLE_CEILING_MS");
    expect(android).not.toContain("6000");
  });

  it("runs every shared Maestro flow on iOS and Android", () => {
    const ios = job("native-e2e-ios-light");
    const androidJob = job("android-e2e");
    const android = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");
    const suite = readFileSync(repositoryPath(".maestro/ci/app.yaml"), "utf8");
    const iosSuites = ["detail", "discovery"]
      .map((name) => readFileSync(repositoryPath(`.maestro/ci/app-${name}.yaml`), "utf8"))
      .join("\n");

    expect(ios).toContain("suite: [detail, discovery]");
    expect(ios).toContain('test ".maestro/ci/app-$' + '{{ matrix.suite }}.yaml"');
    expect(android).toContain("suite=.maestro/ci/app.yaml");
    expect(androidJob).toContain('"$RUNNER_TEMP/screenshots/android" light');
    for (const flow of suite.match(/\.\.\/flows\/[\w-]+\.yaml/g) ?? []) {
      expect(iosSuites).toContain(flow);
    }
  });

  it("runs required dark screenshot traversals on independent cached-app jobs", () => {
    const ios = job("ui-screenshots-ios-dark");
    const android = job("ui-screenshots-android-dark");

    expect(ios).toContain("needs: [fingerprint, native-ios]");
    expect(ios).toContain("actions/download-artifact@70fc10c6e5e1ce46ad2ea6f2b72d43f7d47b13c3");
    expect(ios).toContain("name: cue-native-ios-$" + "{{ needs.fingerprint.outputs.ios }}");
    expect(ios).toContain("test .maestro/ci/screenshots.yaml");
    expect(ios).not.toContain("continue-on-error");
    expect(android).toContain("needs: [fingerprint, native-android]");
    expect(android).toContain("cue-native-android-$" + "{{ needs.fingerprint.outputs.android }}");
    expect(android).toContain('"$RUNNER_TEMP/screenshots/android" dark');
    expect(android).not.toContain("continue-on-error");
  });

  it("waits for app idle before checking the connected loading state", () => {
    const connect = readFileSync(repositoryPath(".maestro/flows/lib/connect.yaml"), "utf8");

    expect(connect).toMatch(/screen-up-next[\s\S]*app-idle[\s\S]*up-next-skeleton/);
  });

  it("uploads Maestro's hidden debug folder even after a timeout, leaving screenshots in place", () => {
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");
    const sources = [workflow, verification];
    const uploads = [
      ...workflow.matchAll(/if: (.+)\n\s+with:\n\s+name: (?:native|android)-e2e-.*\n\s+(.+)/g),
    ];

    expect(sources.flatMap((source) => source.match(/--debug-output /g) ?? [])).toHaveLength(3);
    for (const source of sources) expect(source).not.toContain("--flatten-debug-output");
    expect(uploads).toHaveLength(4);
    for (const [, condition, option] of uploads) {
      expect(condition).toBe("$" + "{{ always() }}");
      expect(option).toBe("include-hidden-files: true");
    }
  });

  it("uses a fixed Maestro driver port outside Android's ephemeral range", () => {
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(verification.match(/--driver-host-port 7001/g)).toHaveLength(1);
  });

  it("fails the aggregate unless every iOS light shard succeeds", () => {
    const aggregate = job("native-e2e");

    expect(aggregate).toContain("needs: native-e2e-ios-light");
    expect(aggregate).toContain("if: $" + "{{ always() }}");
    expect(aggregate).toContain(
      "run: test '$" + "{{ needs.native-e2e-ios-light.result }}' = success",
    );
  });

  it("publishes both screenshot artifacts with contact sheets for 14 days", () => {
    const ios = job("native-e2e-ios-light");
    const iosContact = job("native-e2e");
    const iosDark = job("ui-screenshots-ios-dark");
    const android = job("android-e2e");
    const androidDark = job("ui-screenshots-android-dark");
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");
    const fetch = readFileSync(repositoryPath("scripts/fetch-ui-screenshots.sh"), "utf8");

    expect(ios).toContain("name: ui-screenshots-ios-light-$" + "{{ matrix.suite }}");
    expect(iosContact).toContain("pattern: ui-screenshots-ios-light-*");
    expect(iosContact).toContain("name: ui-screenshots-ios-light");
    expect(iosDark).toContain("name: ui-screenshots-ios-dark");
    expect(ios).toContain('--test-output-dir "$output"');
    expect(iosDark).toContain('--test-output-dir "$RUNNER_TEMP/screenshots/ios/dark"');
    expect(iosContact).toContain("create-ui-contact-sheet.sh");
    expect(iosDark).toContain("create-ui-contact-sheet.sh");
    expect(iosContact).toContain("apt-get install --no-install-recommends -y imagemagick");
    expect(iosDark).toContain("brew install imagemagick");
    expect(android).toContain("name: ui-screenshots-android");
    expect(android).toContain("name: ui-screenshots-android-light");
    expect(androidDark).toContain("name: ui-screenshots-android-dark");
    expect(verification).toContain('--test-output-dir "$screenshots/$appearance"');
    expect(android).toContain("create-ui-contact-sheet.sh");
    expect(androidDark).toContain("create-ui-contact-sheet.sh");
    expect(android).toContain("apt-get install --no-install-recommends -y imagemagick");
    expect(androidDark).toContain("apt-get install --no-install-recommends -y imagemagick");
    expect(ios.match(/retention-days: 14/g)).toHaveLength(1);
    expect(iosContact.match(/retention-days: 14/g)).toHaveLength(1);
    expect(iosDark.match(/retention-days: 14/g)).toHaveLength(1);
    expect(android.match(/retention-days: 14/g)).toHaveLength(1);
    expect(androidDark.match(/retention-days: 14/g)).toHaveLength(1);
    expect(fetch).toContain("for platform in ios android");
    expect(fetch).toContain("for appearance in light dark");
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
          expect(lines.slice(index - 2, index).map((entry) => entry.trim())).toEqual([
            "- waitForAnimationToEnd:",
            "timeout: 1000",
          ]);
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
