import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const read = (file) => readFileSync(`${root}/${file}`, "utf8");
const history = (file) =>
  execFileSync("git", ["log", "--format=%H", "--", file], { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((commit) =>
      execFileSync("git", ["show", `${commit}:${file}`], { cwd: root, encoding: "utf8" }),
    );

const parseBytes = (value) => {
  const match = /^(\d+(?:\.\d+)?) (B|kB|MB)$/.exec(value);
  if (match === null) throw new Error(`invalid size limit: ${value}`);
  return Number(match[1]) * { B: 1, kB: 1000, MB: 1_000_000 }[match[2]];
};

const config = JSON.parse(read(".size-limit.json"));
const previousConfigs = history(".size-limit.json").flatMap((contents) => JSON.parse(contents));
for (const entry of config) {
  if (
    !/^Measured \d+ bytes on \d{4}-\d{2}-\d{2}\..*Reduction target \d+ bytes/.test(entry.message)
  ) {
    throw new Error(`${entry.name}: missing measurement, date, or reduction target`);
  }
  const previous = previousConfigs
    .filter(({ name }) => name === entry.name)
    .map(({ limit }) => parseBytes(limit));
  const limit = parseBytes(entry.limit);
  if (previous.length > 0 && limit > Math.min(...previous)) {
    throw new Error(
      `${entry.name}: limit ${limit} bytes exceeds previous ${Math.min(...previous)} bytes`,
    );
  }
}

const playBudget = (workflow) => {
  const limit = /PLAY_SIZE_LIMIT_BYTES: "(\d+)"/.exec(workflow)?.[1];
  const measurement = /PLAY_SIZE_MEASUREMENT_BYTES: "(\d+)"/.exec(workflow)?.[1];
  const measuredOn = /PLAY_SIZE_MEASURED_ON: "(\d{4}-\d{2}-\d{2})"/.exec(workflow)?.[1];
  if (limit === undefined || measurement === undefined || measuredOn === undefined) {
    throw new Error("Play download: missing limit, measurement, or date");
  }
  return Number(limit);
};
const workflow = read(".github/workflows/ci.yml");
const playLimit = playBudget(workflow);
const previousPlayLimits = history(".github/workflows/ci.yml").flatMap((contents) => {
  try {
    return [playBudget(contents)];
  } catch {
    return [];
  }
});
if (previousPlayLimits.length > 0 && playLimit > Math.min(...previousPlayLimits)) {
  throw new Error(
    `Play download: limit ${playLimit} bytes exceeds previous ${Math.min(...previousPlayLimits)} bytes`,
  );
}

process.stdout.write(
  `size budget ratchet: ${config.length} bundles and Play download cannot increase\n`,
);
