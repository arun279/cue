import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const { DEVICE_ID, MAESTRO_RUNNER_PORT, RUNNER_TEMP } = process.env;
const runner = spawn(
  "xcodebuild",
  [
    "test-without-building",
    "-xctestrun",
    `${RUNNER_TEMP}/maestro-runner/maestro-driver-ios.xctestrun`,
    "-destination",
    `id=${DEVICE_ID}`,
    "-only-testing:maestro-driver-iosUITests/maestro_driver_iosUITests",
  ],
  { stdio: "inherit", env: { ...process.env, TEST_RUNNER_PORT: MAESTRO_RUNNER_PORT } },
);
runner.on("exit", (code) => process.exit(code ?? 1));

async function answers() {
  try {
    const response = await fetch(`http://127.0.0.1:${MAESTRO_RUNNER_PORT}/deviceInfo`, {
      method: "POST",
    });
    process.stdout.write(`deviceInfo: ${response.status}\n`);
    return response.ok;
  } catch {
    return false;
  }
}

while (!(await answers())) await delay(500);
process.send({ ready: true });
