/**
 * The size gates in `.size-limit.json`, run one scope at a time because the two
 * artefacts are built by different steps: `pnpm check` builds and measures the
 * web bundles, and CI's native-android job builds and measures the two Hermes
 * bundles after an `expo export`.
 *
 * Every ceiling is the measured artefact plus headroom, which is the only method
 * available for a number with no external anchor. The native pair was last
 * measured at 5.11 MB on iOS and 5.24 MB on Android, when gesture handler,
 * Reanimated, `@expo/ui` and the linear gradient entered the bundle. Moving a
 * ceiling means re-measuring first and saying what it measured.
 */
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
