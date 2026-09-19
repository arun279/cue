import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FILE = ".startup-time-limit.json";
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const read = (revision) =>
  JSON.parse(
    revision === undefined
      ? readFileSync(`${root}/${FILE}`, "utf8")
      : execFileSync("git", ["show", `${revision}:${FILE}`], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
  );
const validate = (config) => {
  const keys = Object.keys(config).sort();
  const expected = ["ceilingMs", "measuredOn", "measurementMs", "runUrl", "targetMs"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`startup timing: expected ${expected.join(", ")}`);
  }
  if (
    !Number.isFinite(config.measurementMs) ||
    !Number.isFinite(config.ceilingMs) ||
    !Number.isFinite(config.targetMs) ||
    config.measurementMs <= 0 ||
    config.ceilingMs < config.measurementMs ||
    config.targetMs !== Math.round(config.measurementMs * 0.8) ||
    !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/.test(
      config.runUrl,
    ) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(config.measuredOn)
  ) {
    throw new Error("startup timing: invalid measurement provenance or target");
  }
};

const config = read();
validate(config);
const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", FILE], {
  cwd: root,
  encoding: "utf8",
}).trim();
const revisions = changed
  ? ["HEAD"]
  : execFileSync("git", ["show", "-s", "--format=%P", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    })
      .trim()
      .split(" ")
      .filter(Boolean);
const ceilings = revisions.flatMap((revision) => {
  try {
    return [read(revision).ceilingMs];
  } catch {
    return [];
  }
});
if (ceilings.length > 0 && config.ceilingMs > Math.max(...ceilings)) {
  throw new Error(
    `startup timing: ceiling ${config.ceilingMs} ms exceeds previous ${Math.max(...ceilings)} ms`,
  );
}

process.stdout.write(`startup timing ceiling: ${config.ceilingMs} ms cannot increase\n`);
