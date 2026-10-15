import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const history = [];
const tails = new Map();
let driverAnswered = false;
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
    const deviceInfoFailure =
      /Request for http:\/\/(?:127\.0\.0\.1|localhost):\d+\/deviceInfo failed, code: 500\b/.test(
        line,
      ) || /XCTestDriver request failed\. Status code: 500, path: .*\bdeviceInfo\b/.test(line);
    const statusFailure = /\[Failed\] Perform XCUITest driver status check/.test(line);
    if (
      deviceInfoFailure ||
      (statusFailure &&
        (driverAnswered ||
          /exception: java\.(?:net\.SocketTimeoutException|net\.SocketException|io\.IOException)\b/.test(
            line,
          ))) ||
      /iOS driver not ready in time/.test(line)
    ) {
      failed = true;
      console.error(`XCTest driver died during startup\n${history.join("\n")}`);
      killGroup();
    }
  }
}

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
  process.exitCode = failed ? 1 : (code ?? (signal === "SIGINT" ? 130 : 1));
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
