import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scope = process.argv[2];
const prefix = scope === "web" ? "web " : scope === "native" ? "expo " : null;
if (prefix === null) throw new Error("usage: check-size.mjs <web|native>");

const config = JSON.parse(readFileSync(path.join(root, ".size-limit.json"), "utf8"));
const checks = config
  .filter(({ name }) => name.startsWith(prefix))
  .map((check) => ({
    ...check,
    path: Array.isArray(check.path)
      ? check.path.map((entry) => path.resolve(root, entry))
      : path.resolve(root, check.path),
  }));
const cache = path.join(root, "node_modules", ".cache", "cue-size-limit");
mkdirSync(cache, { recursive: true });
const configPath = path.join(cache, `${scope}.json`);
writeFileSync(configPath, JSON.stringify(checks));

const result = spawnSync(
  process.execPath,
  [path.join(root, "node_modules", "size-limit", "bin.js"), "--config", configPath],
  { cwd: root, stdio: "inherit" },
);
unlinkSync(configPath);
process.exit(result.status ?? 1);
