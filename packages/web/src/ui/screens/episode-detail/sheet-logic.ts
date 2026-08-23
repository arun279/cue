import type { EpisodeDetail } from "@cue/core/data/trakt/episode-detail";
import { epCode } from "@cue/core/domain/model/library";
import { formatAirDate, formatWatchedDate } from "@cue/core/format";
import { metaLine } from "@ui/screens/show-detail/detail-logic";

/** The sheet's quiet meta line: `S1 E5 · Aired Jul 1, 2002 · 60 min`, parts
 * dropping out when unknown. An unaired episode drops the date rather than
 * claiming it aired: the countdown panel above states when it airs. */
export function sheetMetaLine(
  episode: Pick<EpisodeDetail, "season" | "number" | "firstAired" | "runtime" | "aired">,
): string {
  const air = episode.aired ? formatAirDate(episode.firstAired) : null;
  return metaLine([
    epCode(episode.season, episode.number),
    air === null ? null : `Aired ${air}`,
    episode.runtime === null ? null : `${episode.runtime} min`,
  ]);
}

/** The mark row's status line. `plays` null = count still resolving:
 * read as a single play until known. */
export function watchedStatusLine(watchedAt: string | null, plays: number | null): string {
  if (plays !== null && plays >= 2) {
    return plays === 2 ? "Watched twice" : `Watched ${plays} times`;
  }
  const date = formatWatchedDate(watchedAt);
  return date === null ? "Watched" : `Watched ${date}`;
}

/** The remove-all ConfirmSheet consequence line, exact for two plays. */
export function removeAllBody(code: string, plays: number): string {
  const tail = plays === 2 ? "both" : `all ${plays}`;
  return `${code} has ${plays} plays. This removes ${tail} from your history.`;
}
