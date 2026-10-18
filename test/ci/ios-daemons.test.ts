import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

const DAEMONS = ["com.apple.apsd", "com.apple.chronod"];

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
  it("disables apsd and chronod in the device's launchd store before boot", () => {
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

  it("passes the booted gate without touching launchd when neither daemon is loaded", () => {
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
