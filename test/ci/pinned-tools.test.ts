import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

const setup = readFileSync(repositoryPath(".github/actions/setup-node-pnpm/action.yml"), "utf8");
const manifest: { packageManager: string } = JSON.parse(
  readFileSync(repositoryPath("package.json"), "utf8"),
);

it("pins pnpm by version and by the hash Corepack checks a download against", () => {
  expect(manifest.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
});

it("restores pnpm from a cache keyed by the pinned spec and goes offline once it is installed", () => {
  expect(setup).not.toContain("pnpm/action-setup");
  expect(setup).toContain(
    '      run: echo "spec=$(node -p \'require("./package.json").packageManager\')" >> "$GITHUB_OUTPUT"\n',
  );
  expect(setup).toContain(
    "        path: $" +
      "{{ runner.temp }}/corepack\n" +
      "        key: corepack-$" +
      "{{ runner.os }}-$" +
      "{{ runner.arch }}-$" +
      "{{ steps.pnpm.outputs.spec }}\n",
  );
  expect(setup).toContain(
    "        COREPACK_ENABLE_NETWORK: $" +
      "{{ steps.corepack.outputs.cache-hit == 'true' && '0' || '1' }}\n",
  );
  expect(setup).toContain('          echo "COREPACK_ENABLE_NETWORK=0"\n');
  expect(setup).not.toContain("restore-keys");
});

it("installs the same pinned Maestro release in every lane that runs the smoke flows", () => {
  const lanes = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(({ body }) =>
    body.includes(" test .maestro/smoke"),
  );

  expect(lanes.map(({ name }) => name).sort()).toEqual(["android-e2e", "ios-e2e"]);
  const pins = lanes.map(({ body }) => body.match(/^ {6}MAESTRO_VERSION: (\d+\.\d+\.\d+)$/m)?.[1]);
  expect(pins[0]).toBeDefined();
  expect(new Set(pins).size).toBe(1);
});
