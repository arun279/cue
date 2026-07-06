import { humanizeWatchMinutes, isAired, toMs } from "@domain/time";
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

describe("humanizeWatchMinutes", () => {
  it("leads with days past 24h, carrying an hr/min remainder", () => {
    expect(humanizeWatchMinutes(26_310)).toEqual({
      value: "18",
      unit: "days",
      detail: "6 hr 30 min",
    });
  });
  it("leads with hours under a day", () => {
    expect(humanizeWatchMinutes(150)).toEqual({ value: "2", unit: "hours", detail: "30 min" });
  });
  it("leads with minutes under an hour and pluralizes the unit", () => {
    expect(humanizeWatchMinutes(1)).toEqual({
      value: "1",
      unit: "minute",
      detail: "keep watching",
    });
    expect(humanizeWatchMinutes(0)).toEqual({
      value: "0",
      unit: "minutes",
      detail: "keep watching",
    });
  });
  it("singularizes a lone day and hour", () => {
    expect(humanizeWatchMinutes(1500)).toEqual({ value: "1", unit: "day", detail: "1 hr 0 min" });
    expect(humanizeWatchMinutes(61)).toEqual({ value: "1", unit: "hour", detail: "1 min" });
  });
  it("clamps negative and non-finite input to zero", () => {
    expect(humanizeWatchMinutes(-99)).toEqual({
      value: "0",
      unit: "minutes",
      detail: "keep watching",
    });
    expect(humanizeWatchMinutes(Number.NaN)).toEqual({
      value: "0",
      unit: "minutes",
      detail: "keep watching",
    });
  });
});
