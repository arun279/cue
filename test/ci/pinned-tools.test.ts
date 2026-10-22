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

it("restores the Maestro CLI from its pinned version's cache in every lane that installs it", () => {
  const lanes = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml"), {
    withActions: true,
  }).filter(({ body }) => body.includes("run: scripts/install-maestro.sh\n"));

  expect(lanes.map(({ name }) => name).sort()).toEqual([
    "android-e2e-light",
    "native-e2e-ios-light",
    "ui-screenshots-android-dark",
    "ui-screenshots-ios-dark",
  ]);
  for (const { body } of lanes) {
    const pin = body.indexOf(
      'run: echo "pin=$(scripts/install-maestro.sh pin)" >> "$GITHUB_OUTPUT"\n',
    );
    const cache = body.indexOf(
      "key: maestro-$" +
        "{{ runner.os }}-$" +
        "{{ runner.arch }}-$" +
        "{{ steps.pin.outputs.pin }}\n",
    );
    const install = body.indexOf("run: scripts/install-maestro.sh\n");
    expect(pin).toBeGreaterThan(-1);
    expect(cache).toBeGreaterThan(pin);
    expect(install).toBeGreaterThan(cache);
  }
});
