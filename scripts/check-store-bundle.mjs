import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const HARNESS_MARKERS = [
  "app-idle",
  "response-timing",
  "Returning-user app idle",
  "Response timing",
];

const files = (entry) =>
  statSync(entry).isDirectory()
    ? readdirSync(entry).flatMap((child) => files(path.join(entry, child)))
    : [entry];
const bundles = files(process.argv[2] ?? "packages/native/dist").filter((file) =>
  /\.(?:hbc|js)$/.test(file),
);
if (bundles.length === 0) throw new Error("no exported bundles to check");
const leaks = bundles.flatMap((file) => {
  const bytes = readFileSync(file, "latin1");
  return HARNESS_MARKERS.filter((marker) => bytes.includes(marker)).map(
    (marker) => `${file}: ${marker}`,
  );
});
if (leaks.length > 0)
  throw new Error(`UI harness code ships in store bundles:\n${leaks.join("\n")}`);
process.stdout.write(`no UI harness code in ${bundles.length} store bundles\n`);
