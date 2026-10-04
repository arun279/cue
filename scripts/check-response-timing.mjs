import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const [directory, ceilingArgument, minimumArgument] = process.argv.slice(2);
const ceiling = Number(ceilingArgument);
const minimum = Number(minimumArgument);
if (!(ceiling > 0) || !Number.isInteger(minimum) || minimum < 1) {
  throw new Error("usage: check-response-timing.mjs <artifacts> <ceiling ms> <minimum taps>");
}

const files = (entry) =>
  statSync(entry).isDirectory()
    ? readdirSync(entry).flatMap((child) => files(path.join(entry, child)))
    : [entry];
const logs = files(directory)
  .filter((file) => file.endsWith("maestro.log"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const match = /CUE_RESPONSE_SAMPLES=.*mark ([\d.,]+); undo ([\d.,]+)/.exec(logs);
if (match === null) throw new Error("mark and undo response samples are missing");

const rows = Object.entries({ Mark: match[1], Undo: match[2] }).map(([action, list]) => {
  const samples = list.split(",").map(Number);
  if (samples.length < minimum) {
    throw new Error(`${action} response needs ${minimum} samples, got ${samples.length}`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p75 = sorted[Math.ceil(0.75 * sorted.length) - 1];
  if (p75 > ceiling) {
    throw new Error(
      `${action} response p75 ${p75.toFixed(1)} ms over ${samples.length} taps exceeds ${ceiling} ms`,
    );
  }
  return `| ${action} | ${p75.toFixed(1)} ms | ${samples.join(", ")} ms |`;
});

process.stdout.write(
  `| Visible feedback | p75 | Samples |\n| --- | ---: | --- |\n${rows.join("\n")}\n`,
);
