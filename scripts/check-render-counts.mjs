import { readFile } from "node:fs/promises";

const [baselinePath, currentPath] = process.argv.slice(2);

async function readMeasurements(path) {
  const records = (await readFile(path, "utf8")).split("\n").filter(Boolean).map(JSON.parse);
  return new Map(records.slice(1).map((record) => [record.name, record]));
}

const baseline = await readMeasurements(baselinePath);
const current = await readMeasurements(currentPath);
const introduced = JSON.parse(
  await readFile(new URL("./render-count-baselines.json", import.meta.url), "utf8"),
);
for (const [name, meanCount] of Object.entries(introduced)) {
  if (!baseline.has(name)) baseline.set(name, { meanCount });
}
let failed = false;

for (const [name, expected] of baseline) {
  const measured = current.get(name);
  if (measured === undefined) {
    process.stderr.write(`Missing render scenario: ${name}\n`);
    failed = true;
    continue;
  }

  process.stdout.write(`${name}: renders ${expected.meanCount} -> ${measured.meanCount}\n`);
  if (measured.meanCount !== expected.meanCount) {
    process.stderr.write(
      `Render count difference exceeded the allowed deviation of 0: ${name} (${expected.meanCount} -> ${measured.meanCount})\n`,
    );
    failed = true;
  }
}

for (const name of current.keys()) {
  if (!baseline.has(name)) {
    process.stderr.write(`Unbaselined render scenario: ${name}\n`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
