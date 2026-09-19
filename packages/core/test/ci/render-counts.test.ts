import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function gate(base: Record<string, number>, head: Record<string, number>) {
  const directory = mkdtempSync(join(tmpdir(), "render-counts-"));
  const basePath = join(directory, "base");
  const headPath = join(directory, "head");
  for (const [file, counts] of [
    [basePath, base],
    [headPath, head],
  ] as const) {
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

const history = "history row removes one play";

describe("render count gate", () => {
  it("accepts the measured count of an introduced scenario", () => {
    expect(gate({ existing: 3 }, { existing: 3, [history]: 2 }).status).toBe(0);
  });
  it("rejects an introduced scenario with a different count", () => {
    expect(gate({}, { [history]: 3 }).status).toBe(1);
  });
  it("keeps measured base counts authoritative", () => {
    expect(gate({ [history]: 3 }, { [history]: 2 }).status).toBe(1);
  });
  it("rejects missing and unknown scenarios", () => {
    expect(gate({}, {}).status).toBe(1);
    expect(gate({}, { [history]: 2, unknown: 1 }).status).toBe(1);
  });
});
