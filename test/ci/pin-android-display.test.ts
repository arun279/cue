import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { pinAndroidDisplay } from "../../scripts/pin-android-display.mjs";
import { fakeBin } from "../support/fake-bin";
import { tempDirectory } from "../support/temp-directory";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const POLL = ["shell dumpsys window displays", "shell settings get secure navigation_mode"];
const polls = (count: number) =>
  Array.from({ length: count }, (_, index) => (index === 0 ? POLL : ["wait 1000", ...POLL])).flat();

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
});

async function pin(before: string, after: string, appliedAt: number | null, navigation = "0") {
  const directory = tempDirectory("cue-display-");
  const log = path.join(directory, "adb.log");
  const displays = path.join(directory, "displays.txt");
  vi.stubEnv("PATH", `${bin}:${process.env["PATH"]}`);
  vi.stubEnv("LOG", log);
  vi.stubEnv("BEFORE", before);
  vi.stubEnv("AFTER", after);
  vi.stubEnv("APPLIED_AT", String(appliedAt ?? Number.MAX_SAFE_INTEGER));
  vi.stubEnv("NAVIGATION", navigation);
  const printed = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const failure = await pinAndroidDisplay(displays, async (ms: number) =>
    appendFileSync(log, `wait ${ms}\n`),
  ).then(
    () => undefined,
    (error: Error) => error.message,
  );
  return {
    failure,
    printed: printed.mock.calls.map(([line]) => line),
    displays: readFileSync(displays, "utf8"),
    calls: readFileSync(log, "utf8").trim().split("\n"),
  };
}

it("enables the Pixel 7 Pro overlays and waits for the cutout to apply", async () => {
  const result = await pin(`    ${insets(0)}`, pixel7Pro, 3);

  expect(result.failure).toBeUndefined();
  expect(result.printed).toEqual([`Emulator display: ${insets(144)} navigation_mode=0\n`]);
  expect(result.displays).toBe(`${pixel7Pro}\r\n`);
  expect(result.calls).toEqual([
    "shell cmd overlay enable com.android.internal.emulation.pixel_7_pro",
    "shell cmd overlay enable com.android.systemui.emulation.pixel_7_pro",
    ...polls(3),
  ]);
});

it.each([
  [`    ${insets(0)}`, "0", `${insets(0)} navigation_mode=0`],
  ["  mDisplayFrame=Rect(0, 0 - 1440, 3120)", "0", "no mDisplayCutout line navigation_mode=0"],
  [pixel7Pro, "2", `${insets(144)} navigation_mode=2`],
])("fails with the drifted state after 30 polls a second apart", async (displays, navigation, display) => {
  const result = await pin(displays, displays, null, navigation);

  expect(result.failure).toBe(`Emulator display drifted after 30 polls a second apart: ${display}`);
  expect(result.printed).toEqual([`Emulator display: ${display}\n`]);
  expect(result.calls.slice(2)).toEqual(polls(30));
});
