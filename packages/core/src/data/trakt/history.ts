import type { HistoryEntry } from "../../domain/history";
import type { EpisodePlay, MoviePlay } from "../../domain/reversal";
import { toMovieIds } from "./movie-library";
import type { HistoryItem } from "./schemas";
import { toEpisodeIds } from "./show-detail";

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

export function assembleMoviePlays(items: readonly HistoryItem[]): MoviePlay[] {
  const plays: MoviePlay[] = [];
  for (const item of items) {
    if (item.type !== "movie" || item.movie === undefined) continue;
    plays.push({ historyId: item.id, watchedAt: item.watched_at });
  }
  return plays;
}
