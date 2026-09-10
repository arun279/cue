import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const files = (entry) =>
  statSync(entry).isDirectory()
    ? readdirSync(entry).flatMap((child) => files(path.join(entry, child)))
    : [entry];

const paths = process.argv.slice(2).flatMap(files);
const logs = paths
  .filter((file) => file.endsWith("maestro.log"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const match =
  /CUE_STARTUP_TIMING=Startup timing: (\d+(?:\.\d+)?) ms( \(performance\.now fallback\))?/.exec(
    logs,
  );
if (match === null) throw new Error("startup timing is missing from Maestro logs");

const entries = paths
  .filter((file) => /commands.*\.json$/.test(file))
  .flatMap((file) => JSON.parse(readFileSync(file, "utf8")));
const launch = entries.findLastIndex(({ command }) => command?.launchAppCommand !== undefined);
const idle = entries.findIndex(
  ({ command }, index) =>
    index > launch &&
    command?.assertConditionCommand !== undefined &&
    JSON.stringify(command).includes('"app-idle"'),
);
if (launch < 0 || idle < 0) throw new Error("startup launch or idle assertion is missing");

const duration = [entries[launch], entries[idle]].reduce((sum, entry) => {
  if (typeof entry.metadata?.duration !== "number") {
    throw new TypeError("startup command duration is missing");
  }
  return sum + entry.metadata.duration;
}, 0);
const source = match[2] === undefined ? "rnStartupTiming" : "performance.now fallback";

process.stdout.write(
  `| Startup measurement | Time | Source |\n| --- | ---: | --- |\n| In-app idle | ${match[1]} ms | ${source} |\n| Runner launch and idle assertion | ${duration} ms | Maestro commands |\n`,
);
