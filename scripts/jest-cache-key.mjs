import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BABEL_CONFIG = /(^|\/)(babel\.config\.[cm]?js|\.babelrc(\.[cm]?js|\.json)?)$/;
const JEST_CONFIG = /(^|\/)jest\.config\.[cm]?js$/;

/**
 * The CI cache key for Jest's transform cache under `root`.
 *
 * babel-jest keys each cached file on its source, the Babel options as JSON
 * and the config file's path, so it misses a change to the code of a Babel
 * config or plugin, and to the presets the lockfile installs. This key covers
 * them: the Node version, the lockfile, every Babel and Jest config file, and
 * every file in the repository that loading those configs pulls in, which is
 * where a custom plugin lives. `tracked` lists the repository's files.
 */
export function jestCacheKey(directory, tracked) {
  const root = realpathSync(directory);
  const babelConfigs = tracked.filter((file) => BABEL_CONFIG.test(file));
  const jestConfigs = tracked.filter((file) => JEST_CONFIG.test(file));
  const require = createRequire(path.join(root, "package.json"));
  for (const config of babelConfigs) {
    const cwd = path.dirname(path.join(root, config));
    createRequire(path.join(cwd, "package.json"))("@babel/core").loadPartialConfigSync({
      cwd,
      filename: path.join(cwd, "index.js"),
    });
  }
  for (const config of jestConfigs) require(path.join(root, config));
  const loaded = Object.keys(require.cache)
    .filter(
      (file) =>
        file.startsWith(root + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`),
    )
    .map((file) => path.relative(root, file));
  const files = [...new Set(["pnpm-lock.yaml", ...babelConfigs, ...jestConfigs, ...loaded])].sort();
  const hash = createHash("sha256").update(process.version);
  for (const file of files) hash.update(`\0${file}\0`).update(readFileSync(path.join(root, file)));
  return hash.digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n");
  process.stdout.write(`${jestCacheKey(process.cwd(), tracked)}\n`);
}
