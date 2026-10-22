import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const PIXEL_7_PRO = "mDisplayCutout=DisplayCutout{insets=Rect(0, 144 - 0, 0) navigation_mode=0";
const POLLS = 30;
const POLL_MS = 1000;

const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" });

function display(file) {
  const displays = adb("shell", "dumpsys", "window", "displays");
  writeFileSync(file, displays);
  const cutout =
    /mDisplayCutout=DisplayCutout\{insets=Rect\([^)]*\)/.exec(displays)?.[0] ??
    "no mDisplayCutout line";
  return `${cutout} navigation_mode=${adb("shell", "settings", "get", "secure", "navigation_mode").trim()}`;
}

/**
 * Turns on the Pixel 7 Pro cutout overlays, then reads the display, keeping the
 * last dump in `file`, until the cutout and gesture navigation apply or the
 * polls run out.
 *
 * @param {string} file
 * @param {(ms: number) => Promise<unknown>} [wait]
 */
export async function pinAndroidDisplay(file, wait = sleep) {
  adb("shell", "cmd", "overlay", "enable", "com.android.internal.emulation.pixel_7_pro");
  adb("shell", "cmd", "overlay", "enable", "com.android.systemui.emulation.pixel_7_pro");
  let state = display(file);
  for (let poll = 1; poll < POLLS && state !== PIXEL_7_PRO; poll += 1) {
    await wait(POLL_MS);
    state = display(file);
  }
  process.stdout.write(`Emulator display: ${state}\n`);
  if (state !== PIXEL_7_PRO) {
    throw new Error(`Emulator display drifted after ${POLLS} polls a second apart: ${state}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await pinAndroidDisplay(process.argv[2]);
}
