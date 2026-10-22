import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

const REPORTS = ["android-e2e", "native-e2e", "pr-media"];

const condition = (body: string): string =>
  body.match(/^ {4}if: (>-\n(?: {6}.+\n)+|.+\n)/m)?.[1] ?? "";

const needs = (body: string): string[] => {
  const list = body.match(/^ {4}needs: \[(.+)\]$/m)?.[1];
  if (list !== undefined) return list.split(",").map((need) => need.trim());
  const block = body.match(/^ {4}needs:\n((?: {6}- .+\n)+)/m)?.[1];
  if (block !== undefined) return [...block.matchAll(/- (\S+)/g)].map((match) => match[1] ?? "");
  return [body.match(/^ {4}needs: (\S+)$/m)?.[1]].filter((need) => need !== undefined);
};

const runsPastNeeds = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(
  ({ body }) => /always\(\)|!cancelled\(\)/.test(condition(body)),
);

it("lets only report and aggregate jobs run whatever their needs concluded", () => {
  const reports = runsPastNeeds.filter(({ body }) =>
    needs(body).some(
      (need) => !new RegExp(`needs\\.${need}\\.(result|outputs)`).test(condition(body)),
    ),
  );

  expect(reports.map(({ name }) => name).sort()).toEqual(REPORTS);
});

it("starts the iOS device lanes only after the Maestro runner they download was built", () => {
  const lanes = runsPastNeeds.filter(({ body }) => needs(body).includes("maestro-runner"));

  expect(lanes.map(({ name }) => name).sort()).toEqual([
    "native-e2e-ios-light",
    "ui-screenshots-ios-dark",
  ]);
  for (const { body } of lanes) {
    expect(condition(body)).toContain("needs.maestro-runner.result == 'success' &&");
  }
});
