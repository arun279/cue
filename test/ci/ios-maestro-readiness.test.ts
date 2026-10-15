import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

it("readies the simulator in its final appearance, then runs Maestro once, in every iOS lane", () => {
  const lanes = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(
    ({ body }) => body.includes("runs-on: macos") && /maestro/i.test(body),
  );
  expect(lanes.map(({ name }) => name)).toEqual([
    "native-e2e-ios-light",
    "ui-screenshots-ios-dark",
  ]);
  for (const { name, body } of lanes) {
    const prepare = body.indexOf("scripts/prepare-ios-ui.sh");
    expect(body).toContain(
      `scripts/prepare-ios-ui.sh "$RUNNER_TEMP/native-ios-app" ${name.includes("dark") ? "dark" : "light"}\n`,
    );
    expect(body).not.toContain("simctl ui");
    const runs = [...body.matchAll(/^\s*bash scripts\/maestro-test\.sh\s.*$/gm)];
    expect(prepare).toBeGreaterThan(-1);
    expect(runs.map(([run]) => run.trim())).toEqual([
      expect.stringMatching(/^bash scripts\/maestro-test\.sh --device "\$DEVICE_ID" test /),
    ]);
    expect(runs[0]?.index).toBeGreaterThan(prepare);
  }
});

it("starts the fake Trakt server before booting the simulator, while the runner is idle", () => {
  const script = readFileSync(repositoryPath("scripts/prepare-ios-ui.sh"), "utf8");
  const server = script.indexOf("scripts/start-ready-process.mjs scripts/mock-trakt/server.mjs");
  expect(server).toBeGreaterThan(-1);
  expect(server).toBeLessThan(script.indexOf("simctl boot"));
});
