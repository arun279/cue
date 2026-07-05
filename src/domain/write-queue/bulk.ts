import type { ShowIds } from "../model/ids";
import { isAired } from "../time";
import type { QueuedOp } from "./types";

/**
 * Episodes represented per `/sync/history` chunk. 100 mirrors Trakt's pervasive
 * 100-item limit (the pagination max, and the reference client's ≤100-shows
 * batch): the platform-consistent unit that keeps each body small, not a round
 * guess. A single long-running show can exceed this on its own, so we chunk by
 * represented episode count — the reference's per-show batching is not enough.
 */
export const MAX_EPISODES_PER_CHUNK = 100;

const HISTORY = "/sync/history";
const HISTORY_REMOVE = "/sync/history/remove";

export interface EpisodeAir {
  readonly number: number;
  readonly firstAired: string | null;
}

export interface SeasonTree {
  /** 0 = specials, emitted only when `includeSpecials` is set. */
  readonly number: number;
  readonly episodes: readonly EpisodeAir[];
}

export interface BulkMarkTarget {
  readonly showIds: ShowIds;
  readonly seasons: readonly SeasonTree[];
  readonly includeSpecials: boolean;
  /** "Mark up to here": bound the subtree at (season, number) inclusive. */
  readonly upTo?: { readonly season: number; readonly number: number };
  /** Opaque reconcile anchor stamped on every chunk so a lost response is retired, not re-POSTed. */
  readonly inversePatch?: unknown;
}

type SeasonBody = { number: number; episodes?: { number: number }[] };

interface PlannedSeason {
  readonly body: SeasonBody;
  readonly count: number;
  readonly episodeNumbers: readonly number[];
}

/**
 * subtree builder. Per season, emit a compact token `{number}` only when
 * every episode is aired AND included (fully-aired, not truncated by `upTo`);
 * otherwise enumerate only the aired, in-bound episodes. Specials (season 0) are
 * skipped unless opted in. Never marks unaired episodes.
 */
export function buildBulkMarkOps(
  target: BulkMarkTarget,
  now: number,
  watchedAt: string,
  makeOpId: (chunkIndex: number) => string,
): QueuedOp[] {
  const planned = planSeasons(target, now);
  const chunks = chunkSeasons(planned);
  return chunks.map((seasons, index) => {
    const addBody = { shows: [{ ids: target.showIds, watched_at: watchedAt, seasons }] };
    const removeBody = { shows: [{ ids: target.showIds, seasons }] };
    return {
      id: makeOpId(index),
      itemKey: `show:${target.showIds.trakt}:bulk:${hashSeasons(seasons)}`,
      request: { method: "POST", path: HISTORY, body: addBody },
      inverse: { method: "POST", path: HISTORY_REMOVE, body: removeBody },
      inversePatch: target.inversePatch ?? null,
      watchedAt,
      fromState: "absent",
      toState: "present",
      reconcileKeys: ["progress/watched", "watched/shows"],
    };
  });
}

function planSeasons(target: BulkMarkTarget, now: number): PlannedSeason[] {
  const out: PlannedSeason[] = [];
  const seasons = [...target.seasons].sort((a, b) => a.number - b.number);
  for (const season of seasons) {
    if (season.number === 0 && !target.includeSpecials) continue;
    if (target.upTo !== undefined && season.number > target.upTo.season) continue;
    const included = season.episodes.filter(
      (ep) => isAired(ep.firstAired, now) && withinBound(ep.number, season.number, target.upTo),
    );
    if (included.length === 0) continue;
    const numbers = included.map((ep) => ep.number).sort((a, b) => a - b);
    const fullSeason = included.length === season.episodes.length;
    const body: SeasonBody = fullSeason
      ? { number: season.number }
      : { number: season.number, episodes: numbers.map((n) => ({ number: n })) };
    out.push({ body, count: included.length, episodeNumbers: numbers });
  }
  return out;
}

function withinBound(
  episodeNumber: number,
  seasonNumber: number,
  upTo: BulkMarkTarget["upTo"],
): boolean {
  if (upTo === undefined || seasonNumber < upTo.season) return true;
  if (seasonNumber > upTo.season) return false;
  return episodeNumber <= upTo.number;
}

/**
 * Pack planned seasons into chunks of ≤`MAX_EPISODES_PER_CHUNK` *represented*
 * episodes. A fully-aired season stays a compact token only while it fits within
 * the cap; one that alone represents more than the cap is enumerated and split
 * across chunks, so "chunk by episode count" holds even for a single long season
 * and no one POST ever claims more than the cap.
 */
function chunkSeasons(planned: readonly PlannedSeason[]): SeasonBody[][] {
  const chunks: SeasonBody[][] = [];
  let current: SeasonBody[] = [];
  let currentCount = 0;
  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
      currentCount = 0;
    }
  };
  for (const season of planned) {
    const isToken = season.body.episodes === undefined && season.count <= MAX_EPISODES_PER_CHUNK;
    if (isToken) {
      if (currentCount + season.count > MAX_EPISODES_PER_CHUNK) flush();
      current.push(season.body);
      currentCount += season.count;
      if (currentCount >= MAX_EPISODES_PER_CHUNK) flush();
      continue;
    }
    let remaining = season.episodeNumbers;
    while (remaining.length > 0) {
      const take = remaining.slice(0, MAX_EPISODES_PER_CHUNK - currentCount);
      remaining = remaining.slice(take.length);
      current.push({ number: season.body.number, episodes: take.map((n) => ({ number: n })) });
      currentCount += take.length;
      if (currentCount >= MAX_EPISODES_PER_CHUNK) flush();
    }
  }
  flush();
  return chunks;
}

/**
 * Content hash of a chunk's subtree so two *different* bulk marks on one show
 * never collide on `itemKey` (which would coalesce and drop the later mark),
 * while an identical re-mark stays idempotent. Bodies are built in a canonical
 * order (sorted seasons + episode numbers), so JSON is stable.
 */
function hashSeasons(seasons: readonly SeasonBody[]): string {
  const json = JSON.stringify(seasons);
  let h = 5381;
  for (let i = 0; i < json.length; i += 1) h = (Math.imul(h, 33) + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
