import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const files = (entry) =>
  statSync(entry).isDirectory()
    ? readdirSync(entry).flatMap((child) => files(path.join(entry, child)))
    : [entry];
const paths = process.argv.slice(2, -1).flatMap(files);
const ceiling = Number(process.argv.at(-1));
const logs = paths
  .filter((file) => file.endsWith("maestro.log"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const match = /CUE_APP_IDLE_SAMPLES=([\d.,]+)/.exec(logs);
if (match === null) throw new Error("returning-user app-idle samples are missing");
const samples = match[1].split(",").map(Number);
if (samples.length !== 5 || samples.some((sample) => !Number.isFinite(sample))) {
  throw new Error("returning-user app-idle requires five samples");
}
const median = [...samples].sort((a, b) => a - b)[2];
if (median > ceiling) {
  throw new Error(`returning-user app-idle median ${median.toFixed(1)} ms exceeds ${ceiling} ms`);
}

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
if (launch < 0 || idle < 0) throw new Error("final launch or app-idle assertion is missing");
const duration = [entries[launch], entries[idle]].reduce((sum, entry) => {
  if (typeof entry.metadata?.duration !== "number")
    throw new TypeError("command duration is missing");
  return sum + entry.metadata.duration;
}, 0);

process.stdout.write(
  `| Returning-user measurement | Time |\n| --- | ---: |\n| Five-launch median to app idle | ${median.toFixed(1)} ms |\n| Samples | ${samples.join(", ")} ms |\n| Final runner launch and idle assertion | ${duration} ms |\n`,
);
