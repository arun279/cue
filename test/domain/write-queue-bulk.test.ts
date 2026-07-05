import {
  type BulkMarkTarget,
  buildBulkMarkOps,
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

function airedEpisodes(count: number, from = 1): EpisodeAir[] {
  return Array.from({ length: count }, (_unused, i) => ({
    number: from + i,
    firstAired: iso(NOW - DAY),
  }));
}
function unairedEpisodes(count: number, from: number): EpisodeAir[] {
  return Array.from({ length: count }, (_unused, i) => ({
    number: from + i,
    firstAired: iso(NOW + DAY),
  }));
}

function build(seasons: SeasonTree[], options: BuildOptions = {}): QueuedOp[] {
  const target: BulkMarkTarget = { showIds: IDS, seasons, includeSpecials: false, ...options };
  return buildBulkMarkOps(target, NOW, WATCHED_AT, opId);
}

function bodyOf(op: QueuedOp | undefined): Body {
  return (op?.request.body as Body | undefined) ?? { shows: [] };
}
function seasonsOf(op: QueuedOp | undefined): SeasonBody[] {
  return bodyOf(op).shows[0]?.seasons ?? [];
}

describe("buildBulkMarkOps", () => {
  it("emits season tokens for fully-aired seasons in a single chunk", () => {
    const ops = build([
      { number: 1, episodes: airedEpisodes(8) },
      { number: 2, episodes: airedEpisodes(8) },
    ]);
    expect(ops).toHaveLength(1);
    expect(seasonsOf(ops[0])).toEqual([{ number: 1 }, { number: 2 }]);
    expect(bodyOf(ops[0]).shows[0]?.watched_at).toBe(WATCHED_AT);
  });

  it("enumerates only aired episodes for a partially-aired season, tokens the rest", () => {
    const ops = build([
      { number: 1, episodes: airedEpisodes(6) },
      { number: 2, episodes: [...airedEpisodes(3), ...unairedEpisodes(2, 4)] },
    ]);
    expect(ops).toHaveLength(1);
    expect(seasonsOf(ops[0])).toEqual([
      { number: 1 },
      { number: 2, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] },
    ]);
  });

  it("never marks unaired episodes and omits an entirely-unaired season", () => {
    expect(build([{ number: 1, episodes: unairedEpisodes(4, 1) }])).toHaveLength(0);
  });

  it("excludes specials (season 0) unless opted in", () => {
    const seasons: SeasonTree[] = [
      { number: 0, episodes: airedEpisodes(2) },
      { number: 1, episodes: airedEpisodes(3) },
    ];
    expect(seasonsOf(build(seasons)[0])).toEqual([{ number: 1 }]);
    expect(seasonsOf(build(seasons, { includeSpecials: true })[0])).toEqual([
      { number: 0 },
      { number: 1 },
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
      { number: 1 },
      { number: 2, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] },
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

  it("splits a single fully-aired season that alone exceeds the cap into enumerated chunks", () => {
    const ops = build([{ number: 1, episodes: airedEpisodes(250) }]);
    expect(ops).toHaveLength(3);
    const counts = ops.map((op) => seasonsOf(op)[0]?.episodes?.length);
    expect(counts).toEqual([MAX_EPISODES_PER_CHUNK, MAX_EPISODES_PER_CHUNK, 50]);
    for (const op of ops) expect(seasonsOf(op)[0]?.episodes).toBeDefined();
  });

  it("keeps a fully-aired season of exactly the cap as one token chunk", () => {
    const ops = build([
      { number: 1, episodes: airedEpisodes(MAX_EPISODES_PER_CHUNK) },
      { number: 2, episodes: airedEpisodes(50) },
    ]);
    expect(ops).toHaveLength(2);
    expect(seasonsOf(ops[0])).toEqual([{ number: 1 }]);
    expect(seasonsOf(ops[1])).toEqual([{ number: 2 }]);
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

  it("packs fully-aired season tokens across chunks by represented count", () => {
    const seasons = Array.from({ length: 10 }, (_unused, i) => ({
      number: i + 1,
      episodes: airedEpisodes(24),
    }));
    const ops = build(seasons);
    expect(ops).toHaveLength(3); // 24*4=96 per chunk → 4 + 4 + 2 seasons
    for (const op of ops) {
      for (const season of seasonsOf(op)) expect(season.episodes).toBeUndefined();
    }
  });

  it("builds a remove-by-item inverse over the same subtree without watched_at", () => {
    const [op] = build([{ number: 1, episodes: airedEpisodes(3) }]);
    expect(op?.inverse).toEqual({
      method: "POST",
      path: "/sync/history/remove",
      body: { shows: [{ ids: IDS, seasons: [{ number: 1 }] }] },
    });
  });
});
