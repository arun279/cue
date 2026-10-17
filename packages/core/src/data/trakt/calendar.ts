import type { CalendarEntry } from "../../domain/calendar";
import type { CalendarItem } from "./schemas";
import { toEpisodeIds } from "./show-detail";

// A calendar row's first_aired is the airing instant, which differs from the episode's own date on a re-air.
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
