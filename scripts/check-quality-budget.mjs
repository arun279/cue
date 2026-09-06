import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const productPaths = [
  "packages/core/src",
  "packages/web/src",
  "packages/native/src",
  "packages/native/app",
  "packages/native/modules",
];
const files = execFileSync("git", ["ls-files", "-z", "--", ...productPaths], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter((file) => /\.tsx?$/.test(file));
const suppression = /biome-ignore lint\/complexity\/noExcessiveCognitiveComplexity/g;
const suppressions = files.reduce(
  (total, file) =>
    total + [...readFileSync(path.join(root, file), "utf8").matchAll(suppression)].length,
  0,
);
const nativeSuppressions = files
  .filter((file) => file.startsWith("packages/native/src/"))
  .reduce(
    (total, file) =>
      total + [...readFileSync(path.join(root, file), "utf8").matchAll(suppression)].length,
    0,
  );
const budget = JSON.parse(readFileSync(path.join(root, "scripts/quality-budget.json"), "utf8"));
const cache = path.join(root, "node_modules/.cache");
const measurement = path.join(cache, "quality-complexity.json");
mkdirSync(cache, { recursive: true });
execFileSync(process.execPath, ["scripts/measure-complexity.mjs", root, measurement], {
  cwd: root,
  stdio: "inherit",
});
const complexity = JSON.parse(readFileSync(measurement, "utf8"));
unlinkSync(measurement);

if (nativeSuppressions !== 0) {
  throw new Error(
    `cognitive complexity suppressions under packages/native/src: ${nativeSuppressions}, budget 0`,
  );
}
if (suppressions > budget.cognitiveComplexitySuppressions) {
  throw new Error(
    `cognitive complexity suppressions: ${suppressions}, budget ${budget.cognitiveComplexitySuppressions}`,
  );
}
if (complexity.max > budget.worstCognitiveComplexity) {
  throw new Error(
    `worst cognitive complexity: ${complexity.max}, budget ${budget.worstCognitiveComplexity} (${complexity.maxSite})`,
  );
}

process.stdout.write(
  `quality budget: ${suppressions} cognitive complexity suppressions, worst complexity ${complexity.max}\n`,
);
