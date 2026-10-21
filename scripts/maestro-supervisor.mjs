import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { laneHealth, recorder, spindump } from "./lane-health.mjs";

const args = process.argv.slice(2);
const debugOutput = args.includes("--debug-output")
  ? args[args.indexOf("--debug-output") + 1]
  : undefined;
const healthDirectory = debugOutput && path.join(debugOutput, "lane-health");
const history = [];
const tails = new Map();
let driverAnswered = Boolean(process.env.USE_XCODE_TEST_RUNNER);
let failed = false;
let child;

function killGroup() {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function driverDied(line) {
  return (
    /Request for http:\/\/(?:127\.0\.0\.1|localhost):\d+\/deviceInfo failed, code: 500\b/.test(
      line,
    ) ||
    /XCTestDriver request failed\. Status code: 500, path: .*\bdeviceInfo\b/.test(line) ||
    (driverAnswered && /\[Failed\] Perform XCUITest driver status check/.test(line)) ||
    /iOS driver not ready in time/.test(line)
  );
}

function accessibilityTimeout(line) {
  const [, call, pid] = /kAXErrorIPCTimeout from (\w+) for (\d+)/.exec(line) ?? [];
  if (pid === undefined) return undefined;
  const command = spawnSync("ps", ["-o", "comm=", "-p", pid], { encoding: "utf8" }).stdout.trim();
  if (command !== "" && healthDirectory) {
    spindump({
      directory: healthDirectory,
      pid,
      label: command,
      record: recorder(healthDirectory),
    });
  }
  return `The simulator's accessibility IPC to pid ${pid} (${command || "no longer running"}) timed out in ${call}, so XCTest could not list the running apps. Spindumps, when the lane records them: ${healthDirectory}`;
}

function diagnose(line) {
  return (
    accessibilityTimeout(line) ??
    (/Timed out while requesting screenshot/.test(line)
      ? `SpringBoard did not answer testmanagerd's accessibility orientation query within XCTest's 30 s screenshot limit, so no screenshot could be taken. Screenshot timings and SpringBoard spindumps, when the lane records them: ${healthDirectory}`
      : undefined) ??
    (driverDied(line) ? "XCTest driver died during startup" : undefined)
  );
}

function inspect(source, text) {
  const lines = `${tails.get(source) ?? ""}${text}`.split(/\r?\n/);
  tails.set(source, lines.pop().slice(-16_384));
  for (const line of [...lines, tails.get(source)]) {
    if (!line || failed) continue;
    history.push(`[${source}] ${line}`);
    if (history.length > 20) history.shift();
    if (/\[Done\] Perform XCUITest driver status check|Got device info:/.test(line)) {
      driverAnswered = true;
    }
    const diagnosis = diagnose(line);
    if (diagnosis !== undefined) {
      failed = true;
      console.error(`${diagnosis}\n${history.join("\n")}`);
      killGroup();
    }
  }
}

const health =
  process.env.DEVICE_ID && healthDirectory
    ? laneHealth({ device: process.env.DEVICE_ID, directory: healthDirectory })
    : undefined;

child = spawn("maestro", ["--verbose", ...args], {
  env: health
    ? {
        ...process.env,
        MAESTRO_OPTS: `${process.env["MAESTRO_OPTS"] ?? ""} ${health.javaOptions}`.trim(),
      }
    : process.env,
  detached: true,
  stdio: ["inherit", "pipe", "pipe"],
});
for (const name of ["stdout", "stderr"]) {
  child[name].setEncoding("utf8");
  child[name].on("data", (text) => {
    health?.heard();
    process[name].write(text);
    inspect(name, text);
  });
}
child.on("error", (error) => console.error(`Cannot start Maestro: ${error.message}`));
child.on("close", async (code, signal) => {
  process.exitCode = failed ? 1 : (code ?? (signal === "SIGINT" ? 130 : 1));
  const report = await health
    ?.stop()
    .catch((error) => ({ lines: [`unavailable: ${error.message}`], warning: undefined }));
  for (const line of report?.lines ?? []) process.stdout.write(`Lane health: ${line}\n`);
  if (report?.warning) process.stdout.write(`::warning title=Lane health::${report.warning}\n`);
});
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(signal, () => {
    killGroup();
    process.exit(code);
  });
}
