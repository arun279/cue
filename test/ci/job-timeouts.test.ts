import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

const WORKFLOWS = repositoryPath(".github/workflows");

// A job that calls a reusable workflow cannot set timeout-minutes; the called
// workflow's own jobs carry theirs.
it("bounds every job that runs on a runner below GitHub's 360-minute default", () => {
  const unbounded = readdirSync(WORKFLOWS)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) =>
      readWorkflowJobs(path.join(WORKFLOWS, file))
        .filter(({ body }) => !/^ {4}uses: /m.test(body))
        .filter(({ body }) => !/^ {4}timeout-minutes: [1-9]\d*$/m.test(body))
        .map(({ name }) => `${file}: ${name}`),
    );

  expect(unbounded).toEqual([]);
});
