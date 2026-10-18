import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
function commands(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Cannot read Maestro commands ${file}: ${error.message}`);
    return [];
  }
}
const files = new Set();
for (const name of ["--debug-output", "--test-output-dir"]) {
  if (!args.includes(name) || !existsSync(option(name))) continue;
  for (const file of readdirSync(option(name), { recursive: true })) {
    files.add(join(option(name), file));
  }
}
let failures = 0;
for (const file of [...files].sort()) {
  if (basename(file) !== "commands.json") continue;
  for (const { command, metadata } of commands(file)) {
    if (metadata.status !== "FAILED") continue;
    failures += 1;
    console.error(`Failing flow: ${dirname(file)}`);
    console.error(`Command: ${JSON.stringify(metadata.evaluatedCommand ?? command)}`);
    console.error(`Maestro reason: ${metadata.error?.message ?? "No reason recorded"}`);
    const screenshots = (metadata.artifacts ?? []).filter((item) => item.kind === "SCREENSHOT");
    for (const screenshot of screenshots) {
      console.error(`Failure screenshot: ${join(dirname(file), screenshot.relativePath)}`);
    }
    if (screenshots.length === 0) console.error("Failure screenshot: not produced by Maestro");
  }
}
for (const file of files) {
  if (basename(file) !== "device-simulator.log") continue;
  for (const [line] of readFileSync(file, "utf8").matchAll(/^.*ignoring digitizer event.*$/gm)) {
    console.error(`Dropped touch: ${line}`);
  }
}
if (failures === 0) {
  console.error("Maestro failed before recording a failed command. Diagnostic files:");
  for (const file of files) {
    if (basename(file) === "maestro.log") console.error(readFileSync(file, "utf8"));
  }
  if (args.includes("--output") && existsSync(option("--output"))) {
    console.error(readFileSync(option("--output"), "utf8"));
  }
  console.error("Failure screenshot: not produced by Maestro");
}
