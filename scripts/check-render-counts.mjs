import { readFile } from "node:fs/promises";

const [baselinePath, currentPath] = process.argv.slice(2);

async function readMeasurements(path) {
  const records = (await readFile(path, "utf8")).split("\n").filter(Boolean).map(JSON.parse);
  return new Map(records.slice(1).map((record) => [record.name, record]));
}

const baseline = await readMeasurements(baselinePath);
const current = await readMeasurements(currentPath);
let failed = false;

for (const [name, expected] of baseline) {
  const measured = current.get(name);
  if (measured === undefined) {
    process.stderr.write(`Missing render scenario: ${name}\n`);
    failed = true;
    continue;
  }

  const durationChange = ((measured.meanDuration / expected.meanDuration - 1) * 100).toFixed(1);
  process.stdout.write(
    `${name}: renders ${expected.meanCount} -> ${measured.meanCount}; duration ${expected.meanDuration.toFixed(3)} ms -> ${measured.meanDuration.toFixed(3)} ms (${durationChange}%)\n`,
  );
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
