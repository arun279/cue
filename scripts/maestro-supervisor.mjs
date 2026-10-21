import { spawn } from "node:child_process";
import path from "node:path";
import { watchScreenshots } from "./screenshot-watch.mjs";

const args = process.argv.slice(2);
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
    if (driverDied(line)) {
      failed = true;
      console.error(`XCTest driver died during startup\n${history.join("\n")}`);
      killGroup();
    }
  }
}

const debugOutput = args.includes("--debug-output")
  ? args[args.indexOf("--debug-output") + 1]
  : undefined;
const stopWatching =
  process.env.DEVICE_ID && debugOutput
    ? watchScreenshots({
        device: process.env.DEVICE_ID,
        directory: path.join(debugOutput, "springboard"),
        onStalled: (diagnosis) => {
          if (failed) return;
          failed = true;
          console.error(`${diagnosis}\n${history.join("\n")}`);
          killGroup();
        },
      })
    : () => {};

child = spawn("maestro", ["--verbose", ...args], {
  detached: true,
  stdio: ["inherit", "pipe", "pipe"],
});
for (const name of ["stdout", "stderr"]) {
  child[name].setEncoding("utf8");
  child[name].on("data", (text) => {
    process[name].write(text);
    inspect(name, text);
  });
}
child.on("error", (error) => console.error(`Cannot start Maestro: ${error.message}`));
child.on("close", (code, signal) => {
  stopWatching();
  process.exitCode = failed ? 1 : (code ?? (signal === "SIGINT" ? 130 : 1));
});
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(signal, () => {
    stopWatching();
    killGroup();
    process.exit(code);
  });
}
