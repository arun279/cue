import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [treeArgument, outputArgument] = process.argv.slice(2);
if (treeArgument === undefined || outputArgument === undefined) {
  throw new Error("usage: measure-comments.mjs <tree> <out.json>");
}

const tree = path.resolve(treeArgument);
const output = path.resolve(outputArgument);
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

const packages = Object.fromEntries(
  ["core", "web", "native"].map((name) => [name, { code: 0, comments: 0, blank: 0 }]),
);
for (const file of files) {
  const name = /^packages\/([^/]+)\//.exec(file)?.[1];
  if (name === undefined || packages[name] === undefined) continue;
  const lines = readFileSync(path.join(tree, file), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const content = line.trimStart();
    if (content === "") packages[name].blank += 1;
    else if (/^(\/\/|\/\*|\*)/.test(content)) packages[name].comments += 1;
    else packages[name].code += 1;
  }
}

const withDensity = ({ code, comments, blank }) => ({
  code,
  comments,
  blank,
  density: Number(((comments / (code + comments)) * 100).toFixed(2)),
});
const measuredPackages = Object.fromEntries(
  Object.entries(packages).map(([name, counts]) => [name, withDensity(counts)]),
);
const total = withDensity(
  Object.values(packages).reduce(
    (sum, counts) => ({
      code: sum.code + counts.code,
      comments: sum.comments + counts.comments,
      blank: sum.blank + counts.blank,
    }),
    { code: 0, comments: 0, blank: 0 },
  ),
);
const metrics = { packages: measuredPackages, total };
writeFileSync(output, `${JSON.stringify(metrics, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(metrics)}\n`);
