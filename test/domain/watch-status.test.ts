import { computeWatchStatus, type WatchStatus } from "@domain/watch-status";
import { describe, expect, it } from "vitest";
import { DAY, iso, makeEpisode, makeShow, NOW } from "./_helpers";

const airedNext = makeEpisode({ firstAired: iso(NOW - DAY) });
const futureNext = makeEpisode({ firstAired: iso(NOW + DAY) });

describe("computeWatchStatus (aired-based)", () => {
  const cases: Array<{
    name: string;
    show: Parameters<typeof computeWatchStatus>[0];
    expect: WatchStatus;
  }> = [
    {
      name: "hidden overrides everything → stopped",
      show: makeShow({ hidden: true, completed: 3, aired: 10, status: "ended" }),
      expect: "stopped",
    },
    {
      name: "completed 0, not watchlisted → not-started",
      show: makeShow({ completed: 0, inWatchlist: false }),
      expect: "not-started",
    },
    {
      name: "completed 0, watchlisted → to-watch",
      show: makeShow({ completed: 0, inWatchlist: true }),
      expect: "to-watch",
    },
    {
      name: "aired backlog remaining → watching",
      show: makeShow({ completed: 5, aired: 10 }),
      expect: "watching",
    },
    {
      name: "caught up, returning, future episode announced → coming-soon",
      show: makeShow({
        completed: 10,
        aired: 10,
        status: "returning series",
        nextEpisode: futureNext,
      }),
      expect: "coming-soon",
    },
    {
      name: "caught up, returning, nothing announced → up-to-date",
      show: makeShow({ completed: 10, aired: 10, status: "returning series", nextEpisode: null }),
      expect: "up-to-date",
    },
    {
      name: "caught up, ended → ended",
      show: makeShow({ completed: 10, aired: 10, status: "ended", nextEpisode: null }),
      expect: "ended",
    },
    {
      name: "caught up, canceled → ended (terminal)",
      show: makeShow({ completed: 10, aired: 10, status: "canceled", nextEpisode: null }),
      expect: "ended",
    },
    {
      name: "caught up, cancelled (British spelling) → ended (terminal)",
      show: makeShow({ completed: 10, aired: 10, status: "cancelled", nextEpisode: futureNext }),
      expect: "ended",
    },
    {
      name: "ended status wins over an announced future episode",
      show: makeShow({ completed: 10, aired: 10, status: "ended", nextEpisode: futureNext }),
      expect: "ended",
    },
    {
      name: "caught up but next episode already aired (no future) → up-to-date",
      show: makeShow({
        completed: 10,
        aired: 10,
        status: "returning series",
        nextEpisode: airedNext,
      }),
      expect: "up-to-date",
    },
    {
      name: "status casing is normalized",
      show: makeShow({ completed: 10, aired: 10, status: "Ended", nextEpisode: null }),
      expect: "ended",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(computeWatchStatus(c.show, NOW)).toBe(c.expect);
    });
  }
});
