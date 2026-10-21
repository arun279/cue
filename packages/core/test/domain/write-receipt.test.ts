import { parseWriteReceipt } from "@cue/core/data/trakt/write-receipt";
import { learnPlayPolicy } from "@cue/core/domain/play-policy";
import { type MarkedEpisodes, planMarkUndo } from "@cue/core/domain/reversal";
import { buildBulkMarkOps } from "@cue/core/domain/write-queue/bulk";
import {
  buildAddEpisodePlayOp,
  buildAddWatchlistOp,
  buildMarkEpisodeOp,
  markedEpisodesOf,
} from "@cue/core/domain/write-queue/ops";
import { receiptApplied, replacedPlays } from "@cue/core/domain/write-queue/receipt";
import { describe, expect, it } from "vitest";

const AT = "2026-03-04T05:06:00.000Z";
const receipt = (overrides: Partial<Record<string, number>> = {}) => ({
  added: 0,
  updated: 0,
  deleted: 0,
  existing: 0,
  notFound: 0,
  ...overrides,
});

describe("parseWriteReceipt", () => {
  it("sums each count across sections and counts every item Trakt could not find", () => {
    expect(
      parseWriteReceipt({
        added: { movies: 1, episodes: 19 },
        updated: { movies: 0, episodes: 5 },
        existing: { shows: 2 },
        not_found: { movies: [], episodes: [{ ids: {} }, { ids: {} }], people: [], users: [] },
      }),
    ).toEqual({ added: 20, updated: 5, deleted: 0, existing: 2, notFound: 2 });
  });

  it("is null for a body that says nothing about what the write did", () => {
    expect(parseWriteReceipt({})).toBeNull();
    expect(parseWriteReceipt("ok")).toBeNull();
    expect(parseWriteReceipt(null)).toBeNull();
  });
});

describe("receiptApplied", () => {
  it("treats a write that changed nothing and named missing items as not applied", () => {
    expect(receiptApplied(receipt({ notFound: 1 }))).toBe(false);
    expect(receiptApplied(receipt({ added: 1, notFound: 1 }))).toBe(true);
    expect(receiptApplied(receipt({ existing: 1 }))).toBe(true);
    expect(receiptApplied(receipt())).toBe(true);
  });

  it("reads replaced plays from the updated count", () => {
    expect(replacedPlays(receipt({ updated: 3 }))).toBe(3);
    expect(replacedPlays(null)).toBe(0);
  });
});

describe("learnPlayPolicy", () => {
  const mark = buildMarkEpisodeOp({ opId: "m", ids: { trakt: 1 }, watchedAt: AT });
  const play = buildAddEpisodePlayOp({ opId: "p", ids: { trakt: 1 }, watchedAt: AT });

  it("learns one play per item from any history add Trakt answered with updated", () => {
    expect(learnPlayPolicy("unknown", mark, receipt({ updated: 1 }))).toBe("one-play");
    expect(learnPlayPolicy("multiple", play, receipt({ added: 1, updated: 1 }))).toBe("one-play");
  });

  it("learns multiple plays only from an added play on an item that already had one", () => {
    expect(learnPlayPolicy("unknown", play, receipt({ added: 1 }))).toBe("multiple");
    expect(learnPlayPolicy("unknown", mark, receipt({ added: 1 }))).toBe("unknown");
  });

  it("ignores writes that are not history adds", () => {
    const watchlist = buildAddWatchlistOp({ opId: "w", section: "shows", ids: { trakt: 1 } });
    expect(learnPlayPolicy("one-play", watchlist, receipt({ updated: 1 }))).toBe("one-play");
  });
});

describe("markedEpisodesOf", () => {
  it("names the episodes of a single mark and of a season mark", () => {
    const single = buildMarkEpisodeOp({ opId: "m", ids: { trakt: 7 }, watchedAt: AT });
    expect(markedEpisodesOf(single)).toEqual({
      watchedAt: AT,
      traktIds: new Set([7]),
      positions: new Set(),
    });
    const [bulk] = buildBulkMarkOps(
      {
        showIds: { trakt: 1 },
        seasons: [
          {
            number: 2,
            episodes: [
              { number: 1, firstAired: "2020-01-01T00:00:00.000Z", watched: true },
              { number: 2, firstAired: "2020-01-08T00:00:00.000Z", watched: false },
            ],
          },
        ],
        includeSpecials: false,
      },
      Date.parse("2026-01-01T00:00:00.000Z"),
      AT,
      () => "b",
    );
    expect(bulk && markedEpisodesOf(bulk)?.positions).toEqual(new Set(["2:2"]));
  });
});

describe("planMarkUndo", () => {
  const marks: MarkedEpisodes[] = [
    { watchedAt: AT, traktIds: new Set([7]), positions: new Set(["1:3"]) },
  ];
  const play = (historyId: number, episodeTrakt: number, number: number, watchedAt: string) => ({
    historyId,
    episodeTrakt,
    season: 1,
    number,
    watchedAt,
  });

  it("removes only the plays the marks created, by history id", () => {
    const plays = [
      play(1, 7, 2, "2025-01-01T00:00:00.000Z"),
      play(2, 7, 2, "2026-03-04T05:06:00.000Z"),
      play(3, 9, 3, "2026-03-04T05:06:00.000Z"),
      play(4, 9, 3, "2026-03-04T05:09:00.000Z"),
    ];
    expect(planMarkUndo(marks, plays, 0)).toEqual({
      kind: "remove",
      removeIds: [2, 3],
      restore: [
        { trakt: 7, watchedAt: "2026-03-04T05:06:00.000Z" },
        { trakt: 9, watchedAt: "2026-03-04T05:06:00.000Z" },
      ],
    });
  });

  it("removes nothing when Trakt replaced plays the account already had", () => {
    const plays = [play(2, 7, 2, AT)];
    expect(planMarkUndo(marks, plays, 1)).toEqual({ kind: "replaced", count: 1 });
  });

  it("has nothing to remove when no play matches the marks", () => {
    expect(planMarkUndo(marks, [play(1, 7, 2, "2025-01-01T00:00:00.000Z")], 0)).toEqual({
      kind: "none",
    });
  });
});
