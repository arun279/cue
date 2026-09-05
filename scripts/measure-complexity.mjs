import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [treeArgument, outputArgument] = process.argv.slice(2);
if (treeArgument === undefined || outputArgument === undefined) {
  throw new Error("usage: measure-complexity.mjs <tree> <out.json>");
}

const headRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tree = path.resolve(treeArgument);
const output = path.resolve(outputArgument);
const shadow = path.join(headRoot, ".complexity-measure");
const files = execFileSync(
  "git",
  [
    "ls-files",
    "-z",
    "--",
    "packages/core/src",
    "packages/web/src",
    "packages/native/src",
    "packages/native/app",
    "packages/native/modules",
  ],
  { cwd: tree, encoding: "utf8" },
)
  .split("\0")
  .filter((file) => /\.tsx?$/.test(file));

rmSync(shadow, { force: true, recursive: true });
for (const file of files) {
  const target = path.join(shadow, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    readFileSync(path.join(tree, file), "utf8").replace(
      /^.*biome-ignore lint\/complexity\/noExcessiveCognitiveComplexity:.*\n/gm,
      "",
    ),
  );
}

const run = spawnSync(
  path.join(headRoot, "node_modules", ".bin", "biome"),
  [
    "lint",
    "--config-path",
    path.join(headRoot, "scripts", "complexity", "biome.jsonc"),
    "--only=complexity/noExcessiveCognitiveComplexity",
    "--max-diagnostics=none",
    "--reporter=json",
    shadow,
  ],
  { cwd: headRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
rmSync(shadow, { force: true, recursive: true });

const report = JSON.parse(run.stdout);
const parsed = report.diagnostics.flatMap(({ location, message }) => {
  const match = /Excessive complexity of (\d+) detected \(max: 1\)/.exec(message);
  const productPath = /packages\/[^/]+\/(?:src|app|modules)\/.+/.exec(location.path)?.[0];
  return match === null || productPath === undefined
    ? []
    : [{ score: Number(match[1]), site: productPath }];
});
if (parsed.length === 0) throw new Error("zero functions parsed from Biome complexity output");

const worst = parsed.reduce((current, candidate) =>
  candidate.score > current.score ? candidate : current,
);
const sum = parsed.reduce((total, { score }) => total + score, 0);
const metrics = {
  functions: parsed.length,
  max: worst.score,
  maxSite: worst.site,
  over15: parsed.filter(({ score }) => score > 15).length,
  sum,
  mean: Number((sum / parsed.length).toFixed(2)),
};
writeFileSync(output, `${JSON.stringify(metrics, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(metrics)}\n`);
