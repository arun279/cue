import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { waitForAccessibility } from "./wait-ios-accessibility.mjs";

export async function waitForIOS(device, { timeoutMs = 120_000, promptMs = 2_000 } = {}) {
  let child;
  let expired = false;
  let consecutive = 0;
  const watchdog = setTimeout(() => {
    expired = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  try {
    while (consecutive < 3) {
      const started = performance.now();
      const code = await new Promise((resolve, reject) => {
        child = spawn("xcrun", ["simctl", "ui", device, "appearance"], { stdio: "inherit" });
        child.once("error", reject);
        child.once("close", resolve);
      });
      if (expired)
        throw new Error(`iOS readiness watchdog expired after ${timeoutMs} ms for ${device}`);
      const elapsed = performance.now() - started;
      consecutive = code === 0 && elapsed <= promptMs ? consecutive + 1 : 0;
      process.stdout.write(
        `iOS appearance query: ${Math.round(elapsed)} ms, ${consecutive}/3 prompt responses\n`,
      );
    }
  } finally {
    clearTimeout(watchdog);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await waitForIOS(process.argv[2]);
  await waitForAccessibility(process.argv[2]);
}
