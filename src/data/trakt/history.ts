import type { HistoryEntry } from "@domain/history";
import type { EpisodePlay } from "@domain/reversal";
import { toMovieIds } from "./movie-library";
import type { HistoryItem } from "./schemas";
import { toEpisodeIds } from "./show-detail";

/**
 * Flatten `/users/me/history` rows into domain `HistoryEntry[]`. An
 * episode play carries its show for the title/poster and the episode for the
 * SxEy code; a movie play carries the movie. Rows whose declared type is missing
 * its item (a malformed row, or a `season` play the Diary doesn't surface) are
 * dropped rather than rendered blank.
 */
export function assembleHistoryEntries(items: readonly HistoryItem[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const item of items) {
    if (item.type === "episode" && item.episode !== undefined && item.show !== undefined) {
      entries.push({
        historyId: item.id,
        watchedAt: item.watched_at,
        type: "episode",
        mediaId: item.show.ids.trakt,
        ids: toEpisodeIds(item.episode.ids),
        title: item.show.title,
        year: null,
        season: item.episode.season,
        number: item.episode.number,
        episodeTitle: item.episode.title ?? null,
        posters: item.show.images?.poster ?? [],
        tmdbId: item.show.ids.tmdb ?? null,
      });
    } else if (item.type === "movie" && item.movie !== undefined) {
      entries.push({
        historyId: item.id,
        watchedAt: item.watched_at,
        type: "movie",
        mediaId: item.movie.ids.trakt,
        ids: toMovieIds(item.movie.ids),
        title: item.movie.title,
        year: item.movie.year ?? null,
        season: null,
        number: null,
        episodeTitle: null,
        posters: item.movie.images?.poster ?? [],
        tmdbId: item.movie.ids.tmdb ?? null,
      });
    }
  }
  return entries;
}

/**
 * Flatten scoped-history rows (`/sync/history/{shows|episodes}/:id`) into
 * `EpisodePlay[]` for the durable per-play unmark. Only episode plays
 * carry a season/number, so movie rows (and malformed rows) are dropped — the
 * planners only ever reason about episode plays.
 */
export function assembleEpisodePlays(items: readonly HistoryItem[]): EpisodePlay[] {
  const plays: EpisodePlay[] = [];
  for (const item of items) {
    if (item.type !== "episode" || item.episode === undefined) continue;
    plays.push({
      historyId: item.id,
      episodeTrakt: item.episode.ids.trakt,
      season: item.episode.season,
      number: item.episode.number,
      watchedAt: item.watched_at,
    });
  }
  return plays;
}
