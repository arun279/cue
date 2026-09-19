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
const CODEQL_WORKFLOW = path.join(REPOSITORY_ROOT, ".github/workflows/codeql.yml");
const MOBILE_RELEASE_WORKFLOW = path.join(REPOSITORY_ROOT, ".github/workflows/mobile-release.yml");
const FASTLANE_LANE = "$" + "{{ needs.config.outputs.fastlane_lane }}";
const TRAKT_CLIENT_ID_VARIABLE = "$" + "{{ vars.EXPO_PUBLIC_TRAKT_CLIENT_ID }}";
// `footprint` skips itself on forks, and the gate reads a skip as a failure.
// The iOS light matrix reports through the required `native-e2e` aggregate.
const NOT_REQUIRED = ["fingerprint", "footprint", "native-e2e-ios-light"];

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const getJobsBlock = (workflowPath: string): string => {
  const workflow = readFileSync(workflowPath, "utf8");

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

const readWorkflowJobs = (workflowPath: string): CiJob[] => {
  const jobsBlock = getJobsBlock(workflowPath);
  const headers = [...jobsBlock.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(?:#.*)?\r?$/gm)];
  return headers.map((header, index) => ({
    name: header[1] as string,
    body: jobsBlock.slice(
      (header.index ?? 0) + header[0].length,
      headers[index + 1]?.index ?? jobsBlock.length,
    ),
  }));
};

const readCiJobs = (): CiJob[] => readWorkflowJobs(CI_WORKFLOW);

const readNamedStep = (workflowPath: string, jobName: string, stepName: string): string => {
  const job = readWorkflowJobs(workflowPath).find(({ name }) => name === jobName);
  if (job === undefined) throw new Error(`expected ${jobName} job`);

  const marker = `      - name: ${stepName}`;
  const start = job.body.indexOf(marker);
  if (start === -1) throw new Error(`expected ${jobName} step ${stepName}`);

  const remainder = job.body.slice(start + marker.length);
  const nextStep = /^ {6}- /m.exec(remainder);
  return remainder.slice(0, nextStep?.index ?? remainder.length);
};

const readCodeqlContexts = (): string[] => {
  const jobs = readWorkflowJobs(CODEQL_WORKFLOW);
  const codeql = jobs.find((job) => job.name === "codeql");
  if (codeql === undefined) throw new Error("expected a codeql job");

  const nameMatches = [...codeql.body.matchAll(/^ {4}name:[ \t]*(.+?)[ \t]*$/gm)];
  const name = nameMatches.length === 1 ? nameMatches[0]?.[1] : undefined;
  const languageExpression = /\$\{\{\s*matrix\.language\s*\}\}/;
  if (name === undefined || !languageExpression.test(name)) {
    throw new Error(
      `expected one CodeQL job name containing the language matrix, found ${nameMatches.length}`,
    );
  }

  const languageMatches = [...codeql.body.matchAll(/^ {8}language:[ \t]*\[([^\]]*)\][ \t]*$/gm)];
  const languageList = languageMatches.length === 1 ? languageMatches[0]?.[1] : undefined;
  if (languageList === undefined) {
    throw new Error(`expected one inline CodeQL language matrix, found ${languageMatches.length}`);
  }

  return languageList
    .split(",")
    .map((language) =>
      name.replace(languageExpression, language.trim().replace(/^(["'])(.*)\1$/, "$2")),
    );
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

describe("mobile release triggers", () => {
  it("releases automatically only from strict version tags", () => {
    const workflow = readFileSync(MOBILE_RELEASE_WORKFLOW, "utf8");
    const push = /^ {2}push:\r?\n((?: {4}.*\r?\n)*)/m.exec(workflow)?.[1];

    expect(push).toBeDefined();
    expect(push).not.toMatch(/^ {4}branches:/m);
    expect(push).not.toMatch(/^ {4}paths-ignore:/m);
    expect(push).toContain('    tags: ["v*.*.*"]');
  });
});

describe("the iOS toolchain pin", () => {
  const selectedXcode = (workflow: string): string[] =>
    [...readFileSync(workflow, "utf8").matchAll(/xcode-select -s (\S+)/g)].flatMap(
      (match) => match[1] ?? [],
    );

  it("is the same Xcode in every CI build and in the release archive", () => {
    // ci.yml's iOS jobs exist to compile what mobile-release.yml archives. A
    // second toolchain would make one of them a green check for a build nobody
    // ships, and the pin is deliberate: the runner image's default Xcode moves
    // on its own.
    const release = selectedXcode(MOBILE_RELEASE_WORKFLOW);
    const ci = selectedXcode(CI_WORKFLOW);

    expect(release).toHaveLength(1);
    expect(ci.length).toBeGreaterThan(0);
    expect([...new Set(ci)]).toEqual(release);
  });

  it("builds only the pull request head simulator app", () => {
    const nativeIos = readWorkflowJobs(CI_WORKFLOW).find(({ name }) => name === "native-ios");

    expect(nativeIos).toBeDefined();
    expect(nativeIos?.body.match(/xcodebuild/g)).toHaveLength(1);
    expect(nativeIos?.body).not.toContain("Measure the merge-base simulator app");
    expect(nativeIos?.body).toContain(
      "name: cue-native-ios-$" + "{{ needs.fingerprint.outputs.ios }}",
    );
  });
});

describe("native bundle environment", () => {
  it.each([
    [CI_WORKFLOW, "native-android", "Build release artifacts", "ci"],
    [
      MOBILE_RELEASE_WORKFLOW,
      "android",
      `Fastlane android ${FASTLANE_LANE}`,
      TRAKT_CLIENT_ID_VARIABLE,
    ],
    [MOBILE_RELEASE_WORKFLOW, "ios", `Fastlane ios ${FASTLANE_LANE}`, TRAKT_CLIENT_ID_VARIABLE],
  ])("embeds the Trakt client id in %s's %s bundle", (workflow, job, step, value) => {
    expect(readNamedStep(workflow, job, step)).toContain(
      `          EXPO_PUBLIC_TRAKT_CLIENT_ID: ${value}`,
    );
  });

  it("keeps only the distributor size limits", () => {
    const workflow = readFileSync(MOBILE_RELEASE_WORKFLOW, "utf8");
    const iosLane = readNamedStep(MOBILE_RELEASE_WORKFLOW, "ios", `Fastlane ios ${FASTLANE_LANE}`);
    const androidLane = readNamedStep(
      MOBILE_RELEASE_WORKFLOW,
      "android",
      `Fastlane android ${FASTLANE_LANE}`,
    );

    expect(androidLane).toContain('PLAY_BASE_MODULE_LIMIT_BYTES: "500000000"');
    expect(androidLane).toContain('FIREBASE_BINARY_LIMIT_BYTES: "2147483648"');
    expect(workflow).toContain(
      "App Store Connect alerts when a thinned device variant exceeds its 200 MB over-the-air limit.",
    );
    expect(iosLane).not.toContain("IPA_SIZE_LIMIT_BYTES");
    expect(workflow).not.toContain(".size-limit.json");
  });
});

describe("mobile release gate required checks", () => {
  it("keeps REQUIRED aligned with CI jobs except explicit exemptions", () => {
    const requiredJobs = readCiJobs().filter((job) => !NOT_REQUIRED.includes(job.name));
    expect([...readRequiredChecks()].sort()).toEqual(
      [...requiredJobs.map((job) => job.name), ...readCodeqlContexts()].sort(),
    );
  });

  it("uses only modeled workflow check-run names", () => {
    const requiredChecks = new Set(readRequiredChecks());
    const unsupportedOverrides = [
      ...readCiJobs()
        .filter((job) => requiredChecks.has(job.name))
        .flatMap((job) =>
          job.body
            .split(/\r?\n/)
            .filter(
              (line) =>
                /^ {4}(?:name|strategy|if):/.test(line) &&
                (job.name !== "native-e2e" || line !== "    if: $" + "{{ always() }}"),
            ),
        ),
      ...readWorkflowJobs(CODEQL_WORKFLOW).flatMap((job) =>
        job.body.split(/\r?\n/).filter((line) => /^ {4}if:/.test(line)),
      ),
    ];

    expect(
      unsupportedOverrides,
      "An unsupported job-level name or strategy means the check-run name no longer matches the release gate, while a job-level condition can skip a required check. Model any override before adding it.",
    ).toEqual([]);
  });
});
