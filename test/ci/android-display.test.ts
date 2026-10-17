import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const insets = (top: number) => `mDisplayCutout=DisplayCutout{insets=Rect(0, ${top} - 0, 0)`;

it.each([
  [144, "0", 0],
  [0, "0", 1],
  [144, "2", 1],
  [undefined, "0", 1],
])("requires the emulator's display cutout and three-button navigation", (top, navigation, status) => {
  const displays =
    top === undefined
      ? "  mDisplayFrame=Rect(0, 0 - 1440, 3120)"
      : `    ${insets(top)} waterfall=Insets{left=0, top=0, right=0, bottom=0}}`;
  const display = `${top === undefined ? "no mDisplayCutout line" : insets(top)} navigation_mode=${navigation}`;
  const directory = tempDirectory("cue-display-");
  writeFileSync(
    path.join(directory, "adb"),
    `#!/bin/sh
case "$*" in
  'shell dumpsys window displays') printf '%s\\r\\n' "$DISPLAYS" ;;
  'shell settings get secure navigation_mode') printf '%s\\r\\n' "$NAVIGATION" ;;
esac
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    [repositoryPath("scripts/assert-android-display.sh"), path.join(directory, "displays.txt")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env["PATH"]}`,
        DISPLAYS: displays,
        NAVIGATION: navigation,
      },
    },
  );
  expect(result.status, result.stderr).toBe(status);
  expect(result.stdout).toBe(`Emulator display: ${display}\n`);
  expect(result.stderr).toBe(status === 0 ? "" : `Emulator display drifted: ${display}\n`);
});
