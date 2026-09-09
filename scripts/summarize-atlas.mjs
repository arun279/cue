import { readFileSync } from "node:fs";

const [file = "packages/native/.expo/atlas.jsonl"] = process.argv.slice(2);
const [, ...bundles] = readFileSync(file, "utf8").trim().split(/\r?\n/).map(JSON.parse);
const platformNames = { ios: "iOS", android: "Android" };

process.stdout.write("\n### Expo Atlas top contributors\n\n");
process.stdout.write("| platform | contributor | transformed bytes |\n");
process.stdout.write("| --- | --- | ---: |\n");
for (const [platform, , , , , runtimeModules, modules] of bundles) {
  const sizes = new Map();
  for (const module of [...runtimeModules, ...modules]) {
    const contributor = module.package ?? "Cue app";
    sizes.set(contributor, (sizes.get(contributor) ?? 0) + module.size);
  }
  for (const [contributor, bytes] of [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    process.stdout.write(`| ${platformNames[platform]} | ${contributor} | ${bytes} |\n`);
  }
}
