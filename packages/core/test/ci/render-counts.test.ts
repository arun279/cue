import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function gate(base: Record<string, number> | undefined, head: Record<string, number>) {
  const directory = mkdtempSync(join(tmpdir(), "render-counts-"));
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
  it("rejects missing and unknown scenarios", () => {
    expect(gate({}, {}).status).toBe(1);
    expect(gate({}, { ...pinned, unknown: 1 }).stderr).toContain("scenario: unknown");
  });
});
