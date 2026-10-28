import { readFileSync } from "node:fs";

const TEST_CLOCK = "src/shifted-date.ts";

const [, ...bundles] = readFileSync(process.argv[2] ?? ".expo/atlas.jsonl", "utf8")
  .trim()
  .split("\n");
if (bundles.length === 0) throw new Error("the atlas holds no bundles");
const leaks = bundles.flatMap((line) => {
  const [platform, ...fields] = JSON.parse(line);
  return fields
    .filter(Array.isArray)
    .flat()
    .filter(({ relativePath }) => relativePath === TEST_CLOCK)
    .map(({ relativePath }) => `${platform}: ${relativePath}`);
});
if (leaks.length > 0) throw new Error(`The test clock ships in store bundles: ${leaks.join(", ")}`);
process.stdout.write(`no test clock in ${bundles.length} store bundles\n`);
