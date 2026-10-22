import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// XCTest plays each synthesized tap through a virtual touchscreen that
// backboardd attaches for that one event. When an event arrives before
// backboardd knows the touchscreen, it keeps two touch records for it ("unknown
// senderID"), the lift lands in the other one, and the contact is still down
// when the touchscreen goes away, so the app gets a system cancel ("canceling
// paths ... touching"). A tap that lifts normally logs neither line.
export const SIGNATURE =
  'process == "backboardd" AND (eventMessage CONTAINS "unknown senderID" OR eventMessage CONTAINS "canceling paths")';
const DOUBLE_RECORD = /\bunknown senderID\b/;
const CANCELLED_CONTACT = /canceling paths contacts: \[[^\]]*\btouching\b/;

export const occurrencesFile = () =>
  path.join(process.env.RUNNER_TEMP ?? tmpdir(), "simulator-touch-cancels.log");

/**
 * Whether the app's press trace and the simulator log prove the simulator
 * cancelled a tap the app played no part in: the app saw a touch start and a
 * system cancel and nothing else, and backboardd logged the dropped touch.
 */
export function provenSimulatorCancel(trace, log) {
  const events = new Set(trace.split("; ").map((entry) => entry.replace(/ \+.*$/, "")));
  if (events.has("press")) return { proven: false, reason: "the app received the press" };
  if (!events.has("touch start") || !events.has("touch cancel")) {
    return { proven: false, reason: "the app did not see a touch start and a system cancel" };
  }
  if (events.has("touch end") || events.has("drag")) {
    return { proven: false, reason: "the touch ended or moved inside the app" };
  }
  const dropped = log
    .split("\n")
    .find((line) => DOUBLE_RECORD.test(line) || CANCELLED_CONTACT.test(line));
  if (dropped === undefined) {
    return { proven: false, reason: "the simulator log shows no dropped touch" };
  }
  return { proven: true, reason: dropped.trim() };
}

const logStart = (since) => {
  const at = new Date(since.getTime() - 1_000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
};

/** Reads the simulator log since the tap began and records a proven cancel. */
export async function touchProof({ device, since, trace }) {
  if (device === undefined || since === undefined) {
    return { proven: false, reason: "no simulator tap window" };
  }
  const log = await run(
    "xcrun",
    [
      "simctl",
      "spawn",
      device,
      "log",
      "show",
      "--style",
      "compact",
      "--start",
      logStart(since),
      "--predicate",
      SIGNATURE,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  ).then(
    ({ stdout }) => stdout,
    () => "",
  );
  const verdict = provenSimulatorCancel(trace, log);
  if (verdict.proven) appendFileSync(occurrencesFile(), `${new Date().toISOString()} ${trace}\n`);
  return verdict;
}

export const provenCancels = () =>
  existsSync(occurrencesFile())
    ? readFileSync(occurrencesFile(), "utf8").split("\n").filter(Boolean)
    : [];
