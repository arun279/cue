import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

const LIST = readFileSync(repositoryPath("scripts/ios-disabled-daemons.tsv"), "utf8");
const DAEMONS = LIST.trimEnd()
  .split("\n")
  .map((row) => row.split("\t")[0] ?? "");

function daemons(args: string[], listings: string[] = []) {
  const root = tempDirectory("cue-ios-daemons-");
  const calls = path.join(root, "calls");
  writeFileSync(
    path.join(root, "PlistBuddy"),
    `#!/bin/sh
echo "PlistBuddy $*" >> "${calls}"
case "$2" in
  Set*) grep -qxF "$2" "$3.keys" 2>/dev/null ;;
  Add*) echo "Set \${2#Add }" | sed 's/ bool / /' >> "$3.keys" ;;
esac
`,
    { mode: 0o755 },
  );
  for (const [index, listing] of listings.entries()) {
    writeFileSync(path.join(root, `listing-${index}`), `PID\tStatus\tLabel\n${listing}`);
  }
  writeFileSync(
    path.join(root, "xcrun"),
    `#!/bin/sh
echo "xcrun $*" >> "${calls}"
case "$*" in *"launchctl list")
  count=$(grep -c "launchctl list" "${calls}")
  cat "${root}/listing-$((count - 1))" 2>/dev/null || exit 3 ;;
esac
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [repositoryPath("scripts/disable-ios-daemons.sh"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${root}:${process.env["PATH"]}`,
      DISABLED_STORE_ROOT: root,
    },
  });
  const made = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  return { root, result, calls: made };
}

