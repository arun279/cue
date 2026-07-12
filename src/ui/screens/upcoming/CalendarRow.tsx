import { queryKeys } from "@data/query-keys";
import type { CalendarRow as CalendarRowModel } from "@domain/calendar";
import { localTimeZone } from "@domain/time";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@ui/components/Badge";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { epCode } from "@ui/format";
import { CONTENT_STALE_TIME_MS } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";
import { trailingChip } from "./agenda";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The row's show art + network, via the same deferred per-show read the queue
 * rows use (identical cache key, so a show seen on two surfaces never
 * refetches). Read here in full rather than through `useShowArt`, whose slice
 * omits the network the calendar's time line carries.
 */
function useShowMeta(showId: number): { posters: readonly string[]; network: string | null } {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.showArt(showId),
    queryFn: () => runtime.loadShowArt(showId),
    staleTime: CONTENT_STALE_TIME_MS,
  });
  return { posters: query.data?.posters ?? [], network: query.data?.network ?? null };
}

interface CalendarRowProps {
  readonly row: CalendarRowModel;
  /** Whole local days from today; 0 = today. */
  readonly offset: number;
}

/**
 * One calendar agenda row: poster, show title, quiet episode line, air
 * time + network, and a trailing countdown chip. The body links to the show —
 * never a check; today's already-aired episodes read "Aired 8:00 PM" and are
 * marked from Up Next, one home per action.
 */
export function CalendarRow({ row, offset }: CalendarRowProps): ReactElement {
  const meta = useShowMeta(row.showId);
  const posters = meta.posters.length > 0 ? meta.posters : row.posters;
  const time = timeFmt.format(new Date(row.firstAired));
  const chip = trailingChip(offset, row.aired, time);
  // Today's unaired rows carry the time in the trailing chip, so the text line
  // keeps only the network rather than stating the hour twice.
  const when = row.aired ? `Aired ${time}` : offset > 0 ? time : null;
  const whenLine = [when, meta.network].filter((part) => part !== null).join(" · ");

  return (
    <EpisodeRow
      variant="calendar"
      testId="calendar-row"
      showId={row.showId}
      art={<Poster title={row.showTitle} posters={posters} variant="s40" />}
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
      linkLabel={row.showTitle}
    />
  );
}
