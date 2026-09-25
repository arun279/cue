import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [base, lcovPath, rationale = ""] = process.argv.slice(2);
if (base === undefined || lcovPath === undefined) {
  throw new Error("usage: check-changed-coverage.mjs <base> <lcov> [PR body]");
}

const scope = JSON.parse(readFileSync(new URL("./core-coverage-scope.json", import.meta.url)));
const pathspecs = [
  ...scope.include.map((pattern) => `:(glob)${pattern}`),
  ...scope.exclude.map((pattern) => `:(glob,exclude)${pattern}`),
];

const changed = new Map();
let file;
for (const line of execFileSync(
  "git",
  ["diff", "--unified=0", "--no-color", `${base}...HEAD`, "--", ...pathspecs],
  { encoding: "utf8" },
).split("\n")) {
  if (line.startsWith("+++ b/")) {
    file = line.slice(6);
    if (/\.tsx?$/.test(file)) changed.set(file, new Set());
    else file = undefined;
    continue;
  }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (file === undefined || hunk === null) continue;
  const start = Number(hunk[1]);
  const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
  for (let number = start; number < start + count; number += 1) changed.get(file).add(number);
}

const coverage = new Map();
for (const record of readFileSync(lcovPath, "utf8").split("end_of_record")) {
  const source = /^SF:(.+)$/m.exec(record)?.[1];
  const root = source?.lastIndexOf("packages/core/src/") ?? -1;
  if (root < 0) continue;
  const lines = new Map(
    [...record.matchAll(/^DA:(\d+),(\d+)/gm)].map((match) => [Number(match[1]), Number(match[2])]),
  );
  const branches = [...record.matchAll(/^BRDA:(\d+),[^,]*,[^,]*,([^\n]+)/gm)].map((match) => [
    Number(match[1]),
    match[2],
  ]);
  coverage.set(source.slice(root), { lines, branches });
}

const failures = [];
// https://vitest.dev/config/coverage
for (const [path, changedLines] of changed) {
  const measured = coverage.get(path);
  if (measured === undefined) {
    failures.push(`${path}: coverage data missing`);
    continue;
  }
  for (const line of changedLines) {
    if (measured.lines.has(line) && measured.lines.get(line) === 0)
      failures.push(`${path}:${line}`);
    const uncovered = measured.branches.filter(
      ([branchLine, taken]) => branchLine === line && (taken === "-" || Number(taken) === 0),
    ).length;
    if (uncovered > 0) failures.push(`${path}:${line} has ${uncovered} uncovered branch arm(s)`);
  }
}

if (failures.length === 0) {
  process.stdout.write("changed coverage: all executable lines and branch arms covered\n");
} else if (!/^Coverage-Rationale: .+$/m.test(rationale)) {
  throw new Error(`${failures.join("\n")}\nAdd "Coverage-Rationale: <rationale>" to the PR body.`);
} else {
  process.stdout.write("changed coverage: accepted by Coverage-Rationale\n");
}
