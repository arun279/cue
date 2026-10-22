import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createTapProxy, streamPlayback } from "./tap-proxy.mjs";

const { DEVICE_ID, MAESTRO_RUNNER_PORT, RUNNER_TEMP } = process.env;
const runnerPort = Number(MAESTRO_RUNNER_PORT) + 1;
let runner;
const { playback, stream } = await streamPlayback(DEVICE_ID, (code) => {
  console.error(`The simulator log stream exited (${code}), so dropped taps cannot be told apart`);
  runner?.kill();
  process.exit(1);
});
runner = spawn(
  "xcodebuild",
  [
    "test-without-building",
    "-xctestrun",
    `${RUNNER_TEMP}/maestro-runner/maestro-driver-ios.xctestrun`,
    "-destination",
    `id=${DEVICE_ID}`,
    "-only-testing:maestro-driver-iosUITests/maestro_driver_iosUITests",
  ],
  { stdio: "inherit", env: { ...process.env, TEST_RUNNER_PORT: String(runnerPort) } },
);
runner.on("exit", (code) => {
  stream.removeAllListeners("exit");
  stream.kill();
  process.exit(code ?? 1);
});
await createTapProxy({ runner: `http://127.0.0.1:${runnerPort}`, playback }).listen(
  Number(MAESTRO_RUNNER_PORT),
);

async function answers(port, label) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/deviceInfo`, { method: "POST" });
    process.stdout.write(`${label}: ${response.status}\n`);
    return response.ok;
  } catch {
    return false;
  }
}

// The runner is polled on its own port while it starts, so the proxy logs no
// unreachable-runner error per poll; one answer through the proxy then proves
// the CLI's path.
while (!(await answers(runnerPort, "deviceInfo"))) await delay(500);
if (!(await answers(MAESTRO_RUNNER_PORT, "deviceInfo through the tap proxy"))) process.exit(1);
process.send({ ready: true });
