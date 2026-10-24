import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAuditIgnores } from "./audit-ignores.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [
  atlasArgument = "packages/native/.expo/atlas.jsonl",
  workspaceArgument = "pnpm-workspace.yaml",
] = process.argv.slice(2);
const [, ...bundles] = readFileSync(path.resolve(root, atlasArgument), "utf8").trim().split("\n");
if (bundles.length === 0) throw new Error("the atlas holds no bundles");
const shipped = bundles.flatMap((line) => {
  const [platform, ...fields] = JSON.parse(line);
  return fields
    .filter(Array.isArray)
    .flat()
    .map(({ relativePath }) => `${platform}: ${relativePath}`);
});
for (const { ghsa, packageName } of readAuditIgnores(path.resolve(root, workspaceArgument))) {
  const leaks = shipped.filter((entry) => entry.includes(`node_modules/${packageName}/`));
  if (leaks.length > 0) throw new Error(`${packageName} (${ghsa}) ships in ${leaks.join(", ")}`);
}
process.stdout.write(`audit-ignored packages absent from ${shipped.length} shipped modules\n`);
