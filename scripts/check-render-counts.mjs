import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Reassure's own comparison marks a duration change significant (p < 0.02 and at least 5%);
// a significant slowdown past 20% fails, the deviation Expensify's Reassure gate allows.
const DURATION_GATED = new Set(["Library first mount"]);
const DURATION_DEVIATION = 0.2;

const [baselinePath, currentPath, body = ""] = process.argv.slice(2);

// A pull request may change a scenario's count only by naming the exact change and why:
// "Render-Count: <scenario> <base> -> <head>: <reason>".
const acknowledged = new Set(
  [...body.matchAll(/^Render-Count: (.+) (\S+) -> (\S+): \S.*$/gm)].map(
    ([, name, from, to]) => `${name} ${from} -> ${to}`,
  ),
);

async function readMeasurements(path) {
  const records = (await readFile(path, "utf8")).split("\n").filter(Boolean).map(JSON.parse);
  return new Map(records.slice(1).map((record) => [record.name, record]));
}

const baseline = existsSync(baselinePath) ? await readMeasurements(baselinePath) : new Map();
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

  const change = `${expected.meanCount} -> ${measured.meanCount}`;
  process.stdout.write(`${name}: renders ${change}\n`);
  if (measured.meanCount !== expected.meanCount && acknowledged.has(`${name} ${change}`)) {
    process.stdout.write(`${name}: render count change stated in the pull request\n`);
  } else if (measured.meanCount !== expected.meanCount) {
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

const comparisonPath = join(dirname(currentPath), "output.json");
const comparison = existsSync(comparisonPath)
  ? JSON.parse(await readFile(comparisonPath, "utf8"))
  : { significant: [] };
for (const entry of comparison.significant) {
  if (!DURATION_GATED.has(entry.name)) continue;
  const change = `${entry.baseline.meanDuration.toFixed(1)} ms -> ${entry.current.meanDuration.toFixed(1)} ms`;
  process.stdout.write(`${entry.name}: duration ${change}\n`);
  if (entry.relativeDurationDiff > DURATION_DEVIATION) {
    process.stderr.write(
      `Render duration slowed by more than ${DURATION_DEVIATION * 100}%: ${entry.name} (${change})\n`,
    );
    failed = true;
  }
}

if (failed) process.exitCode = 1;
