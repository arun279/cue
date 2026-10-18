import { spawn } from "node:child_process";

const RUNNING = /^\d+\s+\S+\s+\S*AccessibilityUIServer/m;

export async function waitForAccessibility(device, { timeoutMs = 120_000 } = {}) {
  let child;
  let expired = false;
  const watchdog = setTimeout(() => {
    expired = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  try {
    for (;;) {
      const listing = await new Promise((resolve, reject) => {
        let output = "";
        child = spawn("xcrun", ["simctl", "spawn", device, "launchctl", "list"]);
        child.stdout.setEncoding("utf8").on("data", (text) => {
          output += text;
        });
        child.once("error", reject);
        child.once("close", () => resolve(output));
      });
      if (expired)
        throw new Error(`iOS accessibility watchdog expired after ${timeoutMs} ms for ${device}`);
      if (RUNNING.test(listing)) return;
    }
  } finally {
    clearTimeout(watchdog);
  }
}