describe("disable-ios-daemons.sh", () => {
  it("lists each daemon once with the reason the lanes do without it", () => {
    const rows = LIST.trimEnd()
      .split("\n")
      .map((row) => row.split("\t"));

    expect(rows.every((row) => row.length === 2 && /^com\.apple\.[\w.]+$/.test(row[0] ?? ""))).toBe(
      true,
    );
    expect(rows.every(([, reason]) => /\.$/.test(reason ?? "") && (reason ?? "").length > 40)).toBe(
      true,
    );
    expect(new Set(DAEMONS).size).toBe(DAEMONS.length);
    expect(DAEMONS).toEqual(
      expect.arrayContaining(["com.apple.apsd", "com.apple.chronod", "com.apple.passd"]),
    );
  });

  it("disables every listed daemon in the device's launchd store before boot", () => {
    const { root, result, calls } = daemons(["TEST-UDID"]);
    const plist = path.join(root, "com.apple.CoreSimulator.SimDevice.TEST-UDID/disabled.plist");

    expect(result.status, result.stderr).toBe(0);
    expect(calls).toEqual(
      DAEMONS.flatMap((label) => [
        `PlistBuddy -c Set :${label} true ${plist}`,
        `PlistBuddy -c Add :${label} bool true ${plist}`,
      ]),
    );
  });

  it("passes the booted gate without touching launchd when no listed daemon is loaded", () => {
    const listing = "1\t0\tcom.apple.backboardd\n";
    const { result, calls } = daemons(["TEST-UDID", "--booted"], [listing, listing]);

    expect(result.status, result.stderr).toBe(0);
    expect(calls).toEqual(Array(2).fill("xcrun simctl spawn TEST-UDID launchctl list"));
  });

  it("disables and boots out a daemon that ignored the store, then checks again", () => {
    const { result, calls } = daemons(
      ["TEST-UDID", "--booted"],
      ["4412\t0\tcom.apple.apsd\n1\t0\tcom.apple.backboardd\n", "1\t0\tcom.apple.backboardd\n"],
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("com.apple.apsd ignored the pre-boot override");
    expect(calls).toEqual([
      "xcrun simctl spawn TEST-UDID launchctl list",
      "xcrun simctl spawn TEST-UDID launchctl disable system/com.apple.apsd",
      "xcrun simctl spawn TEST-UDID launchctl bootout system/com.apple.apsd",
      "xcrun simctl spawn TEST-UDID launchctl list",
    ]);
  });

  it.each([
    ["a daemon is still loaded", ["-\t0\tcom.apple.chronod\n", "-\t0\tcom.apple.chronod\n"]],
    ["launchd cannot be listed", []],
  ])("fails the booted gate when %s", (_, listings) => {
    const { result } = daemons(["TEST-UDID", "--booted"], listings);

    expect(result.status).not.toBe(0);
    if (listings.length > 0) {
      expect(result.stderr).toContain(
        "Simulator daemons still loaded after disabling them: com.apple.chronod",
      );
    }
  });
});

describe("iOS lanes", () => {
  const lanes = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(({ body }) =>
    body.includes("xcrun simctl boot"),
  );

  it("disable the daemons before booting and record host resources after every flow", () => {
    expect(lanes.map(({ name }) => name)).toEqual([
      "native-e2e-ios-light",
      "ui-screenshots-ios-dark",
    ]);
    for (const { body } of lanes) {
      expect(body).toContain(
        '          scripts/disable-ios-daemons.sh "$device_id"\n          xcrun simctl boot "$device_id"\n',
      );
      const flow = body.indexOf("bash scripts/maestro-test.sh");
      const snapshot = body.indexOf(
        "      - name: Record host resources after the flow\n        if: $" +
          "{{ always() }}\n" +
          '        run: scripts/snapshot-host-resources.sh "$RUNNER_TEMP/host-resources-after-flow.txt"\n',
      );
      expect(snapshot).toBeGreaterThan(flow);
      expect(body).toContain("$" + "{{ runner.temp }}/host-resources-*.txt\n");
    }
  });
});

describe("disable-spotlight.sh", () => {
  const spotlight = ({ off = 0, check = 0, status = "Indexing disabled." } = {}) => {
    const root = tempDirectory("cue-spotlight-");
    const calls = path.join(root, "calls");
    writeFileSync(
      path.join(root, "sudo"),
      `#!/bin/sh\necho "sudo $*" >> "${calls}"\necho "mdutil disabling Spotlight: / -> kMDConfigSearchLevelFSSearchOnly" >&2\nexit ${off}\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      path.join(root, "mdutil"),
      `#!/bin/sh\necho "mdutil $*" >> "${calls}"\nprintf '/:\\n\\t%s\\n' "${status}"\nexit ${check}\n`,
      { mode: 0o755 },
    );
    const result = spawnSync("bash", [repositoryPath("scripts/disable-spotlight.sh")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${root}:${process.env["PATH"]}` },
    });
    return { result, calls: readFileSync(calls, "utf8").trim().split("\n") };
  };

  it("turns Spotlight indexing off on every volume and checks the startup volume quietly", () => {
    const { result, calls } = spotlight();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    expect(calls).toEqual(["sudo mdutil -a -i off", "mdutil -s /"]);
  });

  it.each([
    [
      "the startup volume still indexes",
      { status: "Indexing enabled." },
      "::warning title=Spotlight::Spotlight indexing is not confirmed off for / (mdutil -s / exited 0): /:  Indexing enabled.\n",
    ],
    [
      "the status check itself fails",
      { check: 1, status: "Error: unknown indexing state." },
      "::warning title=Spotlight::Spotlight indexing is not confirmed off for / (mdutil -s / exited 1): /:  Error: unknown indexing state.\n",
    ],
    [
      "the status check exits non-zero after reporting the volume off",
      { check: 1, status: "Indexing disabled." },
      "::warning title=Spotlight::Spotlight indexing is not confirmed off for / (mdutil -s / exited 1): /:  Indexing disabled.\n",
    ],
    [
      "turning indexing off fails",
      { off: 1 },
      "::warning title=Spotlight::sudo mdutil -a -i off exited 1: mdutil disabling Spotlight: / -> kMDConfigSearchLevelFSSearchOnly\n",
    ],
  ])("warns without failing the lane when %s", (_, outcome, warning) => {
    const { result } = spotlight(outcome);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(warning);
  });

  it("runs while the iOS lanes prepare the simulator, before Maestro starts", () => {
    const prepare = readFileSync(repositoryPath("scripts/prepare-ios-ui.sh"), "utf8");

    expect(prepare.indexOf("scripts/disable-spotlight.sh\n")).toBeGreaterThan(
      prepare.indexOf("xcrun simctl bootstatus"),
    );
  });
});
