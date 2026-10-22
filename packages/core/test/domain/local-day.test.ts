import { airedLastNight, localDaysBetween, startOfLocalDay } from "@cue/core/domain/day";
import { historyRange } from "@cue/core/domain/history";
import { continuePosition } from "@cue/core/domain/show-detail";
import { lastWatchedPhrase } from "@cue/core/format";
import { describe, expect, it } from "vitest";

const CHICAGO = "America/Chicago";
const at = (iso: string): number => Date.parse(iso);

describe("local day helpers", () => {
  it("finds the instant a local day begins, including the day clocks change", () => {
    expect(new Date(startOfLocalDay(CHICAGO, "2026-10-21")).toISOString()).toBe(
      "2026-10-21T05:00:00.000Z",
    );
    expect(new Date(startOfLocalDay(CHICAGO, "2026-03-08")).toISOString()).toBe(
      "2026-03-08T06:00:00.000Z",
    );
    expect(new Date(startOfLocalDay(CHICAGO, "2026-11-01")).toISOString()).toBe(
      "2026-11-01T05:00:00.000Z",
    );
    expect(new Date(startOfLocalDay("Australia/Sydney", "2026-04-05")).toISOString()).toBe(
      "2026-04-04T13:00:00.000Z",
    );
  });

  it("starts a day at 1 am where clocks jump forward at midnight", () => {
    expect(new Date(startOfLocalDay("America/Santiago", "2026-09-06")).toISOString()).toBe(
      "2026-09-06T04:00:00.000Z",
    );
    expect(new Date(startOfLocalDay("America/Havana", "2026-03-08")).toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
  });

  it("counts calendar days in the zone, not 24-hour spans", () => {
    expect(localDaysBetween(CHICAGO, at("2026-10-21T04:00:00Z"), at("2026-10-21T06:00:00Z"))).toBe(
      1,
    );
    expect(localDaysBetween("UTC", at("2026-10-21T04:00:00Z"), at("2026-10-21T06:00:00Z"))).toBe(0);
  });
});

describe("day boundaries across local midnight in a non-UTC zone", () => {
  // 11 pm on Tuesday 20 October, US Central, and the early hours of Wednesday.
  const tuesdayLate = "2026-10-21T04:00:00Z";
  const wednesdayEarly = at("2026-10-21T06:00:00Z");

  it("calls a watch at 11 pm 'yesterday' an hour after midnight", () => {
    expect(lastWatchedPhrase(tuesdayLate, wednesdayEarly, CHICAGO)).toBe("yesterday");
  });

  it("bounds a history month by local midnights", () => {
    expect(historyRange(2026, 6, CHICAGO)).toEqual({
      startAt: "2026-06-01T05:00:00.000Z",
      endAt: "2026-07-01T04:59:59.999Z",
    });
    expect(historyRange(2026, 3, CHICAGO)).toEqual({
      startAt: "2026-03-01T06:00:00.000Z",
      endAt: "2026-04-01T04:59:59.999Z",
    });
  });

  it("counts a return date in calendar days", () => {
    const entry = {
      pendingAdvance: false,
      completed: 8,
      aired: 8,
      status: "returning series",
      nextEpisode: {
        season: 3,
        number: 1,
        title: null,
        firstAired: "2026-10-22T06:00:00.000Z",
        still: null,
        ids: { trakt: 1 },
      },
    };
    expect(continuePosition(entry, at("2026-10-21T05:30:00Z"), CHICAGO)).toEqual({
      kind: "returning",
      season: 3,
      days: 1,
    });
  });

  it("says 'aired last night' only for the previous local evening or the small hours", () => {
    const afternoon = at("2026-10-21T20:00:00Z");
    expect(airedLastNight(at("2026-10-21T02:00:00Z"), afternoon, CHICAGO)).toBe(true);
    expect(airedLastNight(at("2026-10-21T07:00:00Z"), afternoon, CHICAGO)).toBe(true);
    expect(airedLastNight(at("2026-10-21T15:00:00Z"), afternoon, CHICAGO)).toBe(false);
    expect(airedLastNight(at("2026-10-19T23:00:00Z"), afternoon, CHICAGO)).toBe(false);
    expect(airedLastNight(at("2026-10-21T21:00:00Z"), afternoon, CHICAGO)).toBe(false);
  });
});
