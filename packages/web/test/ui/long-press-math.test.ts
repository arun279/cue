import { exceedsPressSlop } from "@ui/components/long-press-math";
import { describe, expect, it } from "vitest";

describe("exceedsPressSlop", () => {
  it("holds through sub-slop jitter", () => {
    expect(exceedsPressSlop(0, 0)).toBe(false);
    expect(exceedsPressSlop(9, 0)).toBe(false);
    expect(exceedsPressSlop(5, 5)).toBe(false);
  });

  it("cancels at the slop radius on either axis", () => {
    expect(exceedsPressSlop(10, 0)).toBe(true);
    expect(exceedsPressSlop(0, -10)).toBe(true);
  });

  it("counts diagonal drift euclidean, not per-axis", () => {
    expect(exceedsPressSlop(6, 8)).toBe(true);
    expect(exceedsPressSlop(-7, 7)).toBe(false);
  });

  it("takes a custom slop radius", () => {
    expect(exceedsPressSlop(10, 0, 12)).toBe(false);
    expect(exceedsPressSlop(12, 0, 12)).toBe(true);
  });
});
