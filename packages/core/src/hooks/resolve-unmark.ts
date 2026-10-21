import {
  type EpisodePlay,
  type MarkedEpisodes,
  type MarkUndoPlan,
  type MoviePlay,
  planEpisodeUnmark,
  planMarkUndo,
  type UnmarkPlan,
} from "../domain/reversal";
import { replacedPlays } from "../domain/write-queue/receipt";
import type { CueRuntime } from "../runtime/runtime";

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

export type LandedUndo = MarkUndoPlan | { readonly kind: "replaced"; readonly count: number };

export async function planLandedUndo(
  runtime: CueRuntime,
  marks: readonly MarkedEpisodes[],
  opIds: readonly string[],
  loadPlays: () => Promise<readonly EpisodePlay[]>,
): Promise<LandedUndo | null> {
  const replaced = opIds.reduce((n, id) => n + replacedPlays(runtime.writeReceipt(id)), 0);
  if (replaced > 0) return { kind: "replaced", count: replaced };
  try {
    return planMarkUndo(marks, await loadPlays());
  } catch {
    return null;
  }
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

export type MovieUnmarkRoute = "reverse-session-mark" | "resolve-live-plays";

export function routeMovieUnmark(
  pendingMarkMovieId: number | null,
  movieId: number,
): MovieUnmarkRoute {
  return pendingMarkMovieId === movieId ? "reverse-session-mark" : "resolve-live-plays";
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
