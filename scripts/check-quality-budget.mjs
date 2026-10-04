import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const productPaths = [
  "packages/core/src",
  "packages/native/src",
  "packages/native/app",
  "packages/native/modules",
];
const files = execFileSync("git", ["ls-files", "-z", "--", ...productPaths], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter((file) => /\.tsx?$/.test(file) && existsSync(path.join(root, file)));
const suppression = /biome-ignore lint\/complexity\/noExcessiveCognitiveComplexity/g;
const suppressions = files.reduce(
  (total, file) =>
    total + [...readFileSync(path.join(root, file), "utf8").matchAll(suppression)].length,
  0,
);
const owned = [
  ["DAY_MS", /\b(?:export\s+)?const\s+DAY_MS\b/, ["packages/core/src/domain/time.ts"]],
  [
    "the local day-key formatter",
    /Intl\.DateTimeFormat\("en-CA"/,
    ["packages/core/src/domain/day.ts"],
  ],
  [
    "the persisted storage keys",
    /"cue\.(?:write-queue|trakt\.token)"/,
    ["packages/core/src/ports/storage-keys.ts"],
  ],
  [
    "the read-failure mapper",
    /readFailureOf\(/,
    ["packages/core/src/sync-contract.ts", "packages/core/src/queries/freshness.ts"],
  ],
];
const budget = JSON.parse(readFileSync(path.join(root, "scripts/quality-budget.json"), "utf8"));
if (suppressions !== budget.cognitiveComplexitySuppressions) {
  throw new Error(
    `cognitive complexity suppressions: ${suppressions}, budget ${budget.cognitiveComplexitySuppressions}`,
  );
}
for (const [label, pattern, owners] of owned) {
  const strays = files.filter(
    (file) => !owners.includes(file) && pattern.test(readFileSync(path.join(root, file), "utf8")),
  );
  if (strays.length > 0) {
    throw new Error(
      `${label} may only appear in ${owners.join(", ")}; found in ${strays.join(", ")}`,
    );
  }
}
process.stdout.write(`quality budget: ${suppressions} cognitive complexity suppressions\n`);
