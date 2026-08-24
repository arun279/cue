import { resolveIntent } from "@ui/components/gesture-intent";
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

  it("hands a dominantly vertical gesture to the scroller, ties included", () => {
    expect(resolveIntent(4, 12)).toBe("vertical");
    expect(resolveIntent(12, 12)).toBe("vertical");
  });
});
