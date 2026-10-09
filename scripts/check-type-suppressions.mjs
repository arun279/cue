import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const result = spawnSync(
  "git",
  [
    "grep",
    "-nE",
    "@ts-(expect-error|ignore)",
    "--",
    ":(glob)packages/**/*.ts",
    ":(glob)packages/**/*.tsx",
  ],
  { cwd: root, encoding: "utf8" },
);

if (result.status === 0) {
  process.stderr.write(result.stdout);
  throw new Error("TypeScript suppressions are not allowed under packages");
}
if (result.status !== 1) throw new Error(result.stderr.trim());

process.stdout.write("type suppression budget: 0\n");
