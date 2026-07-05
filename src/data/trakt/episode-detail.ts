import type { EpisodeIds } from "@domain/model/ids";
import { isAired } from "@domain/time";
import type { EpisodeData, Progress } from "./schemas";
import { toEpisodeIds } from "./show-detail";

/** A prev/next navigation target within the show (season + episode number). */
export interface EpisodeNav {
  readonly season: number;
  readonly number: number;
}

/** The Episode detail model: content + watched state + prev/next nav. */
export interface EpisodeDetail {
  readonly showId: number;
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly overview: string | null;
  readonly firstAired: string | null;
  readonly runtime: number | null;
  readonly ids: EpisodeIds;
  /** Trakt inline still candidates (screenshot → thumb), fed to the image resolver. */
  readonly stills: readonly string[];
  readonly aired: boolean;
  readonly watched: boolean;
  /** From progress `last_watched_at`; null when unwatched. */
  readonly watchedAt: string | null;
  readonly prev: EpisodeNav | null;
  readonly next: EpisodeNav | null;
}

const key = (season: number, number: number): string => `${season}:${number}`;

/**
 * Assemble the Episode detail model from the single-episode payload (content +
 * still) and the show progress (watched flag + watched-at + the ordered episode
 * list prev/next navigate). The target episode is inserted into the ordering so
 * an unaired episode reached from Show detail still gets neighbours.
 *
 * TODO(episode-nav): `progress.seasons` only spans aired episodes, so prev/next
 * can't reach an unaired episode that isn't the target. Derive the ordering from
 * the full `/shows/:id/seasons` list and keep watched state from progress.
 */
export function assembleEpisodeDetail(
  showId: number,
  episode: EpisodeData,
  progress: Progress,
  now: number,
): EpisodeDetail {
  const target: EpisodeNav = { season: episode.season, number: episode.number };
  const ordering = new Map<string, EpisodeNav>();
  let watched = false;
  let watchedAt: string | null = null;
  for (const season of progress.seasons ?? []) {
    for (const ep of season.episodes) {
      ordering.set(key(season.number, ep.number), { season: season.number, number: ep.number });
      if (season.number === target.season && ep.number === target.number) {
        watched = ep.completed;
        watchedAt = ep.last_watched_at ?? null;
      }
    }
  }
  ordering.set(key(target.season, target.number), target);

  const ordered = [...ordering.values()].sort((a, b) => a.season - b.season || a.number - b.number);
  const index = ordered.findIndex((e) => e.season === target.season && e.number === target.number);
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
    watched,
    watchedAt,
    prev: index > 0 ? (ordered[index - 1] ?? null) : null,
    next: index >= 0 && index < ordered.length - 1 ? (ordered[index + 1] ?? null) : null,
  };
}
