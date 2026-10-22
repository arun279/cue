import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

interface Significant {
  readonly name: string;
  readonly relativeDurationDiff: number;
}

function gate(
  base: Record<string, number> | undefined,
  head: Record<string, number>,
  significant?: readonly Significant[],
  body?: string,
) {
  const directory = tempDirectory("cue-render-counts-");
  if (significant !== undefined) {
    writeFileSync(
      path.join(directory, "output.json"),
      JSON.stringify({
        significant: significant.map((entry) => ({
          ...entry,
          baseline: { meanDuration: 10 },
          current: { meanDuration: 10 * (1 + entry.relativeDurationDiff) },
        })),
      }),
    );
  }
  const basePath = path.join(directory, "base");
  const headPath = path.join(directory, "head");
  for (const [file, counts] of [
    [basePath, base],
    [headPath, head],
  ] as const) {
    if (counts === undefined) continue;
    writeFileSync(
      file,
      [
        JSON.stringify({ metadata: {} }),
        ...Object.entries(counts).map(([name, meanCount]) => JSON.stringify({ name, meanCount })),
      ].join("\n"),
    );
  }
  return spawnSync(
    process.execPath,
    [
      repositoryPath("scripts/check-render-counts.mjs"),
      basePath,
      headPath,
      ...(body === undefined ? [] : [body]),
    ],
    { encoding: "utf8" },
  );
}

const pinned: Record<string, number> = JSON.parse(
  readFileSync(repositoryPath("scripts/render-count-baselines.json"), "utf8"),
);
const history = "history row removes one play";

describe("render count gate", () => {
  it("accepts the measured count of an introduced scenario", () => {
    expect(gate({ existing: 3 }, { existing: 3, ...pinned }).status).toBe(0);
  });
  it("rejects an introduced scenario with a different count", () => {
    expect(gate({}, { ...pinned, [history]: 3 }).stderr).toContain("allowed deviation of 0");
  });
  it("treats every scenario as introduced when the base has no render suite", () => {
    expect(gate(undefined, pinned).status).toBe(0);
    expect(gate(undefined, { ...pinned, [history]: 3 }).status).toBe(1);
  });
  it("keeps measured base counts authoritative", () => {
    expect(gate({ ...pinned, [history]: 3 }, pinned).stderr).toContain("allowed deviation of 0");
  });
  it("fails a significant slowdown past 20% in a duration-gated scenario only", () => {
    const library = "Library first mount";
    const slower = (name: string, relativeDurationDiff: number) =>
      gate(pinned, pinned, [{ name, relativeDurationDiff }]);
    expect(slower(library, 0.25).stderr).toContain("slowed by more than 20%");
    expect(slower(library, 0.15).status).toBe(0);
    expect(slower(library, -0.4).status).toBe(0);
    expect(slower(history, 0.5).status).toBe(0);
  });
  it("accepts a count change only when the pull request states that exact change and why", () => {
    const changed = (body: string) => gate({ ...pinned, [history]: 3 }, pinned, [], body);
    const stated = `Render-Count: ${history} 3 -> 2: the deferred list render is held.`;

    expect(changed(`Summary.\n${stated}\n`).status).toBe(0);
    expect(changed(`Render-Count: ${history} 3 -> 1: wrong target.`).status).toBe(1);
    expect(changed(`Render-Count: ${history} 4 -> 2: wrong base.`).status).toBe(1);
    expect(changed(`Render-Count: queue row 3 -> 2: another scenario.`).status).toBe(1);
    expect(changed(`Render-Count: ${history} 3 -> 2: `).status).toBe(1);
    expect(changed(`  ${stated}`).status).toBe(1);
  });
  it("rejects missing and unknown scenarios", () => {
    expect(gate({}, {}).status).toBe(1);
    expect(gate({}, { ...pinned, unknown: 1 }).stderr).toContain("scenario: unknown");
  });
});

it("hands the pull request's description to the render gate", () => {
  const job = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).find(
    ({ name }) => name === "render-performance",
  );

  expect(job?.body).toContain("      pull-requests: read\n");
  expect(job?.body).toContain('PR_BODY=$(gh pr view "$PR_NUMBER" --json body --jq .body)\n');
  expect(job?.body).toContain('pnpm check:render-counts "$PR_BODY"\n');
});
