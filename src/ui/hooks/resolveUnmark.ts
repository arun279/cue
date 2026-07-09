import {
  type EpisodePlay,
  type MoviePlay,
  planEpisodeUnmark,
  type UnmarkPlan,
} from "@domain/reversal";
import type { CueRuntime } from "@ui/runtime/runtime";

/**
 * The outcome of resolving a single-episode uncheck against its real Trakt plays
 * `remove` carries the per-play plan (safe id-scoped removal);
 * `rewatch` means the episode has more than one play, so a one-tap uncheck would
 * destroy watch history — the caller must refuse and route to the Diary; `none`
 * means the server already holds no play (nothing to remove); `error` means the
 * resolve read itself failed.
 */
export type EpisodeUnmarkResolution =
  | { readonly kind: "remove"; readonly plan: UnmarkPlan }
  | { readonly kind: "rewatch"; readonly count: number }
  | { readonly kind: "none" }
  | { readonly kind: "error" };

/**
 * Resolve an episode's plays and decide how (or whether) to unmark it, so every
 * durable uncheck removes exact history ids and never wipes a rewatch. Shared by
 * the show-detail season row and the episode-detail toggle so the two surfaces
 * behave identically.
 */
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
  const plan = planEpisodeUnmark(plays, episodeTrakt);
  if (plan.keptRewatch.length > 0) return { kind: "rewatch", count: plays.length };
  if (plan.removeIds.length === 0) return { kind: "none" };
  return { kind: "remove", plan };
}

/**
 * The outcome of resolving a movie unmark against its real Trakt plays, mirroring
 * {@link EpisodeUnmarkResolution} so movies reverse exactly like episodes: `remove`
 * carries the one play's exact history id (safe id-scoped removal); `rewatch` means
 * the movie has more than one play, so a blunt unmark would destroy watch history —
 * the caller must refuse and route to the watch history (MovieDetail's notice links
 * to `/history?type=movies`); `none` means the server already holds no play; `error`
 * means the resolve read itself failed.
 *
 * TODO(episode-detail-parity): the episode-detail toggle (useToggleEpisodeWatched)
 * shares this seam but still (a) has no in-flight-mark guard, so the same fast
 * mark→unmark race can silently retain an episode play, and (b) shows a Dismiss-only
 * rewatch notice with no link to `/history?type=tv`. Mirror the movie fixes on the
 * TV surface in a TV-scoped pass.
 */
export type MovieUnmarkResolution =
  | { readonly kind: "remove"; readonly historyId: number; readonly watchedAt: string }
  | { readonly kind: "rewatch"; readonly count: number }
  | { readonly kind: "none" }
  | { readonly kind: "error" };

/**
 * Resolve a movie's plays and decide how (or whether) to unmark it. A movie is a
 * single item, so the decision is a play count — one play removes by its exact
 * history id; two or more refuse and route to the watch history (never an item-scoped
 * wipe of every play). The read fails safe: any error keeps the watched state rather
 * than falling back to the destructive removal.
 */
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
