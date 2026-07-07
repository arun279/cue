import {
  type BulkMarkTarget,
  buildBulkMarkOps,
  buildBulkUnmarkOps,
  type EpisodeAir,
  MAX_EPISODES_PER_CHUNK,
  type SeasonTree,
} from "@domain/write-queue/bulk";
import type { QueuedOp } from "@domain/write-queue/types";
import { describe, expect, it } from "vitest";
import { DAY, iso, NOW } from "./_helpers";

const WATCHED_AT = "2026-07-05T12:00:00.000Z";
const IDS = { trakt: 55 };
const opId = (i: number): string => `op-${i}`;

type Body = { shows: Array<{ ids: unknown; watched_at?: string; seasons: SeasonBody[] }> };
type SeasonBody = { number: number; episodes?: Array<{ number: number }> };

type BuildOptions = Partial<Pick<BulkMarkTarget, "includeSpecials" | "upTo">>;

/** Aired, still-UNWATCHED episodes — the raw material of a mark delta. */
function airedEpisodes(count: number, from = 1): EpisodeAir[] {
  return Array.from({ length: count }, (_unused, i) => ({
    number: from + i,
    firstAired: iso(NOW - DAY),
    watched: false,
  }));
}
function unairedEpisodes(count: number, from: number): EpisodeAir[] {
  return Array.from({ length: count }, (_unused, i) => ({
    number: from + i,
    firstAired: iso(NOW + DAY),
    watched: false,
  }));
}
/** Aired episodes that already carry a play — excluded from the mark delta. */
function watchedEpisodes(count: number, from = 1): EpisodeAir[] {
  return airedEpisodes(count, from).map((ep) => ({ ...ep, watched: true }));
}
/** The compact `{ number }[]` shape a season body enumerates in a delta subtree. */
function enumerated(...numbers: number[]): Array<{ number: number }> {
  return numbers.map((number) => ({ number }));
}

function build(seasons: SeasonTree[], options: BuildOptions = {}): QueuedOp[] {
  const target: BulkMarkTarget = { showIds: IDS, seasons, includeSpecials: false, ...options };
  return buildBulkMarkOps(target, NOW, WATCHED_AT, opId);
}

function buildUnmark(seasons: SeasonTree[], options: BuildOptions = {}): QueuedOp[] {
  const target: BulkMarkTarget = { showIds: IDS, seasons, includeSpecials: false, ...options };
  return buildBulkUnmarkOps(target, NOW, WATCHED_AT, opId);
}

function bodyOf(op: QueuedOp | undefined): Body {
  return (op?.request.body as Body | undefined) ?? { shows: [] };
}
function seasonsOf(op: QueuedOp | undefined): SeasonBody[] {
  return bodyOf(op).shows[0]?.seasons ?? [];
}
function inverseSeasonsOf(op: QueuedOp | undefined): SeasonBody[] {
  return (op?.inverse.body as Body | undefined)?.shows[0]?.seasons ?? [];
}

