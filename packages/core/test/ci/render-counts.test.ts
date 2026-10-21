import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Significant {
  readonly name: string;
  readonly relativeDurationDiff: number;
}

function gate(
  base: Record<string, number> | undefined,
  head: Record<string, number>,
  significant?: readonly Significant[],
) {
  const directory = mkdtempSync(join(tmpdir(), "render-counts-"));
  if (significant !== undefined) {
    writeFileSync(
      join(directory, "output.json"),
      JSON.stringify({
        significant: significant.map((entry) => ({
          ...entry,
          baseline: { meanDuration: 10 },
          current: { meanDuration: 10 * (1 + entry.relativeDurationDiff) },
        })),
      }),
    );
  }
  const basePath = join(directory, "base");
  const headPath = join(directory, "head");
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
  try {
    return spawnSync(process.execPath, ["scripts/check-render-counts.mjs", basePath, headPath], {
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
}

const pinned: Record<string, number> = JSON.parse(
  readFileSync("scripts/render-count-baselines.json", "utf8"),
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
  it("rejects missing and unknown scenarios", () => {
    expect(gate({}, {}).status).toBe(1);
    expect(gate({}, { ...pinned, unknown: 1 }).stderr).toContain("scenario: unknown");
  });
});
