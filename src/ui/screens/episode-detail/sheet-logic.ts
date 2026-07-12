import type { EpisodeDetail } from "@data/trakt/episode-detail";
import { epCode, formatAirDate, formatWatchedDate } from "@ui/format";
import { metaLine } from "@ui/screens/show-detail/detail-logic";

/** The sheet's quiet meta line: `S1 E5 · Aired Jul 1, 2002 · 60 min`, parts
 * dropping out when unknown. */
export function sheetMetaLine(
  episode: Pick<EpisodeDetail, "season" | "number" | "firstAired" | "runtime">,
): string {
  const air = formatAirDate(episode.firstAired);
  return metaLine([
    epCode(episode.season, episode.number),
    air === null ? null : `Aired ${air}`,
    episode.runtime === null ? null : `${episode.runtime} min`,
  ]);
}

/** The mark row's status line (§3.4.5). `plays` null = count still resolving:
 * read as a single play until known. */
export function watchedStatusLine(watchedAt: string | null, plays: number | null): string {
  if (plays !== null && plays >= 2) {
    return plays === 2 ? "Watched twice" : `Watched ${plays} times`;
  }
  const date = formatWatchedDate(watchedAt);
  return date === null ? "Watched" : `Watched ${date}`;
}

/** The remove-all ConfirmSheet consequence line (§4.4.2 exact for two plays). */
export function removeAllBody(code: string, plays: number): string {
  const tail = plays === 2 ? "both" : `all ${plays}`;
  return `${code} has ${plays} plays. This removes ${tail} from your history.`;
}
