import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const insets = (top: number) => `mDisplayCutout=DisplayCutout{insets=Rect(0, ${top} - 0, 0)`;
const pixel7Pro = `    ${insets(144)} waterfall=Insets{left=0, top=0, right=0, bottom=0}}`;

function pin(before: string, after: string, appliedAt: number, navigation = "0") {
  const directory = tempDirectory("cue-display-");
  writeFileSync(
    path.join(directory, "adb"),
    `#!/bin/sh
echo "$*" >> "$LOG"
case "$*" in
  'shell dumpsys window displays')
    polls=$(grep -c dumpsys "$LOG")
    if [ "$polls" -ge "$APPLIED_AT" ]; then printf '%s\\r\\n' "$AFTER"; else printf '%s\\r\\n' "$BEFORE"; fi ;;
  'shell settings get secure navigation_mode') printf '%s\\r\\n' "$NAVIGATION" ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(directory, "timeout"),
    `#!/usr/bin/env bash
echo "timeout $1" >> "$LOG"
shift
"$@" &
while kill -0 $! 2>/dev/null; do
  [ "$(grep -c dumpsys "$LOG")" -lt 10 ] || { kill $!; exit 124; }
done
wait $!
`,
    { mode: 0o755 },
  );
  const log = path.join(directory, "adb.log");
  const result = spawnSync(
    "bash",
    [repositoryPath("scripts/pin-android-display.sh"), path.join(directory, "displays.txt")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env["PATH"]}`,
        LOG: log,
        BEFORE: before,
        AFTER: after,
        APPLIED_AT: String(appliedAt),
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
  const result = pin(displays, displays, 1, navigation);

  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toBe(`Emulator display: ${display}\n`);
  expect(result.stderr).toBe(
    `Emulator display did not settle within 30 s\nEmulator display drifted: ${display}\n`,
  );
  expect(result.calls[2]).toBe("timeout 30");
  expect(result.calls.filter((call) => call.includes("dumpsys")).length).toBeGreaterThan(10);
});
