import { describe, expect, it } from "vitest";
import { parseWriteReceipt } from "@/core/data/trakt/write-receipt";
import { isOwnPlay, type MarkedEpisodes, markedAt, ownPlays } from "@/core/domain/reversal";
import { buildBulkMarkOps } from "@/core/domain/write-queue/bulk";
import {
  buildAddEpisodePlayOp,
  buildAddWatchlistOp,
  buildMarkEpisodeOp,
  buildMarkMovieOp,
  buildRemovePlaysOp,
  markedEpisodesOf,
} from "@/core/domain/write-queue/ops";
import { learnPlayPolicy, receiptApplied, replacedPlays } from "@/core/domain/write-queue/receipt";

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

  it("reads counts sent as numeric strings, and is null when a count is not a number at all", () => {
    expect(parseWriteReceipt({ added: { episodes: "2" } })?.added).toBe(2);
    expect(parseWriteReceipt({ added: { episodes: "some" } })).toBeNull();
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

  it("keeps one play per item through a long rewatch whose later batch adds only unwatched episodes", () => {
    const tree = (numbers: readonly number[], watched: boolean) => ({
      number: 1,
      episodes: numbers.map((number) => ({
        number,
        firstAired: "2020-01-01T00:00:00.000Z",
        watched,
      })),
    });
    const target = (numbers: readonly number[], watched: boolean) => ({
      showIds: { trakt: 1 },
      seasons: [tree(numbers, watched)],
      includeSpecials: false,
      additive: true,
    });
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const [first] = buildBulkMarkOps(target([1, 2], false), now, AT, () => "b1");
    const [later] = buildBulkMarkOps(target([3, 4], false), now, AT, () => "b2");
    if (first === undefined || later === undefined) throw new Error("expected two batches");
    const afterFirst = learnPlayPolicy("unknown", first, receipt({ added: 1, updated: 1 }));
    expect(afterFirst).toBe("one-play");
    expect(learnPlayPolicy(afterFirst, later, receipt({ added: 2 }))).toBe("one-play");
    expect(learnPlayPolicy("unknown", later, receipt({ added: 2 }))).toBe("unknown");
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

describe("markedEpisodesOf, for writes that mark no episode", () => {
  it("is null for a removal, a movie mark, and a re-add that restores removed plays", () => {
    const removal = buildRemovePlaysOp({
      opId: "r",
      ids: [1],
      restore: [{ trakt: 7, watchedAt: AT }],
    });
    expect(markedEpisodesOf(removal)).toBeNull();
    expect(
      markedEpisodesOf(buildMarkMovieOp({ opId: "m", ids: { trakt: 3 }, watchedAt: AT })),
    ).toBeNull();
    expect(markedEpisodesOf({ ...removal, request: removal.inverse })).toBeNull();
  });
});

describe("ownPlays for marks", () => {
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
  const own = (plays: ReturnType<typeof play>[]) =>
    ownPlays(plays, markedAt(marks), (p) => p.episodeTrakt).map((p) => p.historyId);

  it("finds the plays the marks created, by episode id or by place in the show", () => {
    expect(
      own([
        play(1, 7, 2, "2025-01-01T00:00:00.000Z"),
        play(2, 7, 2, "2026-03-04T05:06:00.000Z"),
        play(3, 9, 3, "2026-03-04T05:06:00.000Z"),
      ]),
    ).toEqual([2, 3]);
  });

  it("counts only plays Trakt stored at or before the sent time, never a later one", () => {
    expect(isOwnPlay("2026-03-04T05:06:00.000Z", "2026-03-04T05:06:59.999Z")).toBe(true);
    expect(isOwnPlay("2026-03-04T05:06:30.000Z", "2026-03-04T05:06:00.000Z")).toBe(false);
    expect(own([play(4, 7, 2, "2026-03-04T05:06:30.000Z")])).toEqual([]);
  });
});
