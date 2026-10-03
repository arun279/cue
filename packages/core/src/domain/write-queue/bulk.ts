import type { ShowIds } from "../model/ids";
import { isAired } from "../time";
import type { QueuedOp } from "./types";

// Trakt caps list and batch sizes at 100 items.
export const MAX_EPISODES_PER_CHUNK = 100;

const HISTORY = "/sync/history";
const HISTORY_REMOVE = "/sync/history/remove";

export interface EpisodeAir {
  readonly number: number;
  readonly firstAired: string | null;
  readonly watched: boolean;
}

export interface SeasonTree {
  readonly number: number;
  readonly episodes: readonly EpisodeAir[];
}

export interface BulkMarkTarget {
  readonly showIds: ShowIds;
  readonly seasons: readonly SeasonTree[];
  readonly includeSpecials: boolean;
  readonly upTo?: { readonly season: number; readonly number: number };
  readonly inversePatch?: unknown;
  readonly inversePatchForChunk?: (probe: { season: number; number: number }) => unknown;
  readonly additive?: boolean;
}

type SeasonBody = { number: number; episodes: { number: number }[] };

interface PlannedSeason {
  readonly number: number;
  readonly episodeNumbers: readonly number[];
}

export function buildBulkMarkOps(
  target: BulkMarkTarget,
  now: number,
  watchedAt: string,
  makeOpId: (chunkIndex: number) => string,
): QueuedOp[] {
  const chunks = chunkSeasons(planSeasons(target, now));
  return chunks.map((seasons, index): QueuedOp => {
    const id = makeOpId(index);
    const key = `show:${target.showIds.trakt}:bulk:${hashSeasons(seasons)}`;
    return {
      id,
      itemKey: target.additive === true ? `${key}:add:${id}` : key,
      request: {
        method: "POST",
        path: HISTORY,
        body: { shows: [{ ids: target.showIds, watched_at: watchedAt, seasons }] },
      },
      inverse: {
        method: "POST",
        path: HISTORY_REMOVE,
        body: { shows: [{ ids: target.showIds, seasons }] },
      },
      inversePatch: chunkInversePatch(target, seasons),
      watchedAt,
      fromState: "absent",
      toState: "present",
      reconcileKeys: ["progress/watched", "watched/shows"],
    };
  });
}

function chunkInversePatch(target: BulkMarkTarget, seasons: readonly SeasonBody[]): unknown {
  const [probe] = seasons.flatMap((season) =>
    season.episodes.map((episode) => ({ season: season.number, number: episode.number })),
  );
  return target.inversePatchForChunk === undefined || probe === undefined
    ? (target.inversePatch ?? null)
    : target.inversePatchForChunk(probe);
}

function planSeasons(target: BulkMarkTarget, now: number): PlannedSeason[] {
  const out: PlannedSeason[] = [];
  const seasons = [...target.seasons].sort((a, b) => a.number - b.number);
  for (const season of seasons) {
    if (season.number === 0 && !target.includeSpecials) continue;
    if (target.upTo !== undefined && season.number > target.upTo.season) continue;
    const delta = season.episodes.filter(
      (ep) =>
        !ep.watched &&
        isAired(ep.firstAired, now) &&
        (target.upTo === undefined ||
          season.number < target.upTo.season ||
          ep.number <= target.upTo.number),
    );
    if (delta.length === 0) continue;
    const episodeNumbers = delta.map((ep) => ep.number).sort((a, b) => a - b);
    out.push({ number: season.number, episodeNumbers });
  }
  return out;
}

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
    let remaining = season.episodeNumbers;
    while (remaining.length > 0) {
      const take = remaining.slice(0, MAX_EPISODES_PER_CHUNK - currentCount);
      remaining = remaining.slice(take.length);
      current.push({ number: season.number, episodes: take.map((n) => ({ number: n })) });
      currentCount += take.length;
      if (currentCount >= MAX_EPISODES_PER_CHUNK) flush();
    }
  }
  flush();
  return chunks;
}

function hashSeasons(seasons: readonly SeasonBody[]): string {
  const json = JSON.stringify(seasons);
  let h = 5381;
  for (let i = 0; i < json.length; i += 1) h = (Math.imul(h, 33) + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
