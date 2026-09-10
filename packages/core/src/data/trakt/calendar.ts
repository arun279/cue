import type { CalendarEntry } from "../../domain/calendar";
import type { CalendarItem } from "./schemas";
import { toEpisodeIds } from "./show-detail";

/**
 * Flatten `/calendars/my/shows` rows into the domain `CalendarEntry[]` the
 * grouping selector consumes. The row-level `first_aired` is the
 * authoritative air instant (an episode can be re-aired), so it wins over the
 * episode body's own date. Poster candidates come off the show for the image
 * resolver.
 */
export function assembleCalendarEntries(items: readonly CalendarItem[]): CalendarEntry[] {
  return items.map((item) => ({
    showId: item.show.ids.trakt,
    showTitle: item.show.title,
    season: item.episode.season,
    number: item.episode.number,
    episodeTitle: item.episode.title ?? null,
    firstAired: item.first_aired,
    ids: toEpisodeIds(item.episode.ids),
    posters: item.show.images?.poster ?? [],
    network: item.show.network ?? null,
    tmdbId: item.episode.ids.tmdb ?? null,
  }));
}
