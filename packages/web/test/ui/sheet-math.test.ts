import { releaseVelocity, settleSheet } from "@ui/components/sheet-math";
import { describe, expect, it } from "vitest";

describe("settleSheet", () => {
  describe("content sheet (one stop)", () => {
    const stops = [0];
    const dismissY = 180; // 30% of a 600px panel

    it("springs back from a quiet release under the dismiss line", () => {
      expect(settleSheet(179, 0, stops, dismissY)).toEqual({ kind: "detent", y: 0 });
    });

    it("dismisses a quiet release past the dismiss line", () => {
      expect(settleSheet(180, 0, stops, dismissY)).toEqual({ kind: "dismiss" });
    });

    it("dismisses a downward flick from a small offset", () => {
      expect(settleSheet(40, 0.6, stops, dismissY)).toEqual({ kind: "dismiss" });
    });

    it("recovers on an upward flick even past the dismiss line", () => {
      expect(settleSheet(300, -0.8, stops, dismissY)).toEqual({ kind: "detent", y: 0 });
    });
  });

  describe("tall sheet (65/92 detent pair)", () => {
    const stops = [0, 200];
    const dismissY = 350;

    it("snaps to the nearest detent on a quiet release", () => {
      expect(settleSheet(90, 0, stops, dismissY)).toEqual({ kind: "detent", y: 0 });
      expect(settleSheet(110, 0, stops, dismissY)).toEqual({ kind: "detent", y: 200 });
    });

    it("steps down one detent on a downward flick from the top", () => {
      expect(settleSheet(0, 0.7, stops, dismissY)).toEqual({ kind: "detent", y: 200 });
    });

    it("dismisses on a downward flick below the last detent", () => {
      expect(settleSheet(250, 0.7, stops, dismissY)).toEqual({ kind: "dismiss" });
    });

    it("steps up one detent on an upward flick", () => {
      expect(settleSheet(200, -0.7, stops, dismissY)).toEqual({ kind: "detent", y: 0 });
    });

    it("stays at the top detent on an upward flick from the top", () => {
      expect(settleSheet(0, -0.7, stops, dismissY)).toEqual({ kind: "detent", y: 0 });
    });

    it("dismisses a quiet release past the dismiss line", () => {
      expect(settleSheet(360, 0, stops, dismissY)).toEqual({ kind: "dismiss" });
      expect(settleSheet(300, 0, stops, dismissY)).toEqual({ kind: "detent", y: 200 });
    });
  });
});

describe("releaseVelocity", () => {
  it("is zero without two samples", () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ t: 10, y: 40 }])).toBe(0);
  });

  it("measures a steady drag", () => {
    expect(
      releaseVelocity([
        { t: 0, y: 0 },
        { t: 50, y: 50 },
        { t: 100, y: 100 },
      ]),
    ).toBe(1);
  });

  it("measures only the trailing window, not the whole gesture", () => {
    expect(
      releaseVelocity([
        { t: 0, y: 0 },
        { t: 200, y: 10 },
        { t: 260, y: 100 },
      ]),
    ).toBe(1.5);
  });

  it("reads a fast start that ends in a hold as no flick", () => {
    expect(
      releaseVelocity([
        { t: 0, y: 0 },
        { t: 50, y: 120 },
        { t: 150, y: 120 },
      ]),
    ).toBe(0);
  });
});
