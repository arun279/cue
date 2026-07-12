import type { EpisodeIds, ShowIds } from "@domain/model/ids";
import { isAired } from "@domain/time";
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
  readonly episodes: readonly EpisodeView[];
  readonly airedCount: number;
  readonly completedCount: number;
}

/** The Show detail hero + overall-progress model. */
export interface ShowHeader {
  readonly showId: number;
  readonly ids: ShowIds;
  readonly title: string;
  readonly year: number | null;
  readonly status: string;
  readonly network: string | null;
  readonly genres: readonly string[];
  readonly overview: string | null;
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
  readonly tmdbId: number | null;
  readonly aired: number;
  readonly completed: number;
  /** The show's most recent play (progress `last_watched_at`); null if never watched. */
  readonly lastWatchedAt: string | null;
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

/**
 * Assemble the Show detail hero from the extended show payload + progress. The
 * next-episode callout is derived from Trakt's `next_episode` and carries its
 * own aired flag so the UI can label "next up" vs "airs on".
 */
export function assembleHeader(show: ShowDetailData, progress: Progress, now: number): ShowHeader {
  const next = progress.next_episode;
  return {
    showId: show.ids.trakt,
    ids: toShowIds(show.ids),
    title: show.title,
    year: show.year ?? null,
    status: show.status ?? "",
    network: show.network ?? null,
    genres: show.genres ?? [],
    overview: show.overview ?? null,
    posters: show.images?.poster ?? [],
    backdrops: show.images?.fanart ?? [],
    tmdbId: show.ids.tmdb ?? null,
    aired: progress.aired,
    completed: progress.completed,
    lastWatchedAt: progress.last_watched_at ?? null,
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
        episodes,
        airedCount: episodes.filter((episode) => episode.aired).length,
        completedCount: episodes.filter((episode) => episode.watched).length,
      };
    });
}
