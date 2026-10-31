import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { fakeBin } from "../support/fake-bin";
import { gitHistory } from "../support/git-history";
import { repositoryPath } from "../support/repository-path";

const bin = fakeBin({ pnpm: '#!/bin/sh\nexit "$AUDIT_STATUS"\n' });

type Audit = {
  audit?: number;
  changed?: string;
  pushed?: boolean;
  later?: boolean;
};

function audit(event: string, { audit = 1, changed = "README.md", pushed, later }: Audit) {
  const { repository, shas } = gitHistory([
    { "pnpm-lock.yaml": "lock: 1\n" },
    { "pnpm-workspace.yaml": "packages: []\n" },
    { "README.md": "base\n" },
    { [changed]: "head\n" },
    ...(later ? [{ "README.md": "later\n" }] : []),
  ]);
  const before = shas[2] ?? "";
  return spawnSync(
    "bash",
    [repositoryPath("scripts/audit-dependencies.sh"), event, ...(pushed ? [before] : [])],
    {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env["PATH"]}`,
        AUDIT_STATUS: String(audit),
      },
    },
  );
}

it.each([
  ["pull_request", {}],
  ["push", { pushed: true }],
])("only warns about a %s that leaves dependencies alone: %j", (event, change) => {
  const result = audit(event, change);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("::warning::");
});

it.each([
  ["pull_request", { changed: "pnpm-lock.yaml" }],
  ["pull_request", { changed: "pnpm-workspace.yaml" }],
  ["push", { changed: "pnpm-lock.yaml", pushed: true }],
  ["push", { changed: "pnpm-lock.yaml", pushed: true, later: true }],
])("fails a %s whose audit fails: %j", (event, change) => {
  expect(audit(event, change).status).toBe(1);
});

it("passes a clean audit without a warning", () => {
  const result = audit("pull_request", { audit: 0, changed: "pnpm-lock.yaml" });

  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("::warning::");
});
