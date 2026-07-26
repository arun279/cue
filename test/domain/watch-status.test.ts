import { computeWatchStatus, isTerminalStatus, type WatchStatus } from "@domain/watch-status";
import { describe, expect, it } from "vitest";
import { airedNext, DAY, futureNext, iso, makeShow, NOW, THRESHOLD } from "./_helpers";

describe("isTerminalStatus", () => {
  it("is true for ended/canceled/cancelled (any casing) and false otherwise", () => {
    expect(isTerminalStatus("ended")).toBe(true);
    expect(isTerminalStatus("Canceled")).toBe(true);
    expect(isTerminalStatus("CANCELLED")).toBe(true);
    expect(isTerminalStatus("returning series")).toBe(false);
    expect(isTerminalStatus("")).toBe(false);
  });
});

describe("computeWatchStatus", () => {
  const cases: Array<{
    name: string;
    show: Parameters<typeof computeWatchStatus>[0];
    expect: WatchStatus;
  }> = [
    {
      name: "hidden overrides everything → abandoned",
      show: makeShow({
        hidden: true,
        completed: 0,
        aired: 10,
        status: "ended",
        nextEpisode: airedNext,
        lastWatchedAt: iso(NOW - DAY),
      }),
      expect: "abandoned",
    },
    {
      name: "completed 0 → not-started",
      show: makeShow({ completed: 0, inWatchlist: true, nextEpisode: airedNext }),
      expect: "not-started",
    },
    {
      name: "backlog with no known next (beyond budget) → watching, never fabricated caught-up",
      show: makeShow({
        completed: 3,
        aired: 10,
        nextEpisode: null,
        lastWatchedAt: iso(NOW - DAY),
      }),
      expect: "watching",
    },
    {
      name: "idle backlog with no known next → lapsed",
      show: makeShow({
        completed: 3,
        aired: 10,
        nextEpisode: null,
        lastWatchedAt: iso(NOW - THRESHOLD - 1),
      }),
      expect: "lapsed",
    },
    {
      name: "caught up, ended → ended",
      show: makeShow({ completed: 10, aired: 10, status: "ended", nextEpisode: null }),
      expect: "ended",
    },
    {
      name: "caught up, canceled → ended",
      show: makeShow({ completed: 10, aired: 10, status: "canceled", nextEpisode: futureNext }),
      expect: "ended",
    },
    {
      name: "caught up, cancelled → ended",
      show: makeShow({ completed: 10, aired: 10, status: "cancelled", nextEpisode: airedNext }),
      expect: "ended",
    },
    {
      name: "terminal casing is normalized",
      show: makeShow({ completed: 10, aired: 10, status: "Ended", nextEpisode: null }),
      expect: "ended",
    },
    {
      name: "caught up, returning, nothing announced → caught-up",
      show: makeShow({ completed: 10, aired: 10, status: "returning series", nextEpisode: null }),
      expect: "caught-up",
    },
    {
      name: "caught up, returning, future-only next → caught-up",
      show: makeShow({
        completed: 10,
        aired: 10,
        status: "returning series",
        nextEpisode: futureNext,
      }),
      expect: "caught-up",
    },
    {
      name: "fresh with aired next → watching",
      show: makeShow({
        completed: 10,
        aired: 10,
        nextEpisode: airedNext,
        lastWatchedAt: iso(NOW - THRESHOLD),
      }),
      expect: "watching",
    },
    {
      name: "stale with aired next → lapsed",
      show: makeShow({
        completed: 10,
        aired: 10,
        nextEpisode: airedNext,
        lastWatchedAt: iso(NOW - THRESHOLD - 1),
      }),
      expect: "lapsed",
    },
    {
      name: "null lastWatchedAt with aired next → lapsed",
      show: makeShow({ completed: 10, aired: 10, nextEpisode: airedNext, lastWatchedAt: null }),
      expect: "lapsed",
    },
    {
      name: "fresh backlog with aired next → watching",
      show: makeShow({
        completed: 5,
        aired: 10,
        nextEpisode: airedNext,
        lastWatchedAt: iso(NOW - DAY),
      }),
      expect: "watching",
    },
    {
      name: "stale backlog with aired next → lapsed",
      show: makeShow({
        completed: 5,
        aired: 10,
        nextEpisode: airedNext,
        lastWatchedAt: iso(NOW - THRESHOLD - 1),
      }),
      expect: "lapsed",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(computeWatchStatus(c.show, NOW, THRESHOLD)).toBe(c.expect);
    });
  }
});
