import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";

const REPOSITORY_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  env: gitEnv(),
}).trim();
const CI_WORKFLOW = path.join(REPOSITORY_ROOT, ".github/workflows/ci.yml");
const MOBILE_RELEASE_WORKFLOW = path.join(REPOSITORY_ROOT, ".github/workflows/mobile-release.yml");
const NOT_REQUIRED = ["footprint"];

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const readPushTags = (): string[] => {
  const workflow = readFileSync(MOBILE_RELEASE_WORKFLOW, "utf8");
  const matches = [...workflow.matchAll(/^ {4}tags:\s*(\[[^\]]*\])$/gm)];
  const raw = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (raw === undefined) {
    throw new Error(`expected one inline push tags array, found ${matches.length}`);
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isStringArray(parsed)) {
    throw new Error("push tags must be an array of strings");
  }
  return parsed;
};

const readPushBlock = (): string => {
  const workflow = readFileSync(MOBILE_RELEASE_WORKFLOW, "utf8");
  const matches = [
    ...workflow.matchAll(/^ {2}push:[ \t]*\r?\n([\s\S]*?)(?=^ {2}[A-Za-z_][A-Za-z0-9_-]*:)/gm),
  ];
  const pushBlock = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (pushBlock === undefined) {
    throw new Error(`expected one push trigger, found ${matches.length}`);
  }
  return pushBlock;
};

const getJobsBlock = (): string => {
  const workflow = readFileSync(CI_WORKFLOW, "utf8");

  // This intentionally parses only the top-level jobs block and its
  // two-space-indented job IDs, not general YAML.
  const matches = [
    ...workflow.matchAll(/^jobs:[ \t]*\r?\n([\s\S]*?)(?=^[^ \t\r\n#][^:\r\n]*:|(?![\s\S]))/gm),
  ];
  const jobsBlock = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (jobsBlock === undefined) {
    throw new Error(`expected one jobs block, found ${matches.length}`);
  }
  return jobsBlock;
};

type CiJob = {
  name: string;
  body: string;
};

const readCiJobs = (): CiJob[] => {
  const jobsBlock = getJobsBlock();
  const headers = [...jobsBlock.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(?:#.*)?\r?$/gm)];
  return headers.map((header, index) => ({
    name: header[1] as string,
    body: jobsBlock.slice(
      (header.index ?? 0) + header[0].length,
      headers[index + 1]?.index ?? jobsBlock.length,
    ),
  }));
};

const readRequiredChecks = (): string[] => {
  const workflow = readFileSync(MOBILE_RELEASE_WORKFLOW, "utf8");
  const matches = [...workflow.matchAll(/^ {10}REQUIRED:[ \t]*'(\[[^\]]*\])'[ \t]*$/gm)];
  const raw = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (raw === undefined) {
    throw new Error(`expected one REQUIRED JSON array, found ${matches.length}`);
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isStringArray(parsed)) {
    throw new Error("REQUIRED must be an array of strings");
  }
  return parsed;
};

describe("mobile release push trigger", () => {
  it("runs only for three-part version tags", () => {
    expect(readPushBlock()).not.toMatch(/^ {4}(?:branches|paths-ignore):/m);
    expect(readPushTags()).toEqual(["v*.*.*"]);
  });
});

describe("the iOS toolchain pin", () => {
  const selectedXcode = (workflow: string): string[] =>
    [...readFileSync(workflow, "utf8").matchAll(/xcode-select -s (\S+)/g)].flatMap(
      (match) => match[1] ?? [],
    );

  it("is the same Xcode in the CI build and the release archive", () => {
    // ci.yml's ios job exists to compile what mobile-release.yml archives. Two
    // toolchains would make it a green check for a build nobody ships, and the
    // pin is deliberate: the runner image's default Xcode moves on its own.
    const release = selectedXcode(MOBILE_RELEASE_WORKFLOW);

    expect(release).toHaveLength(1);
    expect(selectedXcode(CI_WORKFLOW)).toEqual(release);
  });
});

describe("mobile release gate required checks", () => {
  it("keeps REQUIRED aligned with CI jobs except explicit exemptions", () => {
    const requiredJobs = readCiJobs().filter((job) => !NOT_REQUIRED.includes(job.name));
    expect([...readRequiredChecks()].sort()).toEqual(requiredJobs.map((job) => job.name).sort());
  });

  it("uses CI job IDs as check-run names", () => {
    const requiredChecks = new Set(readRequiredChecks());
    const unsupportedOverrides = readCiJobs()
      .filter((job) => requiredChecks.has(job.name))
      .flatMap((job) =>
        job.body.split(/\r?\n/).filter((line) => /^ {4}(?:name|strategy|if):/.test(line)),
      );

    expect(
      unsupportedOverrides,
      "A job-level name or strategy (matrix) override means the check-run name no longer equals the job ID, while a job-level if can give it a skipped conclusion, which the release gate treats as a failure. Update the gate's REQUIRED list and the polling logic in mobile-release.yml to handle real check-run names or skipped conclusions before adding the override.",
    ).toEqual([]);
  });
});
