import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const files = (entry) =>
  statSync(entry).isDirectory()
    ? readdirSync(entry).flatMap((child) => files(path.join(entry, child)))
    : [entry];
const logs = files(process.argv[2])
  .filter((file) => file.endsWith("maestro.log"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const match = /CUE_RESPONSE_SAMPLES=.*mark ([\d.,]+); undo ([\d.,]+)/.exec(logs);
if (match === null) throw new Error("mark and undo response samples are missing");
const ceiling = Number(process.argv[3]);
const minimum = Number(process.argv[4]);

const rows = Object.entries({ Mark: match[1], Undo: match[2] }).map(([action, list]) => {
  const samples = list.split(",").map(Number);
  if (samples.length < minimum || samples.some((sample) => !Number.isFinite(sample))) {
    throw new Error(`${action} response needs ${minimum} samples, got ${samples.length}`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
  if (median > ceiling) {
    throw new Error(
      `${action} response median ${median.toFixed(1)} ms over ${samples.length} taps exceeds ${ceiling} ms`,
    );
  }
  return `| ${action} | ${median.toFixed(1)} ms | ${samples.join(", ")} ms |`;
});

process.stdout.write(
  `| Visible feedback | Median | Samples |\n| --- | ---: | --- |\n${rows.join("\n")}\n`,
);
