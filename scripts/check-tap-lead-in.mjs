import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TAP = /^Tapping [\d.]+, [\d.]+$/;
const ATTACH = /digitizer attached.*transport:Recap/;

const time = (timestamp) =>
  Date.parse(timestamp.replace(/^(\S+) (\S{12})\d*([+-]\d\d)(\d\d)$/, "$1T$2$3:$4"));

export function tapAttachDelays(ndjson) {
  const entries = ndjson
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter(({ eventMessage }) => typeof eventMessage === "string")
    .map(({ timestamp, eventMessage }) => ({ at: time(timestamp), message: eventMessage }));
  const attaches = entries.filter(({ message }) => ATTACH.test(message));
  return entries
    .filter(({ message }) => TAP.test(message))
    .map(({ at, message }) => {
      const attach = attaches.find((entry) => entry.at >= at);
      return { tap: message, delayMs: attach ? attach.at - at : null };
    });
}

export const leadInMs = (patch) =>
  1000 * Number(patch.match(/^\+ +static let touchLeadIn = ([\d.]+)$/m)?.[1]);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [device, start, output] = process.argv.slice(2);
  const leadIn = leadInMs(
    readFileSync(
      new URL("../patches/maestro-runner/0002-lead-in-touch-paths.patch", import.meta.url),
      "utf8",
    ),
  );
  const ndjson = execFileSync(
    "xcrun",
    [
      ...["simctl", "spawn", device, "log", "show", "--style", "ndjson", "--info", "--debug"],
      ...["--start", start, "--predicate"],
      'eventMessage BEGINSWITH "Tapping " OR eventMessage BEGINSWITH "digitizer attached"',
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  writeFileSync(output, ndjson);
  const taps = tapAttachDelays(ndjson);
  for (const { tap, delayMs } of taps) {
    process.stdout.write(`${tap}: digitizer attached after ${delayMs ?? "never"} ms\n`);
  }
  if (!taps.some(({ delayMs }) => delayMs !== null && delayMs < leadIn)) {
    process.stderr.write(
      `No tap's digitizer attached within the ${leadIn} ms lead-in before its first touch\n`,
    );
    process.exitCode = 1;
  }
}
