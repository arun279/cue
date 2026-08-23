import { airsLine, returnsLine } from "@ui/components/CountdownPanel";
import { describe, expect, it } from "vitest";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 12, 12, 0, 0);
const inDays = (days: number): string => new Date(NOW + days * DAY_MS).toISOString();

describe("airsLine", () => {
  it("reads as `Airs <weekday> <month> <day> · <time>`", () => {
    expect(airsLine("2026-07-16T20:00:00.000Z")).toMatch(
      /^Airs [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2}\s(AM|PM)$/,
    );
  });

  it("is null for an unparseable timestamp", () => {
    expect(airsLine("not-a-date")).toBeNull();
  });
});

describe("returnsLine", () => {
  it("leads with the given title", () => {
    expect(returnsLine(inDays(87), "S4", NOW)).toBe("S4 in 87 days");
  });

  it("falls back to `Returns` untitled", () => {
    expect(returnsLine(inDays(26), undefined, NOW)).toBe("Returns in 26 days");
  });

  it("keeps the singular day", () => {
    expect(returnsLine(inDays(1), "S4", NOW)).toBe("S4 in 1 day");
  });

  it("rounds a partial day up, never down to `today`", () => {
    expect(returnsLine(new Date(NOW + DAY_MS / 2).toISOString(), "S4", NOW)).toBe("S4 in 1 day");
  });

  it("reads `today` at and past the return moment", () => {
    expect(returnsLine(inDays(0), "S4", NOW)).toBe("S4 today");
    expect(returnsLine(inDays(-2), undefined, NOW)).toBe("Returns today");
  });

  it("is null for an unparseable timestamp", () => {
    expect(returnsLine("not-a-date", "S4", NOW)).toBeNull();
  });
});
