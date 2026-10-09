import { readFileSync } from "node:fs";

const required = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  .engines.node;
if (process.versions.node !== required) {
  process.stderr.write(`Node ${required} required; found ${process.versions.node}.\n`);
  process.exit(1);
}
