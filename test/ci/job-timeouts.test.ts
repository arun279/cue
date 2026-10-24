import { readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

it("sets timeout-minutes on every job that runs on a runner", () => {
  const withoutTimeout = readdirSync(repositoryPath(".github/workflows")).flatMap((file) =>
    readWorkflowJobs(repositoryPath(".github/workflows", file))
      .filter(({ body }) => /^ {4}runs-on: /m.test(body) && !/^ {4}timeout-minutes: /m.test(body))
      .map(({ name }) => `${file}: ${name}`),
  );

  expect(withoutTimeout).toEqual([]);
});
