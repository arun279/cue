import type { CalendarEntry } from "@domain/calendar";
import type { EpisodeIds } from "@domain/model/ids";
import type { CalendarItem } from "./schemas";

function episodeIds(ids: CalendarItem["episode"]["ids"]): EpisodeIds {
  return {
    trakt: ids.trakt,
    tvdb: ids.tvdb ?? undefined,
    imdb: ids.imdb ?? undefined,
    tmdb: ids.tmdb ?? undefined,
  };
}

/**
 * Flatten `/calendars/my/shows` rows into the domain `CalendarEntry[]` the
 * grouping selector consumes. The row-level `first_aired` is the
 * authoritative air instant (an episode can be re-aired), so it wins over the
 * episode body's own date. Poster candidates come off the show for the image
 * resolver; the episode's tmdb id backs the TMDB still fallback.
 */
export function assembleCalendarEntries(items: readonly CalendarItem[]): CalendarEntry[] {
  return items.map((item) => ({
    showId: item.show.ids.trakt,
    showTitle: item.show.title,
    season: item.episode.season,
    number: item.episode.number,
    episodeTitle: item.episode.title ?? null,
    firstAired: item.first_aired,
    ids: episodeIds(item.episode.ids),
    posters: item.show.images?.poster ?? [],
    tmdbId: item.episode.ids.tmdb ?? null,
  }));
}
