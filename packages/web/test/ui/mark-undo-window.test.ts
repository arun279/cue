import { appendToBatch, reArmDelay } from "@cue/core/hooks/mark-undo-window";
import { describe, expect, it } from "vitest";

const at = (ms: number): { at: number; id: string } => ({ at: ms, id: String(ms) });

describe("appendToBatch", () => {
  it("starts a batch from empty", () => {
    expect(appendToBatch([], at(1000))).toEqual([at(1000)]);
  });

  it("coalesces marks landing within the rolling window", () => {
    let batch = appendToBatch([], at(0));
    batch = appendToBatch(batch, at(4000));
    batch = appendToBatch(batch, at(8000));
    expect(batch.map((entry) => entry.at)).toEqual([0, 4000, 8000]);
  });

  it("rolls the window from the LAST mark, not the first", () => {
    let batch = appendToBatch([], at(0));
    batch = appendToBatch(batch, at(4900));
    // 9000 is >5s after the first mark but within 5s of the second: same batch.
    batch = appendToBatch(batch, at(9000));
    expect(batch).toHaveLength(3);
  });

  it("starts fresh once the window has lapsed", () => {
    const batch = appendToBatch([at(0)], at(5001));
    expect(batch).toEqual([at(5001)]);
  });

  it("honors a custom window", () => {
    expect(appendToBatch([at(0)], at(150), 100)).toEqual([at(150)]);
    expect(appendToBatch([at(0)], at(90), 100)).toHaveLength(2);
  });
});

describe("reArmDelay", () => {
  it("never re-arms while the authoritative next episode is still pending", () => {
    expect(reArmDelay(1000, true, 900_000)).toBeNull();
  });

  it("waits out the minimum visual window after the advance lands", () => {
    expect(reArmDelay(1000, false, 1100)).toBe(180);
  });

  it("re-arms immediately once the minimum window has passed", () => {
    expect(reArmDelay(1000, false, 2000)).toBe(0);
  });
});
