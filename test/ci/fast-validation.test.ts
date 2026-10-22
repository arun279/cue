import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const workflow = readFileSync(repositoryPath(".github/workflows/ci.yml"), "utf8");
const job = (name: string) =>
  workflow.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|(?![\\s\\S]))`, "m"),
  )?.[1] ?? "";

const steps = (name: string) => job(name).split(/^ {6}- /m);
const envOf = (step: string) => step.match(/^ {8}env:\n((?: {10}.*\n)+)/m)?.[1];
const IOS_LANES = ["native-e2e-ios-light", "ui-screenshots-ios-dark"];
const HARNESS_BUNDLE = "ios-harness-bundle$" + "{{ inputs.copy }}";

type HeaderReady = { avatar: boolean; menu: boolean };
const HEADER_KINDS: [RegExp, keyof HeaderReady][] = [
  [/^(?:up-next|library|calendar)-/, "avatar"],
  [/^(?:show-detail|episode-sheet|movie-detail)-/, "menu"],
];
const HEADER_WAITS = {
  avatar: /^ *(?:- assertVisible:|visible:)\n +id: "avatar-link"$/,
  menu: /\n *(?:- (?:assertVisible|tapOn)|visible): "More actions for [^"*]+"$/,
};
const LANDS_ON_UP_NEXT =
  /lib\/(?:relaunch|connect|sign-in|ready)\.yaml|^ *(?:file|- runFlow): (?:relaunch|connect|sign-in|ready)\.yaml$/m;

function headerReady(ready: HeaderReady, lines: string, landed: boolean): HeaderReady {
  const line = lines.slice(lines.indexOf("\n") + 1);
  const entered = LANDS_ON_UP_NEXT.test(line)
    ? { avatar: landed, menu: false }
    : /id: "screen-[a-z-]+"|- launchApp\b/.test(line)
      ? { avatar: false, menu: false }
      : ready;
  return {
    avatar: entered.avatar || HEADER_WAITS.avatar.test(lines),
    menu: entered.menu || HEADER_WAITS.menu.test(lines),
  };
}

const git = (repository: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8", env: gitEnv() }).trim();

const commit = (repository: string, file: string): string => {
  writeFileSync(path.join(repository, file), file);
  git(repository, "add", file);
  git(repository, "commit", "--quiet", "-m", file);
  return git(repository, "rev-parse", "HEAD");
};

const measuredBase = (repository: string, ...args: string[]): string =>
  execFileSync(repositoryPath("scripts/measured-base.sh"), args, {
    cwd: repository,
    encoding: "utf8",
    env: gitEnv(),
  }).trim();

describe("fast pull request validation", () => {
  it("measures a pull request against the base its merge commit was built on", () => {
    const repository = tempDirectory("cue-measured-base-");
    git(repository, "init", "--quiet", "--initial-branch=main");
    git(repository, "config", "user.name", "Cue Tests");
    git(repository, "config", "user.email", "cue-tests@example.invalid");
    const opened = commit(repository, "opened");
    git(repository, "switch", "--quiet", "-c", "topic");
    commit(repository, "topic");
    git(repository, "switch", "--quiet", "main");
    const moved = commit(repository, "moved");
    git(repository, "switch", "--quiet", "--detach", "main");
    git(repository, "merge", "--quiet", "--no-ff", "-m", "Merge topic into main", "topic");

    expect(moved).not.toBe(opened);
    expect(measuredBase(repository, "pull_request", opened)).toBe(moved);
    expect(measuredBase(repository, "push", opened)).toBe(opened);
    expect(measuredBase(repository, "push", "0".repeat(40))).toBe(moved);
    expect(measuredBase(repository, "schedule")).toBe(moved);
    expect(workflow).not.toContain("pull_request.base.sha");
    expect(job("render-performance")).toContain(
      'BASE_SHA=$(scripts/measured-base.sh "$EVENT_NAME" "$PUSH_BEFORE")',
    );
    expect(job("footprint-base")).toContain(
      'git worktree add --detach "$RUNNER_TEMP/footprint-base" "$(scripts/measured-base.sh pull_request)"',
    );
    expect(job("footprint-base")).toContain(
      'scripts/measure-base.sh "$RUNNER_TEMP/footprint-base"',
    );
  });

  it("gates each native build on its platform fingerprint", () => {
    const fingerprint = job("fingerprint");
    const ios = job("native-ios");
    const android = job("native-android");

    expect(fingerprint).toContain("pnpm exec node scripts/native-fingerprint.mjs ios");
    expect(fingerprint).not.toContain("native-fingerprint.mjs android");
    expect(ios).toContain("needs: fingerprint");
    expect(ios).toContain("if: steps.native-cache.outputs.hit != 'true'");
    expect(ios).toContain("if: steps.native-cache.outputs.hit == 'true'");
    expect(android).not.toMatch(/^ {4}needs:/m);
    expect(android).toContain(
      'run: echo "android=$(pnpm exec node scripts/native-fingerprint.mjs android)" >> "$GITHUB_OUTPUT"',
    );
    expect(android).toContain("fingerprint: $" + "{{ steps.fingerprint.outputs.android }}");
    expect(android).toContain(
      "ARTIFACT_NAME: cue-native-android-$" + "{{ steps.fingerprint.outputs.android }}",
    );
    expect(android).toContain("if: steps.native-cache.outputs.hit != 'true'");
    expect(android).toContain("if: steps.native-cache.outputs.hit == 'true'");
    const build = readFileSync(repositoryPath("scripts/build-android-release.sh"), "utf8");
    expect(android).toContain(
      'run: scripts/build-android-release.sh "$RUNNER_TEMP/native-android"\n',
    );
    expect(build.match(/--build-cache --configuration-cache/g)).toHaveLength(2);
    expect(build.match(/--configuration-cache-problems=warn/g)).toHaveLength(2);
    expect(build).toContain("-PreactNativeArchitectures=arm64-v8a,x86_64");
    expect(build).toContain("configuration-cache-problems=warn assembleRelease");
    expect(build).not.toContain("bundleRelease assembleRelease");
    expect(android).toContain("lib/x86_64/lib" + "react" + "native\\.so");
  });

  it("keeps every build command out of footprint", () => {
    const footprint = job("footprint");

    expect(footprint).not.toMatch(/expo (?:export|prebuild)|measure-base/);
    expect(footprint).not.toContain("grad" + "lew");
    expect(footprint).not.toMatch(/(?:xcodebuild|measure-play-size)/);
    expect(footprint).not.toContain("cue-native-ios-sizes");
    expect(footprint).toContain("cue-native-android-sizes");
    expect(footprint).toContain("cue-js-bundles");
    expect(footprint).toMatch(
      /name: Upload Expo Atlas[\s\S]*name: expo-atlas[\s\S]*path: packages\/native\/\.expo\/atlas\.jsonl/,
    );
    expect(footprint).not.toContain("summarize-atlas");
    expect(footprint).toContain("with:\n          name: cue-footprint-base\n");
    expect(job("footprint-base")).toContain("name: cue-footprint-base\n");
    expect(workflow).not.toMatch(/cue-footprint-\$|restore-base-metrics/);
  });

  it("measures the merge base with the build environment native-android measures the head with", () => {
    const base = steps("footprint-base").find((step) =>
      step.startsWith("name: Measure the merge base\n"),
    );
    const native = steps("native-android");
    const environment = (step = "") =>
      Object.fromEntries(
        (envOf(step) ?? "")
          .trim()
          .split(/\n\s*/)
          .map((line) => line.split(": ")),
      );
    const fingerprint = native.find((step) => step.includes("native-fingerprint.mjs android"));
    const embed = native.find((step) => step.includes("scripts/reembed-android.sh"));
    const measure = readFileSync(repositoryPath("scripts/measure-base.sh"), "utf8");

    expect(environment(base)).toEqual({
      ...environment(fingerprint),
      ...environment(embed),
      GH_TOKEN: "$" + "{{ github.token }}",
      HEAD_FINGERPRINT: "$" + "{{ needs.native-android.outputs.fingerprint }}",
    });
    expect(job("footprint-base")).toContain(
      "name: cue-native-android-$" + "{{ needs.native-android.outputs.fingerprint }}\n",
    );
    for (const script of ["build-android-release.sh", "measure-android-sizes.sh"]) {
      expect(job("native-android")).toContain(`scripts/${script}`);
      expect(measure).toContain(`"$scripts/${script}"`);
    }
    expect(measure).toContain('"$scripts/reembed-android.sh"');
    expect(measure).toContain('"$scripts/measure-sizes.sh"');
    expect(readFileSync(repositoryPath("package.json"), "utf8")).toContain(
      '"check:size:native": "EXPO_ATLAS=true pnpm --filter @cue/native exec expo export --platform ios --platform android --output-dir dist &&',
    );
    expect(measure).toContain(
      "EXPO_ATLAS=true pnpm --filter @cue/native exec expo export --platform ios --platform android --output-dir dist\n",
    );
  });

  it("reports the footprint whenever its inputs were published", () => {
    const check = job("check");
    const footprint = job("footprint");
    const condition = footprint.match(/^ {4}if: >-\n((?: {6}.*\n)+)/m)?.[1] ?? "";

    expect(footprint).toContain("needs: [check, native-android, footprint-base]");
    expect(condition).toContain("needs.footprint-base.result == 'success'");
    expect(condition).toMatch(/^ {6}!cancelled\(\) && /);
    expect(condition).not.toMatch(/always\(\)|needs\.check\.result/);
    expect(condition).toContain("needs.check.outputs.js-bundles != ''");
    expect(condition).toContain("needs.native-android.result == 'success'");
    expect(check).toContain("js-bundles: $" + "{{ steps.js-bundles.outputs.artifact-id }}");
    expect(check).toMatch(
      /- run: pnpm check\n(?: {8}.*\n)*? {6}- name: Upload JavaScript bundles\n {8}id: js-bundles\n/,
    );
  });

  it("posts the footprint comment before failing on a tripped gate", () => {
    const steps = job("footprint").split(/^ {6}- /m);
    const index = (name: string) => steps.findIndex((step) => step.startsWith(`name: ${name}\n`));
    const measure = index("Measure the diff footprint");
    const comment = index("Update the pull request comment");
    const enforce = index("Enforce the footprint gates");

    expect(steps[measure]).toContain("        id: diff\n");
    expect(steps[measure]).toMatch(
      /scripts\/diff-footprint\.sh .*\\\n +> footprint\.md 2> footprint-gates\.txt \|\| status=\$\?\n +echo "status=\$status" >> "\$GITHUB_OUTPUT"\n/,
    );
    expect(measure).toBeGreaterThan(0);
    expect(comment).toBeGreaterThan(measure);
    expect(enforce).toBe(steps.length - 1);
    expect(steps[enforce]).toContain(
      "        if: steps.diff.outputs.status != '' && steps.diff.outputs.status != '0'\n",
    );
    expect(steps[enforce]).toContain("cat footprint-gates.txt >&2\n          exit 1\n");
  });

  it("gates the audit only through the dependency-change script", () => {
    const audit = job("audit");

    expect(audit).toContain("fetch-depth: 0\n");
    expect(audit).toContain("EVENT_NAME: $" + "{{ github.event_name }}");
    expect(audit).toContain("PUSH_BEFORE: $" + "{{ github.event.before }}");
    expect(audit).toContain('run: scripts/audit-dependencies.sh "$EVENT_NAME" "$PUSH_BEFORE"\n');
    expect(audit).not.toMatch(/pnpm audit|check-stale-audit-ignores/);
  });

  it("gates changed core lines from the generated LCOV file", () => {
    const check = job("check");

    expect(check).toContain('check-changed-coverage.mjs "origin/$BASE_REF" coverage/lcov.info');
    expect(check).toContain('PR_BODY=$(gh pr view "$PR_NUMBER" --json body --jq .body)');
    expect(check).not.toContain("github.event.pull_request.body");
  });

  it("checks returning-user readiness without collecting runner timing", () => {
    const suite = readFileSync(repositoryPath(".maestro/ci/app-discovery.yaml"), "utf8");
    const returning = readFileSync(
      repositoryPath(".maestro/flows/returning-user-app-idle.yaml"),
      "utf8",
    );
    const feedback = readFileSync(
      repositoryPath(".maestro/flows/up-next-mark-and-undo.yaml"),
      "utf8",
    );

    expect(suite).toMatch(
      /file: \.\.\/flows\/returning-user-app-idle\.yaml\n {4}when:\n {6}platform: iOS/,
    );
    expect(returning).toMatch(/launchApp:[\s\S]*stopApp: true[\s\S]*extendedWaitUntil:/);
    expect(returning).toContain('id: "app-ready"');
    expect(returning).toContain('id: "up-next-list"');
    expect(returning).not.toMatch(/repeat:|copyTextFrom|evalScript/);
    expect(feedback).toMatch(/tapOn:[\s\S]*snackbar-undo[\s\S]*assertNotVisible:/);
    expect(feedback).toMatch(/text: \$\{output\.rowLabel\}/);
    expect(`${workflow}${returning}${feedback}`).not.toMatch(
      /RESPONSE_SAMPLES|APP_IDLE_CEILING_MS|FEEDBACK_CEILING_MS|REFERENCE_READ_MS|response-timing|summarize-app-idle|CUE_APP_IDLE_SAMPLES/,
    );
  });

  it("runs every shared Maestro flow on iOS and Android", () => {
    const ios = job("native-e2e-ios-light");
    const android = job("android-e2e-light");
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");
    const suites = ["detail", "activity", "discovery"];
    const flows = suites.flatMap((name) => [
      ...readFileSync(repositoryPath(`.maestro/ci/app-${name}.yaml`), "utf8").matchAll(
        /file: (\.\.\/flows\/[\w-]+\.yaml)\n {4}when:\n {6}platform: (\w+)\n/g,
      ),
    ]);

    for (const lane of [ios, android]) {
      expect(lane).toContain(`suite: [${suites.join(", ")}]`);
    }
    expect(ios).toContain('".maestro/ci/app-$' + '{{ matrix.suite }}.yaml"');
    expect(android).toContain(
      '"$RUNNER_TEMP/screenshots/android" light $' + "{{ matrix.suite }}\n",
    );
    expect(verification).toContain("suite=$" + "{5:-}\n");
    expect(verification).toContain("flow=.maestro/ci/app-$suite.yaml\n");
    expect(readdirSync(repositoryPath(".maestro/ci")).sort()).toEqual(
      [...suites.map((name) => `app-${name}.yaml`), "screenshots.yaml"].sort(),
    );
    expect(flows.map(([, flow, platform]) => `${platform} ${flow}`).sort()).toEqual([
      "Android ../flows/swipe-mark-and-stop.yaml",
      "iOS ../flows/returning-user-app-idle.yaml",
    ]);
  });

  it("checks the Android tab bar after the suite that ends on it", () => {
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");
    const activity = readFileSync(repositoryPath(".maestro/ci/app-activity.yaml"), "utf8");

    expect(activity.trimEnd().split("\n").at(-1)).toBe("- runFlow: ../flows/account.yaml");
    expect(verification).toMatch(
      /^if \[ "\$suite" = activity \]; then\n {2}adb shell \w+ dump[\s\S]*check-label-fit\.mjs[\s\S]*cue_tab_\$icon[\s\S]*\nelif /m,
    );
  });

  it("passes the Android aggregate only when every light shard passed or device lanes were skipped", () => {
    const aggregate = job("android-e2e");
    const rollup = aggregate.match(/^ {8}run: (.+)$/m)?.[1] ?? "exit 0";
    const status = (DEVICES: string, SHARDS: string) =>
      spawnSync("bash", ["-c", rollup], { env: { DEVICES, SHARDS } }).status;

    expect(aggregate).toContain(
      "needs: [fingerprint, android-e2e-light, ui-screenshots-android-dark]",
    );
    expect(aggregate).toContain("if: $" + "{{ always() }}");
    expect(aggregate).toContain("DEVICES: $" + "{{ needs.fingerprint.outputs.devices }}");
    expect(aggregate).toContain("SHARDS: $" + "{{ needs.android-e2e-light.result }}");
    expect(status("true", "success")).toBe(0);
    expect(status("false", "skipped")).toBe(0);
    expect(status("true", "skipped")).toBe(1);
    expect(status("", "skipped")).toBe(1);
    expect(status("true", "failure")).toBe(1);
    expect(status("false", "failure")).toBe(1);
    expect(status("true", "cancelled")).toBe(1);
  });

  it("runs required dark screenshot traversals on independent cached-app jobs", () => {
    const ios = job("ui-screenshots-ios-dark");
    const android = job("ui-screenshots-android-dark");

    expect(ios).toContain("needs: [fingerprint, native-ios, maestro-runner]");
    expect(ios).toContain("actions/download-artifact@70fc10c6e5e1ce46ad2ea6f2b72d43f7d47b13c3");
    expect(ios).toContain("name: cue-native-ios-$" + "{{ needs.fingerprint.outputs.ios }}");
    expect(ios).toContain(" .maestro/ci/screenshots.yaml \\\n");
    expect(ios).not.toContain("continue-on-error");
    expect(android).toContain("needs: [fingerprint, native-android]");
    expect(android).toContain(
      "cue-native-android-$" + "{{ needs.native-android.outputs.fingerprint }}",
    );
    expect(android).toContain('"$RUNNER_TEMP/screenshots/android" dark');
    expect(android).not.toContain("continue-on-error");
  });

  it.each([
    "android-e2e-light",
    "ui-screenshots-android-dark",
  ])("%s boots a fresh emulator and pins its display before capturing", (name) => {
    const emulators = job(name)
      .split(/^ {6}- /m)
      .filter((step) => step.includes("reactivecircus/android-emulator-runner@"));
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    const caches = steps(name).filter((step) => step.includes("actions/cache@"));
    expect(caches.map((step) => step.match(/^ {10}path: (.+)$/m)?.[1])).toEqual([
      "$" + "{{ runner.temp }}/maestro",
    ]);
    expect(emulators).toHaveLength(1);
    expect(emulators[0]).toContain(
      "emulator-options: -no-snapshot -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim\n",
    );
    expect(emulators[0]).not.toContain("force-avd-creation");
    expect(verification).toMatch(
      /wm density reset\nnode scripts\/pin-android-display\.mjs "\$output\/window-displays\.txt"\n\nmock_pid=/,
    );
  });

  it.each([
    "android-e2e-light",
    "ui-screenshots-android-dark",
  ])("%s restores the emulator and the system image it boots, and no AVD", (name) => {
    const runner = steps(name).find((step) =>
      step.includes("reactivecircus/android-emulator-runner@"),
    );
    const option = (key: string) => runner?.match(new RegExp(`^ {10}${key}: (.+)$`, "m"))?.[1];
    const image = `android-${option("api-level")};${option("target") ?? "default"};${option("arch")}`;
    const action = readFileSync(
      repositoryPath(".github/actions/android-emulator/action.yml"),
      "utf8",
    );
    const script = readFileSync(repositoryPath("scripts/android-emulator-packages.sh"), "utf8");

    expect(job(name)).toContain(
      "      - uses: ./.github/actions/android-emulator\n      - name: Inspect the release UI\n",
    );
    expect(script).toContain(`image="system-images;${image}"\n`);
    const cached = ["emulator", `system-images/${image.replaceAll(";", "/")}`];
    const paths = [...action.matchAll(/^ {10}\$\{\{ steps\.packages\.outputs\.sdk \}\}\/(.+)$/gm)];
    expect(paths.map(([, directory]) => directory)).toEqual([...cached, ...cached]);
  });

  it("waits for persistent readiness before checking the connected loading state", () => {
    const ready = readFileSync(repositoryPath(".maestro/flows/lib/ready.yaml"), "utf8");

    expect(ready).toMatch(/screen-up-next[\s\S]*app-ready[\s\S]*up-next-skeleton/);
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

  it("uses a fixed Maestro driver port outside both platforms' ephemeral ranges", () => {
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");

    expect(verification.match(/--driver-host-port 7001/g)).toHaveLength(1);
    for (const name of IOS_LANES) {
      expect(job(name)).toContain('      MAESTRO_RUNNER_PORT: "7001"\n');
      expect(job(name).match(/--driver-host-port "\$MAESTRO_RUNNER_PORT"/g)).toHaveLength(1);
    }
  });

  it("fails the aggregate whenever the rollup script fails", () => {
    const aggregate = job("native-e2e");

    expect(aggregate).toContain(
      "    needs:\n      - fingerprint\n      - native-ios\n      - native-e2e-ios-light\n      - ui-screenshots-ios-dark\n",
    );
    expect(aggregate).toContain("HIT: $" + "{{ needs.fingerprint.outputs.ios-cached }}");
    expect(aggregate).toContain("if: $" + "{{ always() }}");
    expect(aggregate).toContain("OWED: $" + "{{ needs.fingerprint.outputs.ios-owed }}");
    expect(aggregate).toContain("DEVICES: $" + "{{ needs.fingerprint.outputs.devices }}");
    expect(aggregate).toContain("USER_FACING: $" + "{{ needs.fingerprint.outputs.user-facing }}");
    expect(aggregate).toMatch(/^ {8}run: node scripts\/native-e2e-rollup\.mjs$/m);
    expect(aggregate).not.toContain("continue-on-error");
    expect(aggregate).not.toMatch(/\|\|\s*true\s*$/m);
  });

  it.each([
    ["native-e2e", "native-ios", "native-e2e-ios-light", "ui-screenshots-ios-dark"],
    ["android-e2e", "native-android", "android-e2e-light", "ui-screenshots-android-dark"],
  ])("%s depends on and refuses reruns of every device job it vouches for", (aggregate, ...lanes) => {
    const body = job(aggregate);
    const refusal = body.match(/^ {8}run: scripts\/require-first-attempt-pass\.sh (.+)$/m)?.[1];
    const needsOf = (name: string): string[] => {
      const [, inline, block] =
        job(name).match(/^ {4}needs:(?: \[?([^\]\n]*)\]?|\n((?: {6}- .*\n)+))/m) ?? [];
      return inline?.split(", ") ?? block?.match(/[\w-]+$/gm) ?? [];
    };
    const upstream = (name: string): string[] => [name, ...needsOf(name).flatMap(upstream)];

    expect(refusal?.split(" ")).toEqual(lanes);
    expect(body).toContain("      actions: read\n");
    expect(body).toContain("GH_TOKEN: $" + "{{ github.token }}");
    for (const lane of lanes) expect(needsOf(aggregate).flatMap(upstream)).toContain(lane);
  });

  it("publishes every screenshot artifact for 14 days", () => {
    const ios = job("native-e2e-ios-light");
    const iosDark = job("ui-screenshots-ios-dark");
    const android = job("android-e2e-light");
    const androidDark = job("ui-screenshots-android-dark");
    const verification = readFileSync(repositoryPath("scripts/verify-android-ui.sh"), "utf8");
    const fetch = readFileSync(repositoryPath("scripts/fetch-ui-screenshots.sh"), "utf8");

    expect(ios).toContain("name: ui-screenshots-ios-light-$" + "{{ matrix.suite }}");
    expect(iosDark).toContain("name: ui-screenshots-ios-dark");
    expect(android).toContain("name: ui-screenshots-android-light-$" + "{{ matrix.suite }}");
    expect(androidDark).toContain("name: ui-screenshots-android-dark");
    expect(ios).toContain('--test-output-dir "$output"');
    expect(iosDark).toContain('--test-output-dir "$RUNNER_TEMP/screenshots/ios/dark"');
    expect(verification).toContain('--test-output-dir "$screenshots/$appearance"');
    for (const producer of [ios, iosDark, android, androidDark]) {
      expect(producer.match(/retention-days: 14/g)).toHaveLength(1);
      const screenshot = producer
        .split(/^ {6}- /m)
        .find((step) => step.includes("name: ui-screenshots-"));
      expect(screenshot).toContain("compression-level: 0\n");
      expect(screenshot).toMatch(
        /^ {10}path: \$\{\{ runner\.temp \}\}\/screenshots\/.+\/\*\*\/takeScreenshot\/\*\.png\n/m,
      );
      const debug = producer
        .split(/^ {6}- /m)
        .find((step) => /name: (?:native|android)-e2e-/.test(step));
      expect(debug).toMatch(
        /^ {12}\$\{\{ runner\.temp \}\}\/screenshots\/\n {12}!\$\{\{ runner\.temp \}\}\/screenshots\/\*\*\/takeScreenshot\/\*\.png\n/m,
      );
    }
    expect(fetch).toContain("--pattern 'ui-*'");
  });

  it("runs only the fast checks and the Android build on draft pull requests", () => {
    const deviceJobs = ["android-e2e-light", "ui-screenshots-android-dark"];
    const iosJobs = ["native-ios", "native-e2e-ios-light", "ui-screenshots-ios-dark"];
    const jobs = [...workflow.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map(([, name]) => name ?? "");
    const gated = jobs.filter((name) =>
      job(name).includes("needs.fingerprint.outputs.devices == 'true'"),
    );

    expect(workflow).toContain(
      "pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\n",
    );
    expect(job("fingerprint")).toContain(
      "devices: $" +
        "{{ github.event_name != 'pull_request' || !github.event.pull_request.draft && " +
        "steps.head-tree.outputs.pushed != 'true' }}\n",
    );
    for (const name of deviceJobs) {
      expect(job(name)).toMatch(/^ {4}if: needs\.fingerprint\.outputs\.devices == 'true'$/m);
    }
    expect(job("native-ios")).toMatch(
      /^ {4}if: needs\.fingerprint\.outputs\.devices == 'true' && needs\.fingerprint\.outputs\.ios-cached != 'true'$/m,
    );
    expect(gated.sort()).toEqual([...deviceJobs, ...iosJobs, "pr-media"].sort());
    for (const name of ["check", "native-android", "footprint", "audit", "actionlint"]) {
      expect(job(name)).not.toContain("devices");
    }
    expect(job("maestro-runner")).toMatch(
      /^ {4}if: github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.draft$/m,
    );
    expect(job("maestro-runner")).not.toMatch(/^ {4}needs:/m);
  });

  it("leaves device lanes to the push run only for a pushed branch whose merge tree is its head tree", () => {
    const step =
      job("fingerprint")
        .split(/^ {6}- /m)
        .find((entry) => entry.startsWith("id: head-tree\n")) ?? "";
    const pushBranches = workflow.match(/^ {2}push:\n(?: {4}#.*\n)* {4}branches: \[(.*)\]$/m)?.[1];
    const condition = step.match(/ {8}if: >-\n((?: {10}.*\n)+)/)?.[1]?.replace(/\s+/g, " ") ?? "";
    const script = step.match(/ {8}run: \|\n((?: {10}.*\n)+)/)?.[1]?.replace(/^ {10}/gm, "") ?? "";
    const repository = tempDirectory("cue-head-tree-");
    const bin = tempDirectory("cue-head-tree-bin-");
    git(repository, "init", "--quiet", "--initial-branch=main");
    git(repository, "config", "user.name", "Cue Tests");
    git(repository, "config", "user.email", "cue-tests@example.invalid");
    commit(repository, "base");
    git(repository, "switch", "--quiet", "-c", "topic");
    const head = commit(repository, "topic");
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh\ngit rev-parse "${head}^{tree}"\n`, {
      mode: 0o755,
    });
    const pushed = () => {
      const output = path.join(repository, "..", `${path.basename(repository)}-output`);
      writeFileSync(output, "");
      execFileSync("bash", ["-e", "-c", script], {
        cwd: repository,
        env: { ...gitEnv(), PATH: `${bin}:${process.env["PATH"]}`, GITHUB_OUTPUT: output },
      });
      return readFileSync(output, "utf8");
    };
    const mergeOnto = (base: string) => {
      git(repository, "switch", "--quiet", "--detach", base);
      git(repository, "merge", "--quiet", "--no-ff", "-m", "merge", "topic");
    };

    expect(pushBranches?.split(", ").map((branch) => branch.replace(/"/g, ""))).toEqual([
      "main",
      "feat/expo-native",
      "release/*",
    ]);
    expect(condition).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository && " +
        "(github.head_ref == 'main' || github.head_ref == 'feat/expo-native' || " +
        "startsWith(github.head_ref, 'release/'))",
    );
    mergeOnto("main");
    expect(pushed()).toBe("pushed=true\n");
    git(repository, "switch", "--quiet", "main");
    commit(repository, "moved");
    mergeOnto("main");
    expect(pushed()).toBe("");
  });

  it("runs the iOS flow lane on pushes, nightly, iOS fingerprint changes, owed lanes, and user-facing pull requests", () => {
    const iosLane = [
      "    if: >-",
      "      !cancelled() && needs.fingerprint.outputs.devices == 'true' &&",
      "      (needs.native-ios.result == 'success' || needs.native-ios.result == 'skipped') &&",
      "      needs.maestro-runner.result == 'success' &&",
      "      (github.event_name != 'pull_request' || needs.fingerprint.outputs.ios-cached != 'true' ||",
      "      needs.fingerprint.outputs.ios-owed == 'true' || needs.fingerprint.outputs.user-facing == 'true')\n",
    ].join("\n");
    const jobs = [...workflow.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map(([, name]) => name ?? "");
    const gated = jobs.filter((name) => job(name).includes(iosLane));
    const cache = job("fingerprint")
      .split(/^ {6}- /m)
      .find((step) => step.startsWith("id: ios-cache\n"));

    expect(workflow).toContain('- cron: "0 6 * * *"');
    expect(job("native-ios")).not.toContain("outputs:");
    expect(job("fingerprint")).toContain("ios-cached: $" + "{{ steps.ios-cache.outputs.hit }}");
    expect(cache).toContain("        if: github.event_name == 'pull_request'\n");
    expect(cache).toContain("ARTIFACT_NAME: cue-native-ios-$" + "{{ steps.native.outputs.ios }}\n");
    expect(cache).toContain(
      'if scripts/download-ci-artifact.sh "$ARTIFACT_NAME" "$RUNNER_TEMP/native-ios-app" native-ios; then\n            echo "hit=true" >> "$GITHUB_OUTPUT"\n',
    );
    expect(job("fingerprint")).toContain("ios-owed: $" + "{{ steps.ios-owed.outputs.owed }}");
    expect(job("fingerprint")).toContain(
      "user-facing: $" + "{{ steps.changes.outputs.user-facing }}",
    );
    expect(job("fingerprint")).toContain("actions/workflows/ci.yml/runs?branch=$BRANCH");
    expect(gated.sort()).toEqual(["native-e2e-ios-light", "ui-screenshots-ios-dark"].sort());
    expect(job("native-android")).not.toMatch(/^ {4}if:/m);
  });

  it("bundles the cached app's JavaScript once, with the env the simulator build embeds", () => {
    const fingerprint = steps("fingerprint");
    const bundle = fingerprint.find((step) => step.includes("scripts/bundle-ios.sh")) ?? "";
    const upload = fingerprint.find((step) => step.includes("actions/upload-artifact@")) ?? "";
    const native = steps("native-ios");
    const build = native.find((step) => step.includes("name: Build the app for the simulator"));
    const embed = native.find((step) => step.includes("scripts/reembed-ios.sh")) ?? "";
    const hit = "if: steps.ios-cache.outputs.hit == 'true'\n";

    expect(bundle.startsWith(hit)).toBe(true);
    expect(upload.startsWith(hit)).toBe(true);
    expect(fingerprint.indexOf(bundle)).toBeGreaterThan(
      fingerprint.findIndex((step) => step.startsWith("id: ios-cache\n")),
    );
    expect(envOf(build ?? "")).toContain("EXPO_PUBLIC_UI_HARNESS");
    expect(envOf(bundle)).toBe(envOf(build ?? ""));
    expect(envOf(embed)).toBe(envOf(build ?? ""));
    expect(bundle).toContain('run: scripts/bundle-ios.sh "$RUNNER_TEMP/ios-bundle"\n');
    expect(embed).toContain(
      'scripts/bundle-ios.sh "$RUNNER_TEMP/ios-bundle"\n' +
        '          scripts/reembed-ios.sh "$RUNNER_TEMP/native-ios-app/Cue.app" "$RUNNER_TEMP/ios-bundle"\n',
    );
    expect(upload).toContain(`name: ${HARNESS_BUNDLE}\n`);
    expect(upload).toContain("path: $" + "{{ runner.temp }}/ios-bundle\n");
  });

  it.each(
    IOS_LANES,
  )("%s installs the app native-ios built, or the cached app with the bundle from fingerprint", (name) => {
    const lane = steps(name);
    const built = "if: needs.native-ios.result == 'success'\n";
    const cached = "if: needs.native-ios.result == 'skipped'\n";
    const index = (text: string) => lane.findIndex((step) => step.includes(text));
    const downloads = lane.filter((step) => step.includes("uses: actions/download-artifact@"));
    const embed = lane[index("name: Embed the harness JavaScript")] ?? "";

    expect(job(name)).not.toMatch(/setup-node|pnpm|npx|tar -czf/);
    expect(downloads.map((step) => step.slice(0, step.indexOf("\n") + 1))).toEqual([
      built,
      cached,
      expect.stringMatching(/^uses: actions\/download-artifact@/),
    ]);
    expect(downloads[2]).toContain("name: maestro-runner$" + "{{ inputs.copy }}\n");
    expect(downloads[0]).toContain(
      "name: cue-native-ios-$" + "{{ needs.fingerprint.outputs.ios }}$" + "{{ inputs.copy }}\n",
    );
    expect(downloads[1]).toContain(`name: ${HARNESS_BUNDLE}\n`);
    expect(downloads[1]).toContain("path: $" + "{{ runner.temp }}/ios-bundle\n");
    expect(lane[index("name: Unpack the simulator app")]).toBe(
      `${built}        name: Unpack the simulator app\n` +
        '        run: tar -xzf "$RUNNER_TEMP/native-ios-app/Cue.app.tgz" -C "$RUNNER_TEMP/native-ios-app"\n',
    );
    expect(embed.startsWith(cached)).toBe(true);
    expect(embed).toContain(
      "ARTIFACT_NAME: cue-native-ios-$" + "{{ needs.fingerprint.outputs.ios }}\n",
    );
    expect(embed).toMatch(
      /scripts\/download-ci-artifact\.sh "\$ARTIFACT_NAME" "\$RUNNER_TEMP\/native-ios-app" native-ios\n +tar -xzf "\$RUNNER_TEMP\/native-ios-app\/Cue\.app\.tgz" -C "\$RUNNER_TEMP\/native-ios-app"\n +scripts\/reembed-ios\.sh "\$RUNNER_TEMP\/native-ios-app\/Cue\.app" "\$RUNNER_TEMP\/ios-bundle"\n +LC_ALL=C grep -aq 'http:\/\/127\.0\.0\.1:8787' "\$RUNNER_TEMP\/native-ios-app\/Cue\.app\/main\.jsbundle"\n/,
    );
    expect(index("name: Boot the simulator")).toBeLessThan(index("actions/download-artifact@"));
    expect(lane.indexOf(downloads[1] ?? "")).toBeLessThan(index("name: Embed"));
    expect(index("name: Unpack")).toBeLessThan(index("scripts/prepare-ios-ui.sh"));
    expect(index("name: Embed")).toBeLessThan(index("scripts/prepare-ios-ui.sh"));
  });

  it("runs the iOS lanes on the runner's own Node, with Node built-ins only", () => {
    const scriptsIn = (source: string, pattern: RegExp) =>
      [...source.matchAll(pattern)].map(([, script = ""]) => repositoryPath(`scripts/${script}`));
    const dependencies = (file: string): string[] => {
      const source = readFileSync(file, "utf8");
      if (file.endsWith(".sh")) {
        expect(source, file).not.toMatch(/\b(?:pnpm|npx|npm)\b/);
        return scriptsIn(source, /(?:\$\(dirname "\$0"\)\/|\bscripts\/)([\w/-]+\.(?:sh|mjs))/g);
      }
      const specifiers = [
        ...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)"([^"]+)"/g),
      ].map(([, specifier = ""]) => specifier);
      const relative = specifiers.filter((specifier) => specifier.startsWith("."));
      for (const specifier of specifiers) {
        if (!relative.includes(specifier)) expect(specifier, file).toMatch(/^node:/);
      }
      return relative.map((specifier) => path.resolve(path.dirname(file), specifier));
    };
    const reached = new Set<string>();
    const visit = (file: string): void => {
      if (reached.has(file)) return;
      reached.add(file);
      dependencies(file).forEach(visit);
    };
    for (const name of IOS_LANES) {
      scriptsIn(job(name), /\bscripts\/([\w/-]+\.(?:sh|mjs))/g).forEach(visit);
    }

    expect(
      [...reached].map((file) => path.relative(repositoryPath("scripts"), file)).sort(),
    ).toEqual([
      "check-runner-survives-freeze.sh",
      "check-tap-lead-in.mjs",
      "disable-ios-daemons.sh",
      "disable-spotlight.sh",
      "download-ci-artifact.sh",
      "enable-ios-accessibility.sh",
      "lane-health.mjs",
      "maestro-failure.mjs",
      "maestro-runner.mjs",
      "maestro-supervisor.mjs",
      "maestro-test.sh",
      "mock-trakt/faults.mjs",
      "mock-trakt/genres.mjs",
      "mock-trakt/journal.mjs",
      "mock-trakt/scale.mjs",
      "mock-trakt/seed.mjs",
      "mock-trakt/server.mjs",
      "prepare-ios-ui.sh",
      "reembed-ios.sh",
      "simulator-touch.mjs",
      "snapshot-host-resources.sh",
      "start-ready-process.mjs",
      "tap-proxy.mjs",
      "wait-ios-accessibility.mjs",
      "wait-ios-ready.mjs",
    ]);
  });

  it("bounds every native job by its measured duration plus headroom", () => {
    const timeouts = Object.fromEntries(
      [
        "native-ios",
        "native-e2e-ios-light",
        "ui-screenshots-ios-dark",
        "android-e2e-light",
        "ui-screenshots-android-dark",
      ].map((name) => [name, Number(job(name).match(/^ {4}timeout-minutes: (\d+)$/m)?.[1])]),
    );

    expect(timeouts).toEqual({
      "native-ios": 75,
      "native-e2e-ios-light": 22,
      "ui-screenshots-ios-dark": 23,
      "android-e2e-light": 14,
      "ui-screenshots-android-dark": 7,
    });
  });

  it("settles animations before every shared screenshot", () => {
    const flows = [
      "lib/sign-in.yaml",
      "account.yaml",
      "history.yaml",
      "navigation-round-trips.yaml",
      "launch.yaml",
      "up-next-mark-and-undo.yaml",
      "show-detail-bulk-mark.yaml",
      "episode-sheet.yaml",
      "calendar.yaml",
      "library.yaml",
      "tabs.yaml",
      "dark-traversal.yaml",
      "large-text.yaml",
    ];
    for (const flow of flows) {
      const lines = readFileSync(repositoryPath(`.maestro/flows/${flow}`), "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.includes("takeScreenshot:")) {
          expect(["- waitForAnimationToEnd", "- runFlow: lib/scroll-to-end.yaml"]).toContain(
            lines[index - 1]?.trim(),
          );
        }
      }
    }
  });

  it("waits for the header's avatar or more-actions menu before capturing a screen with it", () => {
    const landed = readFileSync(repositoryPath(".maestro/flows/lib/ready.yaml"), "utf8")
      .split("\n")
      .some((line, index, lines) => HEADER_WAITS.avatar.test(`${lines[index - 1]}\n${line}`));
    const early = readdirSync(repositoryPath(".maestro/flows"), {
      recursive: true,
      encoding: "utf8",
    })
      .filter((name) => name.endsWith(".yaml"))
      .flatMap((flow) => {
        let ready: HeaderReady = { avatar: false, menu: false };
        return readFileSync(repositoryPath(`.maestro/flows/${flow}`), "utf8")
          .split("\n")
          .flatMap((line, index, lines) => {
            ready = headerReady(ready, `${lines[index - 1]}\n${line}`, landed);
            const name = line.match(/- takeScreenshot: (\S+)/)?.[1] ?? "";
            const kind = HEADER_KINDS.find(([prefix]) => prefix.test(name))?.[1];
            return kind && !ready[kind] ? [`${flow}: ${name}`] : [];
          });
      });

    expect(landed).toBe(true);
    expect(early).toEqual([]);
  });

  it("waits for the iOS search field to stop editing before a capture that follows typing", () => {
    const endsEditing = /^ +notVisible: "\(\?i\)(?:close\|cancel|delete)"$/;
    const flows = readdirSync(repositoryPath(".maestro/flows")).filter((name) =>
      name.endsWith(".yaml"),
    );
    const unsettled = flows.flatMap((flow) => {
      let editing = false;
      return readFileSync(repositoryPath(`.maestro/flows/${flow}`), "utf8")
        .split("\n")
        .flatMap((line) => {
          if (line.includes("- inputText:")) editing = true;
          if (endsEditing.test(line) || /lib\/relaunch\.yaml|- launchApp/.test(line))
            editing = false;
          return editing && line.includes("takeScreenshot:") ? [`${flow}: ${line.trim()}`] : [];
        });
    });
    const library = readFileSync(repositoryPath(".maestro/flows/library.yaml"), "utf8");

    expect(unsettled).toEqual([]);
    expect(library).toMatch(
      /- assertVisible: "\(\?i\)delete"\n- pressKey: Enter\n[\s\S]*?notVisible: "\(\?i\)delete"\n[\s\S]*?- takeScreenshot: library-no-match\n/,
    );
  });

  it("keeps the dark pass to a shared visit and screenshot traversal", () => {
    const suite = readFileSync(repositoryPath(".maestro/ci/screenshots.yaml"), "utf8");
    const traversal = readFileSync(repositoryPath(".maestro/flows/dark-traversal.yaml"), "utf8");
    const signIn = readFileSync(repositoryPath(".maestro/flows/lib/sign-in.yaml"), "utf8");

    expect(suite).toContain("runFlow: ../flows/dark-traversal.yaml");
    expect(traversal).toMatch(/file: lib\/connect\.yaml\n\s+env:\n\s+CAPTURE_AUTH: "true"/);
    expect(traversal).not.toMatch(/^\s*- assert/m);
    expect(traversal).not.toMatch(/id: "(?!season-check-).*(?:mark|check)/);
    expect(traversal.match(/id: "season-check-/g)?.length).toBe(
      traversal.match(/tapOn: "\(\?i\)cancel"/g)?.length,
    );
    expect(`${signIn}${traversal}`.match(/takeScreenshot:/g)?.length).toBe(12);
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
