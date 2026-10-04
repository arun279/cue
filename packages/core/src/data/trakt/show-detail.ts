import type { EpisodeIds, ShowIds } from "../../domain/model/ids";
import type { EpisodeKey, EpisodeRef } from "../../domain/model/library";
import { isAired } from "../../domain/time";
import { resolveStill } from "../image-source";
import type { EpisodeData, Progress, SeasonData, ShowDetailData } from "./schemas";

function stillsOf(episode: EpisodeData): readonly string[] {
  return episode.images?.screenshot ?? episode.images?.thumb ?? [];
}

export interface EpisodeView {
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly firstAired: string | null;
  readonly ids: EpisodeIds;
  readonly stills: readonly string[];
  readonly watched: boolean;
  readonly watchedAt: string | null;
  readonly aired: boolean;
}

export interface SeasonView {
  readonly number: number;
  readonly title: string | null;
  readonly isSpecial: boolean;
  // Trakt's progress read omits hidden seasons from its breakdown.
  readonly isHidden: boolean;
  readonly episodes: readonly EpisodeView[];
  readonly airedCount: number;
  readonly completedCount: number;
}

export function firstUnwatchedAired(seasons: readonly SeasonView[]): EpisodeView | null {
  for (const season of seasons) {
    if (season.isSpecial || season.isHidden) continue;
    const episode = season.episodes.find((candidate) => candidate.aired && !candidate.watched);
    if (episode !== undefined) return episode;
  }
  return null;
}

export function toEpisodeRef(episode: EpisodeView): EpisodeRef {
  return {
    season: episode.season,
    number: episode.number,
    title: episode.title,
    firstAired: episode.firstAired,
    still: resolveStill(episode.stills),
    ids: episode.ids,
  };
}

export interface ShowInfo {
  readonly ids: ShowIds;
  readonly title: string;
  readonly year: number | null;
  readonly status: string;
  readonly network: string | null;
  readonly genres: readonly string[];
  readonly runtime: number | null;
  readonly overview: string | null;
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
}

export interface ShowProgress {
  readonly aired: number;
  readonly completed: number;
  readonly lastAired: EpisodeKey | null;
  readonly nextEpisode: EpisodeView | null;
}

export function toEpisodeIds(ids: {
  trakt: number;
  tvdb?: number | null;
  imdb?: string | null;
  tmdb?: number | null;
}): EpisodeIds {
  return {
    trakt: ids.trakt,
    tvdb: ids.tvdb ?? undefined,
    imdb: ids.imdb ?? undefined,
    tmdb: ids.tmdb ?? undefined,
  };
}

function toShowIds(ids: ShowDetailData["ids"]): ShowIds {
  return {
    trakt: ids.trakt,
    slug: ids.slug,
    tvdb: ids.tvdb ?? undefined,
    imdb: ids.imdb ?? undefined,
    tmdb: ids.tmdb ?? undefined,
  };
}

export function assembleShowInfo(show: ShowDetailData): ShowInfo {
  return {
    ids: toShowIds(show.ids),
    title: show.title,
    year: show.year ?? null,
    status: show.status ?? "",
    network: show.network ?? null,
    genres: show.genres ?? [],
    runtime: show.runtime ?? null,
    overview: show.overview ?? null,
    posters: show.images?.poster ?? [],
    backdrops: show.images?.fanart ?? [],
  };
}

export function assembleShowProgress(progress: Progress, now: number): ShowProgress {
  const next = progress.next_episode;
  return {
    aired: progress.aired,
    completed: progress.completed,
    lastAired:
      progress.last_episode == null
        ? null
        : {
            season: progress.last_episode.season,
            number: progress.last_episode.number,
          },
    nextEpisode:
      next === null
        ? null
        : {
            season: next.season,
            number: next.number,
            title: next.title ?? null,
            firstAired: next.first_aired ?? null,
            ids: toEpisodeIds(next.ids),
            stills: stillsOf(next),
            watched: false,
            watchedAt: null,
            aired: isAired(next.first_aired, now),
          },
  };
}

export function assembleSeasons(
  seasons: readonly SeasonData[],
  progress: Progress,
  now: number,
): SeasonView[] {
  const progressSeasonNumbers = new Set(
    (progress.seasons ?? []).filter((season) => season.number !== 0).map((season) => season.number),
  );
  const highestProgressSeason = Math.max(...progressSeasonNumbers, Number.NEGATIVE_INFINITY);
  const watched = new Map<string, { completed: boolean; lastWatchedAt: string | null }>();
  for (const season of progress.seasons ?? []) {
    for (const episode of season.episodes) {
      watched.set(`${season.number}:${episode.number}`, {
        completed: episode.completed,
        lastWatchedAt: episode.last_watched_at ?? null,
      });
    }
  }

  return [...seasons]
    .sort((a, b) => Number(a.number === 0) - Number(b.number === 0) || a.number - b.number)
    .map((season) => {
      const episodes = [...(season.episodes ?? [])]
        .sort((a, b) => a.number - b.number)
        .map<EpisodeView>((episode) => {
          const progressEp = watched.get(`${season.number}:${episode.number}`);
          return {
            season: season.number,
            number: episode.number,
            title: episode.title ?? null,
            firstAired: episode.first_aired ?? null,
            ids: toEpisodeIds(episode.ids),
            stills: stillsOf(episode),
            watched: progressEp?.completed ?? false,
            watchedAt: progressEp?.lastWatchedAt ?? null,
            aired: isAired(episode.first_aired, now),
          };
        });
      return {
        number: season.number,
        title: season.title ?? null,
        isSpecial: season.number === 0,
        isHidden:
          season.number !== 0 &&
          season.number < highestProgressSeason &&
          !progressSeasonNumbers.has(season.number),
        episodes,
        airedCount: episodes.filter((episode) => episode.aired).length,
        completedCount: episodes.filter((episode) => episode.watched).length,
      };
    });
}
