import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { startReadyProcess } from "../../scripts/start-ready-process.mjs";
import { fakeBin } from "../support/fake-bin";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

function fixture(source: string) {
  const directory = tempDirectory("cue-ready-");
  const module = path.join(directory, "child.cjs");
  writeFileSync(module, source);
  return { module, log: path.join(directory, "child.log") };
}

it("waits for the child's readiness message", async () => {
  const { module, log } = fixture(
    'process.send({ready: true}); process.on("disconnect", () => process.exit());',
  );
  expect(await startReadyProcess(module, log)).toBeGreaterThan(0);
});

it("reports an early exit with the process log", async () => {
  const { module, log } = fixture('console.error("bind failed"); process.exit(7);');
  await expect(startReadyProcess(module, log)).rejects.toThrow(
    /Process exited before readiness: 7[\s\S]*bind failed/,
  );
});

it("bounds missing readiness with one watchdog", async () => {
  const { module, log } = fixture('process.on("message", () => {});');
  await expect(startReadyProcess(module, log, 10)).rejects.toThrow("Readiness watchdog expired");
});

it("rejects an invalid acknowledgment", async () => {
  const { module, log } = fixture("process.send({other: true});");
  await expect(startReadyProcess(module, log)).rejects.toThrow("Invalid readiness signal");
});

const adbBin = fakeBin({
  adb: `#!/bin/sh
case "$*" in
  'shell am start '*) printf '%s\n' "$LAUNCH" ;;
  'shell pidof '*) [ -n "$PID" ] || exit 1; printf '%s\n' "$PID" ;;
  'shell getprop ro.hw_timeout_multiplier') printf '3\r\n' ;;
  'logcat -d '*) printf '%s\n' "$LOGCAT" ;;
esac
`,
  timeout: '#!/bin/sh\nshift\nexec "$@"\n',
});

it.each([
  ["Status: ok", "123", "", 0],
  ["Error: activity not started", "123", "", 1],
  ["Status: ok", "", "", 1],
  ["Status: ok", "123", "FATAL EXCEPTION: main", 1],
])("requires Android launch acknowledgment, a live process and no crash", (launch, pid, logcat, status) => {
  const directory = tempDirectory("cue-launch-");
  const result = spawnSync(
    "bash",
    [repositoryPath("scripts/verify-android-launch.sh"), "app.apk", path.join(directory, "logcat")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${adbBin}:${process.env["PATH"]}`,
        LAUNCH: launch,
        PID: pid,
        LOGCAT: logcat,
      },
    },
  );
  expect(result.status, result.stderr).toBe(status);
  if (pid === "") expect(result.stderr).toContain("not running after launch");
  if (logcat !== "") expect(result.stderr).toContain(logcat);
  if (launch !== "Status: ok") {
    expect(result.stderr).toContain(
      "not drawn within Android's launch idle timeout, 10 s times ro.hw_timeout_multiplier (3)",
    );
  }
});

it("takes the readiness watchdog bound from the command line", () => {
  const { module, log } = fixture('process.on("message", () => {});');
  const result = spawnSync(
    process.execPath,
    [repositoryPath("scripts/start-ready-process.mjs"), module, log, "10"],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Readiness watchdog expired");
});
