import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fakeBin } from "../support/fake-bin";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const insets = (top: number) => `mDisplayCutout=DisplayCutout{insets=Rect(0, ${top} - 0, 0)`;
const pixel7Pro = `    ${insets(144)} waterfall=Insets{left=0, top=0, right=0, bottom=0}}`;

const bin = fakeBin({
  adb: `#!/bin/sh
echo "$*" >> "$LOG"
case "$*" in
  'shell dumpsys window displays')
    polls=$(grep -c dumpsys "$LOG")
    if [ "$polls" -ge "$APPLIED_AT" ]; then printf '%s\\r\\n' "$AFTER"; else printf '%s\\r\\n' "$BEFORE"; fi ;;
  'shell settings get secure navigation_mode') printf '%s\\r\\n' "$NAVIGATION" ;;
esac
`,
  timeout: `#!/bin/sh
echo "timeout $1" >> "$LOG"
shift
[ -z "$EXPIRE" ] || exit 124
exec "$@"
`,
});

function pin(before: string, after: string, appliedAt: number | null, navigation = "0") {
  const directory = tempDirectory("cue-display-");
  const log = path.join(directory, "adb.log");
  const result = spawnSync(
    "bash",
    [repositoryPath("scripts/pin-android-display.sh"), path.join(directory, "displays.txt")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env["PATH"]}`,
        LOG: log,
        BEFORE: before,
        AFTER: after,
        APPLIED_AT: String(appliedAt ?? 0),
        EXPIRE: appliedAt === null ? "1" : "",
        NAVIGATION: navigation,
      },
    },
  );
  return { ...result, calls: readFileSync(log, "utf8").trim().split("\n") };
}

it("enables the Pixel 7 Pro overlays and waits for the cutout to apply", () => {
  const result = pin(`    ${insets(0)}`, pixel7Pro, 3);
  const poll = ["shell dumpsys window displays", "shell settings get secure navigation_mode"];

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(`Emulator display: ${insets(144)} navigation_mode=0\n`);
  expect(result.stderr).toBe("");
  expect(result.calls).toEqual([
    "shell cmd overlay enable com.android.internal.emulation.pixel_7_pro",
    "shell cmd overlay enable com.android.systemui.emulation.pixel_7_pro",
    "timeout 30",
    ...poll,
    ...poll,
    ...poll,
    ...poll,
  ]);
});

it.each([
  [`    ${insets(0)}`, "0", `${insets(0)} navigation_mode=0`],
  ["  mDisplayFrame=Rect(0, 0 - 1440, 3120)", "0", "no mDisplayCutout line navigation_mode=0"],
  [pixel7Pro, "2", `${insets(144)} navigation_mode=2`],
])("fails once the 30 s watchdog expires on a drifted display", (displays, navigation, display) => {
  const result = pin(displays, displays, null, navigation);

  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toBe(`Emulator display: ${display}\n`);
  expect(result.stderr).toBe(
    `Emulator display did not settle within 30 s\nEmulator display drifted: ${display}\n`,
  );
  expect(result.calls.slice(2)).toEqual([
    "timeout 30",
    "shell dumpsys window displays",
    "shell settings get secure navigation_mode",
  ]);
});
