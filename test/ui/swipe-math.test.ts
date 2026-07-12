import { clampOffset, commitDirection, resolveIntent } from "@ui/components/swipe-math";
import { describe, expect, it } from "vitest";

describe("resolveIntent", () => {
  it("stays pending under the lock radius", () => {
    expect(resolveIntent(6, 4)).toBe("pending");
    expect(resolveIntent(-11, 11)).toBe("pending");
  });

  it("locks horizontal when sideways travel dominates at the radius", () => {
    expect(resolveIntent(12, 4)).toBe("horizontal");
    expect(resolveIntent(-20, 8)).toBe("horizontal");
  });

  it("hands a dominantly vertical gesture back to the scroller", () => {
    expect(resolveIntent(4, 12)).toBe("vertical");
    expect(resolveIntent(12, 12)).toBe("vertical");
  });
});

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
