import { isAired, toMs } from "@domain/time";
import { describe, expect, it } from "vitest";

const T = Date.parse("2026-07-05T00:00:00.000Z");

describe("toMs", () => {
  it("parses an ISO timestamp to epoch ms", () => {
    expect(toMs("2026-07-05T00:00:00.000Z")).toBe(T);
  });
  it("returns null for null, undefined, and unparseable input", () => {
    expect(toMs(null)).toBeNull();
    expect(toMs(undefined)).toBeNull();
    expect(toMs("not-a-date")).toBeNull();
  });
});

describe("isAired", () => {
  it("is true at or before now, false after or when the date is unknown", () => {
    expect(isAired("2026-07-04T00:00:00.000Z", T)).toBe(true);
    expect(isAired("2026-07-05T00:00:00.000Z", T)).toBe(true);
    expect(isAired("2026-07-06T00:00:00.000Z", T)).toBe(false);
    expect(isAired(null, T)).toBe(false);
  });
});
