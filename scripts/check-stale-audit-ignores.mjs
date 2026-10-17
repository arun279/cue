import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAuditIgnores } from "./audit-ignores.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [reportArgument, workspaceArgument = "pnpm-workspace.yaml"] = process.argv.slice(2);
const audit = () =>
  spawnSync("pnpm", ["audit", "--prod", "--json", "--config.audit-config={}"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;
const report = JSON.parse(reportArgument ? readFileSync(reportArgument, "utf8") : audit());
const reported = new Map(
  Object.values(report.advisories).map((advisory) => [
    advisory.github_advisory_id,
    advisory.module_name,
  ]),
);
for (const { ghsa, packageName } of readAuditIgnores(path.resolve(root, workspaceArgument))) {
  if (!reported.has(ghsa)) throw new Error(`${ghsa} no longer applies; remove its audit ignore`);
  if (reported.get(ghsa) !== packageName) {
    throw new Error(`${ghsa} is filed against ${reported.get(ghsa)}, not ${packageName}`);
  }
}
process.stdout.write("every audit ignore still applies to the package it names\n");
