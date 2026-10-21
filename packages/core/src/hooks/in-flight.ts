import type { CueRuntime } from "../runtime/runtime";

const IN_FLIGHT_POLL_MS = 200;
const IN_FLIGHT_POLL_TRIES = 50;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// False when the op is still being delivered after the wait; its outcome is then unknown.
export async function waitWhileInFlight(
  runtime: CueRuntime,
  opIds: readonly string[],
): Promise<boolean> {
  for (let attempt = 0; attempt < IN_FLIGHT_POLL_TRIES; attempt += 1) {
    const inFlight = runtime.inFlightOpId();
    if (inFlight === null || !opIds.includes(inFlight)) return true;
    await sleep(IN_FLIGHT_POLL_MS);
  }
  return false;
}
