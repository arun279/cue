import {
  type EpisodePlay,
  MARK_MATCH_TOLERANCE_MS,
  type MoviePlay,
  planEpisodeUnmark,
  type UnmarkPlan,
} from "../domain/reversal";
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

export function findMarkPlay(
  plays: readonly EpisodePlay[],
  episodeTrakt: number,
  watchedAt: string,
): EpisodePlay | undefined {
  const markedAt = Date.parse(watchedAt);
  return plays
    .filter((play) => play.episodeTrakt === episodeTrakt)
    .sort(newestFirst)
    .find((play) => Math.abs(Date.parse(play.watchedAt) - markedAt) <= MARK_MATCH_TOLERANCE_MS);
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
