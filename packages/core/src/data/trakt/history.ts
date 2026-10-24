import type { HistoryEntry } from "../../domain/history";
import type { EpisodePlay, MoviePlay } from "../../domain/reversal";
import { toMovieIds } from "./movie-library";
import type { HistoryItem } from "./schemas";
import { toEpisodeIds } from "./show-detail";

export function assembleHistoryEntries(items: readonly HistoryItem[]): HistoryEntry[] {
  return items.flatMap((item) => {
    if (item.type === "episode" && item.episode !== undefined && item.show !== undefined) {
      return [episodeEntry(item, item.show, item.episode)];
    }
    if (item.type === "movie" && item.movie !== undefined) return [movieEntry(item, item.movie)];
    return [];
  });
}

function episodeEntry(
  item: HistoryItem,
  show: NonNullable<HistoryItem["show"]>,
  episode: NonNullable<HistoryItem["episode"]>,
): HistoryEntry {
  return {
    historyId: item.id,
    watchedAt: item.watched_at,
    type: "episode",
    mediaId: show.ids.trakt,
    ids: toEpisodeIds(episode.ids),
    title: show.title,
    year: null,
    season: episode.season,
    number: episode.number,
    episodeTitle: episode.title ?? null,
    posters: show.images?.poster ?? [],
    tmdbId: show.ids.tmdb ?? null,
  };
}

function movieEntry(item: HistoryItem, movie: NonNullable<HistoryItem["movie"]>): HistoryEntry {
  return {
    historyId: item.id,
    watchedAt: item.watched_at,
    type: "movie",
    mediaId: movie.ids.trakt,
    ids: toMovieIds(movie.ids),
    title: movie.title,
    year: movie.year ?? null,
    season: null,
    number: null,
    episodeTitle: null,
    posters: movie.images?.poster ?? [],
    tmdbId: movie.ids.tmdb ?? null,
  };
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
