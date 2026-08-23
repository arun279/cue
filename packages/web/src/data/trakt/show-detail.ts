import type { EpisodeIds, ShowIds } from "@domain/model/ids";
import type { EpisodeRef } from "@domain/model/library";
import { isAired } from "@domain/time";
import { resolveStill } from "../image-source";
import type { EpisodeData, Progress, SeasonData, ShowDetailData } from "./schemas";

/** Trakt inline still candidates, screenshot preferred over the lower-res thumb. */
function stillsOf(episode: EpisodeData): readonly string[] {
  return episode.images?.screenshot ?? episode.images?.thumb ?? [];
}

/** One episode row on the Show detail season tree, with its derived watched + aired flags. */
export interface EpisodeView {
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly firstAired: string | null;
  readonly ids: EpisodeIds;
  /** Trakt inline still candidates (screenshot → thumb) for the season shelf thumbnail. */
  readonly stills: readonly string[];
  readonly watched: boolean;
  /** When this episode was last played (progress `last_watched_at`); null if unwatched.
   * Surfaced inline on the season shelf so a returning viewer sees WHEN, not just that. */
  readonly watchedAt: string | null;
  readonly aired: boolean;
}

/** A season and its episodes, plus the counts the per-season progress ring reads. */
export interface SeasonView {
  readonly number: number;
  readonly title: string | null;
  readonly isSpecial: boolean;
  /**
   * Hidden on Trakt. The progress read excludes hidden seasons from its breakdown and stats, so a
   * numbered season the tree lists below the breakdown's last season, which the breakdown omits,
   * is one the user hid; seasons past that frontier are simply newer than the snapshot.
   */
  readonly isHidden: boolean;
  readonly episodes: readonly EpisodeView[];
  readonly airedCount: number;
  readonly completedCount: number;
}

/** The first aired, unwatched, regular episode of the tree. */
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

/**
 * Everything `/shows/:id?extended=full,images` says about a show: content, not
 * user state. Cached once per show and shared by BOTH readers of that URL, the
 * deferred per-card art read and the Show detail hero, so opening a show whose
 * card already resolved costs only its progress GET.
 */
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

/** The user's progress through one show, from `/shows/:id/progress/watched`. */
export interface ShowProgress {
  readonly aired: number;
  readonly completed: number;
  readonly nextEpisode: EpisodeView | null;
}

/** The Show detail hero: the show's own facts merged with the viewer's progress. */
export interface ShowHeader extends ShowInfo, ShowProgress {}

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

/** Project the extended show payload onto the shared per-show content entity. */
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

/**
 * Project `/shows/:id/progress/watched` onto the hero's progress half. The
 * next-episode callout carries its own aired flag so the UI can label "next up"
 * vs "airs on".
 */
export function assembleShowProgress(progress: Progress, now: number): ShowProgress {
  const next = progress.next_episode;
  return {
    aired: progress.aired,
    completed: progress.completed,
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
            aired: isAired(next.first_aired ?? null, now),
          },
  };
}

/**
 * Merge the seasons tree (`/shows/:id/seasons?extended=episodes`) with the
 * per-episode watched flags from `progress/watched`, deriving each episode's
 * aired flag against `now`. Numbered seasons sort ascending with Specials
 * (season 0) after them. The run of the show reads first, the extras trail;
 * the safety-critical bulk-mark builder consumes the same episode `firstAired`
 * to keep unaired episodes out of every write.
 */
export function assembleSeasons(
  seasons: readonly SeasonData[],
  progress: Progress,
  now: number,
): SeasonView[] {
  // See `SeasonView.isHidden` for how omitted seasons below this frontier are classified.
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
            aired: isAired(episode.first_aired ?? null, now),
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