describe("buildBulkMarkOps", () => {
  it("enumerates every unwatched aired episode of a fully-aired season (never a token)", () => {
    const ops = build([
      { number: 1, episodes: airedEpisodes(8) },
      { number: 2, episodes: airedEpisodes(8) },
    ]);
    expect(ops).toHaveLength(1);
    expect(seasonsOf(ops[0])).toEqual([
      { number: 1, episodes: enumerated(1, 2, 3, 4, 5, 6, 7, 8) },
      { number: 2, episodes: enumerated(1, 2, 3, 4, 5, 6, 7, 8) },
    ]);
    expect(bodyOf(ops[0]).shows[0]?.watched_at).toBe(WATCHED_AT);
  });

  it("enumerates only the aired episodes for a partially-aired season", () => {
    const ops = build([
      { number: 1, episodes: airedEpisodes(6) },
      { number: 2, episodes: [...airedEpisodes(3), ...unairedEpisodes(2, 4)] },
    ]);
    expect(ops).toHaveLength(1);
    expect(seasonsOf(ops[0])).toEqual([
      { number: 1, episodes: enumerated(1, 2, 3, 4, 5, 6) },
      { number: 2, episodes: enumerated(1, 2, 3) },
    ]);
  });

  it("marks ONLY the previously-unwatched delta of a partially-watched season", () => {
    // S01E01/E02 already carry plays; only E03/E04 are the delta this mark creates.
    const ops = build([{ number: 1, episodes: [...watchedEpisodes(2), ...airedEpisodes(2, 3)] }]);
    expect(ops).toHaveLength(1);
    expect(seasonsOf(ops[0])).toEqual([{ number: 1, episodes: enumerated(3, 4) }]);
    // The inverse removes exactly that delta — pre-existing E01/E02 plays are untouched.
    expect(inverseSeasonsOf(ops[0])).toEqual([{ number: 1, episodes: enumerated(3, 4) }]);
  });

  it("emits no op when every aired episode is already watched (a re-mark adds no duplicate plays)", () => {
    expect(build([{ number: 1, episodes: watchedEpisodes(4) }])).toHaveLength(0);
  });

  it("never marks unaired episodes and omits an entirely-unaired season", () => {
    expect(build([{ number: 1, episodes: unairedEpisodes(4, 1) }])).toHaveLength(0);
  });

  it("excludes specials (season 0) unless opted in", () => {
    const seasons: SeasonTree[] = [
      { number: 0, episodes: airedEpisodes(2) },
      { number: 1, episodes: airedEpisodes(3) },
    ];
    expect(seasonsOf(build(seasons)[0])).toEqual([{ number: 1, episodes: enumerated(1, 2, 3) }]);
    expect(seasonsOf(build(seasons, { includeSpecials: true })[0])).toEqual([
      { number: 0, episodes: enumerated(1, 2) },
      { number: 1, episodes: enumerated(1, 2, 3) },
    ]);
  });

  it("mark up to here bounds the subtree at (season, number) inclusive", () => {
    const ops = build(
      [
        { number: 1, episodes: airedEpisodes(4) },
        { number: 2, episodes: airedEpisodes(6) },
        { number: 3, episodes: airedEpisodes(4) },
      ],
      { upTo: { season: 2, number: 3 } },
    );
    expect(seasonsOf(ops[0])).toEqual([
      { number: 1, episodes: enumerated(1, 2, 3, 4) },
      { number: 2, episodes: enumerated(1, 2, 3) },
    ]);
  });

  it("scopes mark-up-to-here to the unwatched-and-in-bound delta", () => {
    const ops = build(
      [
        { number: 1, episodes: [...watchedEpisodes(2), ...airedEpisodes(2, 3)] },
        { number: 2, episodes: airedEpisodes(5) },
      ],
      { upTo: { season: 2, number: 3 } },
    );
    expect(seasonsOf(ops[0])).toEqual([
      { number: 1, episodes: enumerated(3, 4) },
      { number: 2, episodes: enumerated(1, 2, 3) },
    ]);
  });

  it("chunks a long enumerated season by episode count within the cap", () => {
    const ops = build([
      { number: 1, episodes: [...airedEpisodes(250), ...unairedEpisodes(1, 251)] },
    ]);
    expect(ops).toHaveLength(3);
    const counts = ops.map((op) => seasonsOf(op)[0]?.episodes?.length);
    expect(counts).toEqual([MAX_EPISODES_PER_CHUNK, MAX_EPISODES_PER_CHUNK, 50]);
    expect(ops.map((op) => op.id)).toEqual(["op-0", "op-1", "op-2"]);
    expect(seasonsOf(ops[2])[0]?.episodes?.at(-1)?.number).toBe(250); // episode 251 (unaired) excluded
  });

  it("keeps a season of exactly the cap in one chunk, the next in another", () => {
    const ops = build([
      { number: 1, episodes: airedEpisodes(MAX_EPISODES_PER_CHUNK) },
      { number: 2, episodes: airedEpisodes(50) },
    ]);
    expect(ops).toHaveLength(2);
    expect(seasonsOf(ops[0])).toHaveLength(1);
    expect(seasonsOf(ops[0])[0]?.number).toBe(1);
    expect(seasonsOf(ops[0])[0]?.episodes).toHaveLength(MAX_EPISODES_PER_CHUNK);
    expect(seasonsOf(ops[1])[0]?.number).toBe(2);
    expect(seasonsOf(ops[1])[0]?.episodes).toHaveLength(50);
  });

  it("gives different bulk marks on one show distinct item keys (no false coalesce)", () => {
    const whole = build([{ number: 1, episodes: airedEpisodes(3) }])[0];
    const upTo = build([{ number: 1, episodes: airedEpisodes(3) }], {
      upTo: { season: 1, number: 2 },
    })[0];
    const wholeAgain = build([{ number: 1, episodes: airedEpisodes(3) }])[0];
    expect(whole?.itemKey).not.toBe(upTo?.itemKey);
    expect(whole?.itemKey).toBe(wholeAgain?.itemKey);
  });

  it("packs enumerated seasons into ≤cap chunks, splitting across chunk boundaries", () => {
    const seasons = Array.from({ length: 10 }, (_unused, i) => ({
      number: i + 1,
      episodes: airedEpisodes(24),
    }));
    const ops = build(seasons);
    expect(ops).toHaveLength(3); // 240 aired eps → 100 + 100 + 40
    const perOp = ops.map((op) =>
      seasonsOf(op).reduce((n, season) => n + (season.episodes?.length ?? 0), 0),
    );
    expect(perOp).toEqual([MAX_EPISODES_PER_CHUNK, MAX_EPISODES_PER_CHUNK, 40]);
    for (const op of ops) for (const season of seasonsOf(op)) expect(season.episodes).toBeDefined();
  });

  it("builds a remove-by-episode inverse over the same delta without watched_at", () => {
    const [op] = build([{ number: 1, episodes: airedEpisodes(3) }]);
    expect(op?.inverse).toEqual({
      method: "POST",
      path: "/sync/history/remove",
      body: { shows: [{ ids: IDS, seasons: [{ number: 1, episodes: enumerated(1, 2, 3) }] }] },
    });
  });
});

