import {
  computeWatchStatus,
  isTerminalStatus,
  type WatchStatus,
} from "@cue/core/domain/watch-status";
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
      show: makeShow({ hidden: true, completed: 0, aired: 10, status: "ended" }),
      expect: "abandoned",
    },
    {
      name: "completed 0 → not-started",
      show: makeShow({ completed: 0, inWatchlist: true }),
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
      name: "caught up terminal show → ended",
      show: makeShow({ completed: 10, aired: 10, status: "ended", nextEpisode: null }),
      expect: "ended",
    },
    {
      name: "canceled spelling → ended",
      show: makeShow({ completed: 10, aired: 10, status: "canceled", nextEpisode: futureNext }),
      expect: "ended",
    },
    {
      name: "cancelled spelling → ended",
      show: makeShow({ completed: 10, aired: 10, status: "cancelled" }),
      expect: "ended",
    },
    {
      name: "terminal casing is normalized",
      show: makeShow({ completed: 10, aired: 10, status: "Ended", nextEpisode: null }),
      expect: "ended",
    },
    {
      name: "returning show with nothing announced → caught-up",
      show: makeShow({ completed: 10, aired: 10, nextEpisode: null }),
      expect: "caught-up",
    },
    {
      name: "future-only next → caught-up",
      show: makeShow({ completed: 10, aired: 10, nextEpisode: futureNext }),
      expect: "caught-up",
    },
    {
      name: "last watch 40 days ago and next aired 2 days ago → watching",
      show: makeShow({
        nextEpisode: { ...airedNext, firstAired: iso(NOW - 2 * DAY) },
        lastWatchedAt: iso(NOW - 40 * DAY),
      }),
      expect: "watching",
    },
    {
      name: "last watch 40 days ago and next aired 30 days ago → lapsed",
      show: makeShow({
        nextEpisode: { ...airedNext, firstAired: iso(NOW - 30 * DAY) },
        lastWatchedAt: iso(NOW - 40 * DAY),
      }),
      expect: "lapsed",
    },
    {
      name: "null last watched and next aired 2 days ago → watching",
      show: makeShow({
        nextEpisode: { ...airedNext, firstAired: iso(NOW - 2 * DAY) },
        lastWatchedAt: null,
      }),
      expect: "watching",
    },
    {
      name: "null last watched and next aired 30 days ago → lapsed",
      show: makeShow({
        nextEpisode: { ...airedNext, firstAired: iso(NOW - 30 * DAY) },
        lastWatchedAt: null,
      }),
      expect: "lapsed",
    },
    {
      name: "last watch 1 day ago and next aired 60 days ago → watching",
      show: makeShow({
        nextEpisode: { ...airedNext, firstAired: iso(NOW - 60 * DAY) },
        lastWatchedAt: iso(NOW - DAY),
      }),
      expect: "watching",
    },
    {
      name: "idle exactly at threshold → watching",
      show: makeShow({
        nextEpisode: { ...airedNext, firstAired: iso(NOW - THRESHOLD) },
        lastWatchedAt: iso(NOW - THRESHOLD),
      }),
      expect: "watching",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(computeWatchStatus(c.show, NOW, THRESHOLD)).toBe(c.expect);
    });
  }
});
