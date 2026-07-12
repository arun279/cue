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
 * `rewatch` means the episode has more than one play, so an item-scoped uncheck
 * would destroy watch history: the caller removes ONLY `latest` (the newest play,
 * by exact history id) and keeps the check filled. `previous` is the play that
 * survives, so the caller can keep its watched-at display truthful; `none`
 * means the server already holds no play (nothing to remove); `error` means the
 * resolve read itself failed.
 */
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

/** Newest-first play ordering: watched-at moment, then history id as the
 * tiebreak (Trakt ids are monotonic, so the higher id is the later log entry). */
function newestFirst(a: EpisodePlay, b: EpisodePlay): number {
  const at = Date.parse(b.watchedAt) - Date.parse(a.watchedAt);
  return at !== 0 ? at : b.historyId - a.historyId;
}

/**
 * Resolve an episode's plays and decide how (or whether) to unmark it, so every
 * durable uncheck removes exact history ids and never wipes a rewatch: a
 * single play is removed outright; a rewatch yields only its newest play as the
 * removal candidate (the check stays filled, the earlier plays are untouchable
 * here). Shared by the show-detail season rows and the episode sheet so both
 * surfaces behave identically.
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
  if (plan.keptRewatch.length > 0) {
    const ordered = plays.filter((play) => play.episodeTrakt === episodeTrakt).sort(newestFirst);
    const [latest, previous] = ordered;
    if (latest !== undefined && previous !== undefined) {
      return { kind: "rewatch", count: ordered.length, latest, previous };
    }
  }
  if (plan.removeIds.length === 0) return { kind: "none" };
  return { kind: "remove", plan };
}

/** Trakt truncates the stored `watched_at` (observed: to the whole minute), so a
 * play created from a frozen millisecond timestamp echoes back within this
 * window; anything further out is some other play and untouchable. A whole
 * minute is still orders of magnitude tighter than any real historical play. */
const MARK_MATCH_TOLERANCE_MS = 60_000;

/**
 * Identify the play a LANDED mark created, so its undo removes exactly that play
 * by history id instead of removing by item, which wipes EVERY play of the
 * episode: "restart show" rewatchers keep years of history under reset progress,
 * and an item-scoped undo would destroy it. Newest-first, the first play whose
 * watched-at sits within the echo tolerance of the mark's frozen `watchedAt` is
 * the mark's own; `undefined` means no play is provably the mark's (it never
 * landed, or was already removed elsewhere) and nothing may be removed.
 */
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

/**
 * The outcome of resolving a movie unmark against its real Trakt plays, mirroring
 * {@link EpisodeUnmarkResolution} so movies reverse exactly like episodes: `remove`
 * carries the one play's exact history id (safe id-scoped removal); `rewatch` means
 * the movie has more than one play, so a blunt unmark would destroy watch history:
 * the caller must refuse and route to the watch history (MovieDetail's notice links
 * to `/history?type=movies`); `none` means the server already holds no play; `error`
 * means the resolve read itself failed.
 */
export type MovieUnmarkResolution =
  | { readonly kind: "remove"; readonly historyId: number; readonly watchedAt: string }
  | { readonly kind: "rewatch"; readonly count: number }
  | { readonly kind: "none" }
  | { readonly kind: "error" };

/**
 * Resolve a movie's plays and decide how (or whether) to unmark it. A movie is a
 * single item, so the decision is a play count: one play removes by its exact
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

/** Which path a movie unmark must take: reverse the exact op of a play added this
 * session, or read the movie's live plays and act on the resolution. */
export type MovieUnmarkRoute = "reverse-session-mark" | "resolve-live-plays";

/**
 * Guard the fast mark→unmark race. A play added THIS session whose mark op may
 * still be queued cannot be resolved by reading live plays: the in-flight add is
 * not on the server yet, so a live read returns zero and the unmark would report
 * "none": un-ticking the movie while the queued mark later lands and flips it back
 * to watched. When a pending session mark exists FOR THIS MOVIE, reverse the exact
 * op instead (it coalesces against the queued mark). A pending mark for a DIFFERENT
 * movie must not be reversed, and with no pending mark the live-plays read is safe.
 *
 * `pendingMarkMovieId` is the per-mount ref's movie id (or `null` when unset). It
 * survives only the component MOUNT: a mark deferred offline then a navigate-away
 * loses it, so a later unmark reads live plays (0) and routes to "none": a
 * non-destructive but wrong flip-back once the durable queue flushes the mark. See
 * TODO(cross-unmount-deferred-mark) at the call site.
 */
export function routeMovieUnmark(
  pendingMarkMovieId: number | null,
  movieId: number,
): MovieUnmarkRoute {
  return pendingMarkMovieId === movieId ? "reverse-session-mark" : "resolve-live-plays";
}
