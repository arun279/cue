import {
  type EpisodePlay,
  type MoviePlay,
  ownPlays,
  type PlayRef,
  planEpisodeUnmark,
  type UnmarkPlan,
} from "../domain/reversal";
import { buildRemovePlaysOp } from "../domain/write-queue/ops";
import { replacedPlays } from "../domain/write-queue/receipt";
import type { QueuedOp } from "../domain/write-queue/types";
import type { CueRuntime } from "../runtime/runtime";
import { usePlayPolicy } from "../stores/play-policy-store";

export type EpisodeUnmarkResolution =
  | { readonly kind: "remove"; readonly plan: UnmarkPlan }
  | {
      readonly kind: "rewatch";
      readonly count: number;
      readonly latest: EpisodePlay;
      readonly previous: EpisodePlay;
    }
  | { readonly kind: "none" }
  | { readonly kind: "error" };

// Trakt history ids are monotonic, so a higher id is a later entry.
function newestFirst(a: EpisodePlay, b: EpisodePlay): number {
  const at = Date.parse(b.watchedAt) - Date.parse(a.watchedAt);
  return at !== 0 ? at : b.historyId - a.historyId;
}

export async function resolveEpisodeUnmark(
  runtime: CueRuntime,
  episodeTrakt: number,
): Promise<EpisodeUnmarkResolution> {
  let plays: readonly EpisodePlay[];
  try {
    plays = await runtime.loadEpisodePlays(episodeTrakt);
  } catch {
    return { kind: "error" };
  }
  const [latest, previous, ...older] = plays
    .filter((play) => play.episodeTrakt === episodeTrakt)
    .sort(newestFirst);
  if (latest !== undefined && previous !== undefined) {
    return { kind: "rewatch", count: older.length + 2, latest, previous };
  }
  const plan = planEpisodeUnmark(plays, episodeTrakt);
  return plan.removeIds.length === 0 ? { kind: "none" } : { kind: "remove", plan };
}

export type LandedUndo<P> =
  | { readonly kind: "remove"; readonly plays: readonly P[] }
  | { readonly kind: "replaced"; readonly count: number }
  | { readonly kind: "none" };

export async function planLandedUndo<P extends PlayRef>(
  runtime: CueRuntime,
  opIds: readonly string[],
  loadPlays: () => Promise<readonly P[]>,
  sentAt: (play: P) => string | null,
  itemOf: (play: P) => number,
): Promise<LandedUndo<P> | null> {
  const receipts = opIds.map((id) => runtime.writeReceipt(id));
  if (receipts.includes(null) && usePlayPolicy.getState().policy !== "multiple") return null;
  const replaced = receipts.reduce((total, receipt) => total + replacedPlays(receipt), 0);
  if (replaced > 0) return { kind: "replaced", count: replaced };
  let plays: readonly P[];
  try {
    plays = await loadPlays();
  } catch {
    return null;
  }
  const own = ownPlays(plays, sentAt, itemOf);
  return own.length === 0 ? { kind: "none" } : { kind: "remove", plays: own };
}

export function removeEpisodePlays(opId: string, plays: readonly EpisodePlay[]): QueuedOp {
  return buildRemovePlaysOp({
    opId,
    ids: plays.map((play) => play.historyId),
    restore: plays.map((play) => ({ trakt: play.episodeTrakt, watchedAt: play.watchedAt })),
  });
}

export type MovieUnmarkResolution =
  | { readonly kind: "remove"; readonly historyId: number; readonly watchedAt: string }
  | { readonly kind: "rewatch"; readonly count: number }
  | { readonly kind: "none" }
  | { readonly kind: "error" };

export async function resolveMovieUnmark(
  runtime: CueRuntime,
  movieId: number,
): Promise<MovieUnmarkResolution> {
  let plays: readonly MoviePlay[];
  try {
    plays = await runtime.loadMoviePlays(movieId);
  } catch {
    return { kind: "error" };
  }
  if (plays.length === 0) return { kind: "none" };
  if (plays.length >= 2) return { kind: "rewatch", count: plays.length };
  const play = plays[0] as MoviePlay;
  return { kind: "remove", historyId: play.historyId, watchedAt: play.watchedAt };
}

const IN_FLIGHT_POLL_MS = 200;
const IN_FLIGHT_POLL_TRIES = 50;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitWhileInFlight(
  runtime: CueRuntime,
  opIds: readonly string[],
): Promise<boolean> {
  for (let attempt = 0; attempt < IN_FLIGHT_POLL_TRIES; attempt += 1) {
    const inFlight = runtime.inFlightOpId();
    if (inFlight === null || !opIds.includes(inFlight)) return true;
    await sleep(IN_FLIGHT_POLL_MS);
  }
  return false;
}
