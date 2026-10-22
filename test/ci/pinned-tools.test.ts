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

it("restores the Maestro CLI from its version cache in every lane that would download it", () => {
  const lanes = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(({ body }) =>
    body.includes("releases/download/cli-2.10.0/maestro.zip"),
  );

  expect(lanes.map(({ name }) => name).sort()).toEqual([
    "android-e2e-light",
    "ui-screenshots-android-dark",
  ]);
  for (const { body } of lanes) {
    const cache = body.indexOf(
      "          key: maestro-$" +
        "{{ runner.os }}-$" +
        "{{ runner.arch }}-2.10.0-29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991\n",
    );
    const guarded = body.indexOf(
      '          if [ ! -d "$RUNNER_TEMP/maestro" ]; then\n            curl -fsSL',
    );
    expect(cache).toBeGreaterThan(-1);
    expect(guarded).toBeGreaterThan(cache);
  }
});
