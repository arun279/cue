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
const match = /CUE_RESPONSE_TIMING=mark ([\d.]+) ms, undo ([\d.]+) ms/.exec(logs);
if (match === null) throw new Error("mark and undo response timing is missing");
const ceiling = Number(process.argv[3]);
const [mark, undo] = match.slice(1).map(Number);
for (const [action, duration] of Object.entries({ mark, undo })) {
  if (duration > ceiling)
    throw new Error(`${action} response ${duration} ms exceeds ${ceiling} ms`);
}
process.stdout.write(
  `| Visible feedback | Five-tap median |\n| --- | ---: |\n| Mark | ${mark.toFixed(1)} ms |\n| Undo | ${undo.toFixed(1)} ms |\n`,
);
