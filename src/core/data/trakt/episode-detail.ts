import type { EpisodeDetail } from "../../domain/episode-detail";
import type { EpisodeKey } from "../../domain/model/library";
import { episodeNavigation } from "../../domain/show-detail";
import { isAired } from "../../domain/time";
import type { EpisodeData, Progress } from "./schemas";
import { stillsOf, toEpisodeIds } from "./show-detail";

const key = (season: number, number: number): string => `${season}:${number}`;

interface ProgressEpisode extends EpisodeKey {
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

function navigation(
  episodes: readonly ProgressEpisode[],
  target: EpisodeKey,
): { readonly prev: EpisodeKey | null; readonly next: EpisodeKey | null } {
  const ordering = new Map(
    episodes.map(({ season, number }) => [key(season, number), { season, number }]),
  );
  ordering.set(key(target.season, target.number), target);
  return episodeNavigation([{ episodes: [...ordering.values()] }], target);
}

export function assembleEpisodeDetail(
  showId: number,
  episode: EpisodeData,
  progress: Progress,
  now: number,
): EpisodeDetail {
  const target = { season: episode.season, number: episode.number };
  const progressEpisodes = flattenProgress(progress);
  const firstAired = episode.first_aired ?? null;

  return {
    showId,
    season: episode.season,
    number: episode.number,
    title: episode.title ?? null,
    overview: episode.overview ?? null,
    firstAired,
    runtime: episode.runtime ?? null,
    ids: toEpisodeIds(episode.ids),
    stills: stillsOf(episode),
    aired: isAired(firstAired, now),
    ...watchState(progressEpisodes, target),
    ...navigation(progressEpisodes, target),
  };
}

function watchState(
  episodes: readonly ProgressEpisode[],
  target: EpisodeKey,
): Pick<EpisodeDetail, "watched" | "watchedAt"> {
  const watched = episodes.find(
    (item) => item.season === target.season && item.number === target.number,
  );
  return { watched: watched?.watched ?? false, watchedAt: watched?.watchedAt ?? null };
}
