import { readFileSync } from "node:fs";

const [basePath, headPath, rationale = ""] = process.argv.slice(2);
if (basePath === undefined || headPath === undefined) {
  throw new Error("usage: check-size-delta.mjs <base-metrics.json> <head-metrics.json> [PR body]");
}

const base = JSON.parse(readFileSync(basePath, "utf8"));
const head = JSON.parse(readFileSync(headPath, "utf8"));
if (base.sizes === null) {
  throw new Error("size delta gate: merge-base measurements are missing");
}

const measured = [
  "expo iOS bundle",
  "expo Android bundle",
  "Firebase tester APK file",
  "Play download estimate",
];
const byName = (entries) => Object.fromEntries(entries.map((entry) => [entry.name, entry.size]));
const before = byName(base.sizes);
const after = byName(head.sizes);
const growth = measured.map((name) => {
  const delta = after[name] - before[name];
  if (!Number.isFinite(delta)) throw new Error(`${name}: not measured on both sides`);
  return { name, delta };
});
const exceeded = growth.filter(({ delta }) => delta > 0);

if (exceeded.length === 0) {
  process.stdout.write("size delta gate: no user artifact grew\n");
  process.exit(0);
}

const marker = rationale.match(/^Binary-Size: (.+)$/m)?.[0];
if (marker !== undefined) {
  process.stdout.write(`size delta gate bypassed by PR rationale: ${marker}\n`);
  process.exit(0);
}

const details = exceeded.map(({ name, delta }) => `${name} grew by ${delta} bytes`).join("; ");
throw new Error(`${details}. Add "Binary-Size: <rationale>" to the PR body.`);
