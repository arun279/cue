import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bin = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  "node_modules/.bin",
);
const sources = [
  "packages/core/src",
  "packages/native/src",
  "packages/native/app",
  "packages/native/modules",
]
  .map((directory) => path.join(process.argv[2], directory))
  .filter((directory) => existsSync(directory));
const config = mkdtempSync(path.join(tmpdir(), "cue-complexity-"));
writeFileSync(
  path.join(config, "oxlintrc.json"),
  JSON.stringify({
    categories: { correctness: "off" },
    rules: { complexity: ["error", { max: 0 }] },
  }),
);
writeFileSync(
  path.join(config, "biome.json"),
  JSON.stringify({
    vcs: { enabled: false },
    formatter: { enabled: false },
    assist: { enabled: false },
    linter: {
      rules: {
        preset: "none",
        complexity: {
          noExcessiveCognitiveComplexity: { level: "error", options: { maxAllowedComplexity: 1 } },
        },
      },
    },
  }),
);

const highest = (command, args, pattern) => {
  const { status, stdout, stderr } = spawnSync(path.join(bin, command), args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const scores = [...`${stdout}${stderr}`.matchAll(pattern)].map(([, score]) => Number(score));
  if (status !== 0 && scores.length === 0) throw new Error(`${command} failed:\n${stderr}`);
  return Math.max(0, ...scores);
};

try {
  const [cyclomatic, cognitive] =
    sources.length === 0
      ? [0, 0]
      : [
          highest(
            "oxlint",
            ["-c", path.join(config, "oxlintrc.json"), "--format", "unix", ...sources],
            /has a complexity of (\d+)\./g,
          ),
          highest(
            "biome",
            ["lint", `--config-path=${config}`, "--max-diagnostics=none", ...sources],
            /Excessive complexity of (\d+) detected/g,
          ),
        ];
  process.stdout.write(`${JSON.stringify({ cyclomatic, cognitive })}\n`);
} finally {
  rmSync(config, { recursive: true });
}
