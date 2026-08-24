import { clampOffset, commitDirection } from "@ui/components/swipe-math";
import { describe, expect, it } from "vitest";

describe("clampOffset", () => {
  it("tracks the finger in enabled directions", () => {
    expect(clampOffset(60, true, true)).toBe(60);
    expect(clampOffset(-60, true, true)).toBe(-60);
  });

  it("refuses to budge toward a side with no action", () => {
    expect(clampOffset(60, false, true)).toBe(0);
    expect(clampOffset(-60, true, false)).toBe(0);
  });
});

describe("commitDirection", () => {
  it("commits only past the 96px threshold", () => {
    expect(commitDirection(95)).toBeNull();
    expect(commitDirection(96)).toBe("right");
    expect(commitDirection(-95)).toBeNull();
    expect(commitDirection(-96)).toBe("left");
  });
});
