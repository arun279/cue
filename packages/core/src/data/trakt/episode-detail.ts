import type { EpisodeIds } from "../../domain/model/ids";
import { isAired } from "../../domain/time";
import type { EpisodeData, Progress } from "./schemas";
import { toEpisodeIds } from "./show-detail";

export interface EpisodeNav {
  readonly season: number;
  readonly number: number;
}

export interface EpisodeDetail {
  readonly showId: number;
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly overview: string | null;
  readonly firstAired: string | null;
  readonly runtime: number | null;
  readonly ids: EpisodeIds;
  readonly stills: readonly string[];
  readonly aired: boolean;
  readonly watched: boolean;
  readonly watchedAt: string | null;
  readonly prev: EpisodeNav | null;
  readonly next: EpisodeNav | null;
}

const key = (season: number, number: number): string => `${season}:${number}`;

interface ProgressEpisode extends EpisodeNav {
  readonly watched: boolean;
  readonly watchedAt: string | null;
}

function flattenProgress(progress: Progress): ProgressEpisode[] {
  const episodes: ProgressEpisode[] = [];
  for (const season of progress.seasons ?? []) {
    for (const episode of season.episodes) {
      episodes.push({
        season: season.number,
        number: episode.number,
        watched: episode.completed,
        watchedAt: episode.last_watched_at ?? null,
      });
    }
  }
  return episodes;
}

function navigation(episodes: readonly ProgressEpisode[], target: EpisodeNav) {
  const ordering = new Map(
    episodes.map(({ season, number }) => [key(season, number), { season, number }]),
  );
  ordering.set(key(target.season, target.number), target);

  const ordered = [...ordering.values()].sort(
    (a, b) =>
      Number(a.season === 0) - Number(b.season === 0) || a.season - b.season || a.number - b.number,
  );
  const index = ordered.findIndex(
    (episode) => episode.season === target.season && episode.number === target.number,
  );
  return {
    prev: index > 0 ? (ordered[index - 1] ?? null) : null,
    next: index >= 0 && index < ordered.length - 1 ? (ordered[index + 1] ?? null) : null,
  };
}

export function assembleEpisodeDetail(
  showId: number,
  episode: EpisodeData,
  progress: Progress,
  now: number,
): EpisodeDetail {
  const target = { season: episode.season, number: episode.number };
  const progressEpisodes = flattenProgress(progress);
  const watchedEpisode = progressEpisodes.find(
    (item) => item.season === target.season && item.number === target.number,
  );
  const stills = episode.images?.screenshot ?? episode.images?.thumb ?? [];

  return {
    showId,
    season: episode.season,
    number: episode.number,
    title: episode.title ?? null,
    overview: episode.overview ?? null,
    firstAired: episode.first_aired ?? null,
    runtime: episode.runtime ?? null,
    ids: toEpisodeIds(episode.ids),
    stills,
    aired: isAired(episode.first_aired ?? null, now),
    watched: watchedEpisode?.watched ?? false,
    watchedAt: watchedEpisode?.watchedAt ?? null,
    ...navigation(progressEpisodes, target),
  };
}
