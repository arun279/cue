import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

const WORKFLOWS = repositoryPath(".github/workflows");

const SLOWEST_MINUTES: Readonly<Record<string, number>> = {
  "ci.yml: check": 9.4,
  "ci.yml: render-performance": 3.9,
  "ci.yml: audit": 5.1,
  "ci.yml: actionlint": 0.3,
  "ci.yml: footprint": 1.4,
  "ci.yml: android-e2e": 28.7,
  "ci.yml: ios-e2e": 43.5,
  "codeql.yml: codeql": 2.7,
  "mobile-release.yml: gate": 0.1,
  "mobile-release.yml: ios": 20.1,
  "mobile-release.yml: android": 27.7,
  "mobile-release.yml: promote": 0.2,
  "publish-update.yml: gate": 0.1,
  "publish-update.yml: publish": 9.4,
  "publish-update.yml: promote": 0.2,
};

const jobs = readdirSync(WORKFLOWS)
  .filter((file) => /\.ya?ml$/.test(file))
  .flatMap((file) =>
    readWorkflowJobs(path.join(WORKFLOWS, file))
      .filter(({ body }) => !/^ {4}uses: /m.test(body))
      .map(({ name, body }) => ({
        key: `${file}: ${name}`,
        timeout: Number(body.match(/^ {4}timeout-minutes: ([1-9]\d*)$/m)?.[1]),
      })),
  );

it("records the slowest successful run, cold caches included, of every job that runs on a runner", () => {
  expect(jobs.map(({ key }) => key).sort()).toEqual(Object.keys(SLOWEST_MINUTES).sort());
});

it("gives every job a timeout of at least twice its slowest run and at least 5 minutes", () => {
  const short = jobs.filter(
    ({ key, timeout }) => !(timeout >= Math.max(5, 2 * (SLOWEST_MINUTES[key] ?? Infinity))),
  );

  expect(short.map(({ key, timeout }) => `${key}: ${timeout}`)).toEqual([]);
});
