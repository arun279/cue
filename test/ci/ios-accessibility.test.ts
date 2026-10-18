import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { waitForAccessibility } from "../../scripts/wait-ios-accessibility.mjs";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

afterEach(() => vi.unstubAllEnvs());

const SERVER = "UIKitApplication:com.apple.accessibility.AccessibilityUIServer[a1b2][rb-legacy]";

function launchctl(listings: string[]) {
  const directory = tempDirectory("cue-ios-ax-");
  const calls = path.join(directory, "calls");
  writeFileSync(path.join(directory, "listings.json"), JSON.stringify(listings));
  writeFileSync(
    path.join(directory, "xcrun"),
    `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.PROBE_CALLS, process.argv.slice(2).join(' ') + '\\n');
const count = fs.readFileSync(process.env.PROBE_CALLS, 'utf8').trim().split('\\n').length;
const listings = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(directory, "listings.json"))}, 'utf8'));
process.stdout.write('PID\\tStatus\\tLabel\\n' + listings[Math.min(count, listings.length) - 1]);
`,
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", `${directory}:${process.env["PATH"]}`);
  vi.stubEnv("PROBE_CALLS", calls);
  return calls;
}

it("waits until the accessibility server runs in the simulator", async () => {
  const calls = launchctl([
    "41\t0\tcom.apple.SpringBoard\n",
    `-\t0\t${SERVER}\n`,
    `41\t0\tcom.apple.SpringBoard\n87\t0\t${SERVER}\n`,
  ]);

  await waitForAccessibility("test-device", { timeoutMs: 5_000 });

  expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(
    Array(3).fill("simctl spawn test-device launchctl list"),
  );
});

it("does not count a loaded but stopped accessibility server as ready", async () => {
  launchctl([`-\t0\t${SERVER}\n`]);

  await expect(waitForAccessibility("test-device", { timeoutMs: 500 })).rejects.toThrow(
    "iOS accessibility watchdog expired after 500 ms for test-device",
  );
});

it("kills a stuck listing under the single watchdog", async () => {
  const directory = tempDirectory("cue-ios-ax-stuck-");
  writeFileSync(path.join(directory, "xcrun"), "#!/bin/sh\nexec sleep 10\n", { mode: 0o755 });
  vi.stubEnv("PATH", `${directory}:${process.env["PATH"]}`);
  const started = performance.now();

  await expect(waitForAccessibility("test-device", { timeoutMs: 200 })).rejects.toThrow(
    "iOS accessibility watchdog expired",
  );
  expect(performance.now() - started).toBeLessThan(2_000);
});

it("waits for accessibility after the appearance probe, before Maestro starts", () => {
  const ready = readFileSync(repositoryPath("scripts/wait-ios-ready.mjs"), "utf8");
  const prepare = readFileSync(repositoryPath("scripts/prepare-ios-ui.sh"), "utf8");

  expect(ready).toMatch(
    /\n {2}await waitForIOS\(process\.argv\[2\]\);\n {2}await waitForAccessibility\(process\.argv\[2\]\);\n/,
  );
  expect(prepare.trimEnd().split("\n").at(-1)).toBe('node scripts/wait-ios-ready.mjs "$device_id"');
});

it.each([
  false,
  true,
])("turns on accessibility in the simulator data with existing prefs %s", (existing) => {
  const data = tempDirectory("cue-ios-data-");
  const bin = tempDirectory("cue-ios-plutil-");
  const plist = path.join(data, "Library/Preferences/com.apple.Accessibility.plist");
  const calls = path.join(bin, "calls");
  writeFileSync(
    path.join(bin, "plutil"),
    `#!/bin/sh\necho "$*" >> "${calls}"\n[ "$1" = -create ] && : > "$3"\nexit 0\n`,
    { mode: 0o755 },
  );
  if (existing) {
    spawnSync("mkdir", ["-p", path.dirname(plist)]);
    writeFileSync(plist, "");
  }

  const result = spawnSync("bash", [repositoryPath("scripts/enable-ios-accessibility.sh"), data], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}` },
  });

  expect(result.status, result.stderr).toBe(0);
  expect(existsSync(plist)).toBe(true);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
    ...(existing ? [] : [`-create binary1 ${plist}`]),
    `-replace AccessibilityEnabled -bool true ${plist}`,
    `-replace ApplicationAccessibilityEnabled -bool true ${plist}`,
  ]);
});

it("turns on simulator accessibility before every iOS lane boots its simulator", () => {
  const lanes = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(({ body }) =>
    body.includes("xcrun simctl boot"),
  );

  expect(lanes.map(({ name }) => name)).toEqual([
    "native-e2e-ios-light",
    "ui-screenshots-ios-dark",
  ]);
  for (const { body } of lanes) {
    expect(body).toContain(
      `[0] | "\\(.udid) \\(.dataPath)"')\n          scripts/enable-ios-accessibility.sh "$data"\n          xcrun simctl boot "$device_id"\n`,
    );
  }
});
