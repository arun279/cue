import { readFileSync } from "node:fs";

const HARNESS = [
  "packages/native/src/ui/harness.tsx",
  "packages/native/src/ui/harness-ids.ts",
  "packages/native/src/ui/AppIdle.tsx",
  "packages/native/src/ui/response-timing.ts",
];

const [, ...bundles] = readFileSync(process.argv[2] ?? "packages/native/.expo/atlas.jsonl", "utf8")
  .trim()
  .split("\n");
if (bundles.length === 0) throw new Error("the atlas holds no bundles");
const leaks = bundles.flatMap((line) => {
  const [platform, ...fields] = JSON.parse(line);
  return fields
    .filter(Array.isArray)
    .flat()
    .filter(({ relativePath }) => HARNESS.includes(relativePath))
    .map(({ relativePath }) => `${platform}: ${relativePath}`);
});
if (leaks.length > 0)
  throw new Error(`UI harness modules ship in store bundles: ${leaks.join(", ")}`);
process.stdout.write(`no UI harness modules in ${bundles.length} store bundles\n`);
