import type { CalendarRow as CalendarRowModel } from "@domain/calendar";
import { epCode } from "@domain/model/library";
import { localTimeZone } from "@domain/time";
import { Badge } from "@ui/components/Badge";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";
import { trailingChip } from "./agenda";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

interface CalendarRowProps {
  readonly row: CalendarRowModel;
  /** Whole local days from today; 0 = today. */
  readonly offset: number;
}

/**
 * One calendar agenda row: poster, show title, quiet episode line, air
 * time + network, and a trailing countdown chip. Poster and network both
 * arrive inline on the calendar read (`extended=full,images`), so a row costs
 * zero follow-up GETs. The body links to the show, never a check; today's
 * already-aired episodes read "Aired 8:00 PM" and are marked from Up Next,
 * one home per action.
 */
export function CalendarRow({ row, offset }: CalendarRowProps): ReactElement {
  const time = timeFmt.format(new Date(row.firstAired));
  const chip = trailingChip(offset, row.aired, time);
  // Today's unaired rows carry the time in the trailing chip, so the text line
  // keeps only the network rather than stating the hour twice.
  const when = row.aired ? `Aired ${time}` : offset > 0 ? time : null;
  const whenLine = [when, row.network].filter((part) => part !== null).join(" · ");

  return (
    <EpisodeRow
      variant="calendar"
      testId="calendar-row"
      showId={row.showId}
      art={<Poster title={row.showTitle} posters={row.posters} variant="s40" />}
      title={row.showTitle}
      meta={
        <>
          <span className="ep-row__code">{epCode(row.season, row.number)}</span>
          {row.episodeTitle !== null && ` · ${row.episodeTitle}`}
        </>
      }
      footer={whenLine === "" ? undefined : <span className="calendar-when">{whenLine}</span>}
      trailing={
        chip === null ? undefined : (
          <Badge variant="countdown" testId="calendar-countdown">
            {chip}
          </Badge>
        )
      }
      link={{ to: "/show/$showId", params: { showId: String(row.showId) } }}
      linkLabel={`${row.showTitle}, ${epCode(row.season, row.number)}${
        row.episodeTitle === null ? "" : ` ${row.episodeTitle}`
      }, ${row.aired ? "Aired " : ""}${time}${row.network === null ? "" : `, ${row.network}`}`}
    />
  );
}
