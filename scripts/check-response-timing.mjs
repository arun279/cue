import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const [directory, ceilingArgument, minimumArgument, referenceArgument] = process.argv.slice(2);
const ceiling = Number(ceilingArgument);
const minimum = Number(minimumArgument);
const reference = Number(referenceArgument);
if (!(ceiling > 0) || !Number.isInteger(minimum) || minimum < 1 || !(reference > 0)) {
  throw new Error(
    "usage: check-response-timing.mjs <artifacts> <ceiling ms> <minimum taps> <reference read ms>",
  );
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

const seconds = (stamp) => stamp.split(":").reduce((total, part) => total * 60 + Number(part), 0);
const reads = [
  ...logs.matchAll(
    /^(\S+) .*onCommandStart: Assert that id: snackbar-undo is visible RUNNING$[\s\S]*?^(\S+) .*onCommandFinished: Assert that id: snackbar-undo is visible/gm,
  ),
]
  .map(([, start, end]) => (seconds(end) - seconds(start)) * 1000)
  .sort((a, b) => a - b);
if (reads.length < minimum) {
  throw new Error(`runner speed needs ${minimum} snackbar reads, got ${reads.length}`);
}
const read = reads[Math.floor((reads.length - 1) / 2)];
const scale = reference / read;

const rows = Object.entries({ Mark: match[1], Undo: match[2] }).map(([action, list]) => {
  const samples = list.split(",").map(Number);
  if (samples.length < minimum) {
    throw new Error(`${action} response needs ${minimum} samples, got ${samples.length}`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p75 = sorted[Math.ceil(0.75 * sorted.length) - 1];
  const scaled = p75 * scale;
  if (scaled > ceiling) {
    throw new Error(
      `${action} response p75 ${scaled.toFixed(1)} ms on the reference runner (${p75.toFixed(1)} ms measured, median snackbar read ${read.toFixed(0)} ms) exceeds ${ceiling} ms`,
    );
  }
  return `| ${action} | ${p75.toFixed(1)} ms | ${scaled.toFixed(1)} ms | ${samples.join(", ")} ms |`;
});

process.stdout.write(
  `Runner speed: median snackbar read ${read.toFixed(0)} ms against a ${reference} ms reference, so samples scale by ${scale.toFixed(2)}.\n\n| Visible feedback | p75 | p75 on reference runner | Samples |\n| --- | ---: | ---: | --- |\n${rows.join("\n")}\n`,
);
