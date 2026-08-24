import {
  isArmed,
  PULL_THRESHOLD_PX,
  pullDistance,
  pullProgress,
  settleDelayMs,
} from "@ui/components/pull-math";
import { describe, expect, it } from "vitest";

const T = PULL_THRESHOLD_PX;

describe("pull resistance", () => {
  it("tracks the finger at half rate up to the threshold", () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(40)).toBe(20);
    expect(pullDistance(2 * T)).toBe(T);
  });

  it("never moves upward, whatever an upward drag reports", () => {
    expect(pullDistance(-200)).toBe(0);
  });

  it("resists past the threshold: real travel, but less of it", () => {
    // One more threshold of finger movement buys 75% of a threshold of travel.
    const past = pullDistance(4 * T);
    expect(past).toBeGreaterThan(T);
    expect(past).toBeLessThan(2 * T);
    expect(past).toBeCloseTo(T + T * 0.75, 6);
  });

  it("stops dead at twice the threshold, however hard it is pulled", () => {
    expect(pullDistance(6 * T)).toBeCloseTo(2 * T, 6);
    expect(pullDistance(100 * T)).toBeCloseTo(2 * T, 6);
  });

  it("is continuous and monotonic across the threshold seam", () => {
    let previous = -1;
    for (let drag = 0; drag <= 20 * T; drag += T / 8) {
      const distance = pullDistance(drag);
      expect(distance).toBeGreaterThanOrEqual(previous);
      previous = distance;
    }
  });

  it("honours a caller's own threshold", () => {
    expect(pullDistance(200, 100)).toBe(100);
    expect(pullDistance(600, 100)).toBeCloseTo(200, 6);
  });
});

describe("arm threshold", () => {
  it("arms exactly when the finger has moved twice the threshold", () => {
    expect(isArmed(pullDistance(2 * T - 2))).toBe(false);
    expect(isArmed(pullDistance(2 * T))).toBe(true);
  });

  it("disarms again on the way back, so the gesture is cancellable", () => {
    expect(isArmed(pullDistance(3 * T))).toBe(true);
    expect(isArmed(pullDistance(T))).toBe(false);
  });
});

describe("indicator sweep", () => {
  it("runs 0 → 1 over the arming travel and clamps at both ends", () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(T / 2)).toBe(0.5);
    expect(pullProgress(T)).toBe(1);
    expect(pullProgress(2 * T)).toBe(1);
    expect(pullProgress(-10)).toBe(0);
  });
});

describe("settle", () => {
  it("holds a fast pass up to the minimum visible spin", () => {
    // Unqualified, so the component's own default is pinned and not only the
    // arithmetic around whatever it happens to be.
    expect(settleDelayMs(0)).toBe(600);
    expect(settleDelayMs(0, 600)).toBe(600);
    expect(settleDelayMs(250, 600)).toBe(350);
  });

  it("adds nothing to a pass that already took longer", () => {
    expect(settleDelayMs(600, 600)).toBe(0);
    expect(settleDelayMs(5000, 600)).toBe(0);
  });
});