describe("buildBulkUnmarkOps (delta-safe season unmark)", () => {
  it("removes ONLY the aired, currently-watched episodes, enumerated per episode (never a token)", () => {
    // A fully-watched, fully-aired season: the remove enumerates every episode — a
    // whole-season `{ number }` token would delete plays this client never enumerated.
    const ops = buildUnmark([{ number: 1, episodes: watchedEpisodes(4) }]);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.request).toEqual({
      method: "POST",
      path: "/sync/history/remove",
      body: { shows: [{ ids: IDS, seasons: [{ number: 1, episodes: enumerated(1, 2, 3, 4) }] }] },
    });
  });

  it("re-adds exactly that same set with watched_at as its inverse (Undo restores the plays)", () => {
    const [op] = buildUnmark([{ number: 1, episodes: watchedEpisodes(3) }]);
    expect(op?.inverse).toEqual({
      method: "POST",
      path: "/sync/history",
      body: {
        shows: [
          {
            ids: IDS,
            watched_at: WATCHED_AT,
            seasons: [{ number: 1, episodes: enumerated(1, 2, 3) }],
          },
        ],
      },
    });
    expect(op?.fromState).toBe("present");
    expect(op?.toState).toBe("absent");
  });

  it("skips unwatched and unaired episodes — only currently-watched aired plays are removed", () => {
    // E01/E02 watched+aired (removed); E03 aired-but-unwatched (no play to remove);
    // E04 watched-but-unaired (excluded — the unmark is aired-only).
    const ops = buildUnmark([
      {
        number: 1,
        episodes: [
          ...watchedEpisodes(2),
          { number: 3, firstAired: iso(NOW - DAY), watched: false },
          { number: 4, firstAired: iso(NOW + DAY), watched: true },
        ],
      },
    ]);
    expect(seasonsOf(ops[0])).toEqual([{ number: 1, episodes: enumerated(1, 2) }]);
  });

  it("emits no op when nothing aired is watched (empty delta, no POST)", () => {
    expect(buildUnmark([{ number: 1, episodes: airedEpisodes(4) }])).toHaveLength(0);
  });

  it("excludes specials (season 0) unless opted in", () => {
    const seasons: SeasonTree[] = [
      { number: 0, episodes: watchedEpisodes(2) },
      { number: 1, episodes: watchedEpisodes(3) },
    ];
    expect(seasonsOf(buildUnmark(seasons)[0])).toEqual([
      { number: 1, episodes: enumerated(1, 2, 3) },
    ]);
    expect(seasonsOf(buildUnmark(seasons, { includeSpecials: true })[0])).toEqual([
      { number: 0, episodes: enumerated(1, 2) },
      { number: 1, episodes: enumerated(1, 2, 3) },
    ]);
  });

  it("gives an unmark a distinct item key from the matching mark (no false coalesce)", () => {
    const mark = build([{ number: 1, episodes: airedEpisodes(3) }])[0];
    const unmark = buildUnmark([{ number: 1, episodes: watchedEpisodes(3) }])[0];
    expect(mark?.itemKey).not.toBe(unmark?.itemKey);
  });
});
