import type { CalendarDay } from "@cue/core/domain/calendar";
import { epCode } from "@cue/core/domain/model/library";
import { buildOnTheWay, type OnTheWayDay } from "@cue/core/domain/on-the-way";
import { localTimeZone } from "@cue/core/domain/time";
import { Badge } from "@ui/components/Badge";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { SectionHeader } from "@ui/components/SectionHeader";
import { Poster } from "@ui/screens/up-next/Poster";
import { Fragment, type ReactElement, useEffect, useMemo, useState } from "react";

const MAX_ROWS = 6;
const HOUR_MS = 60 * 60 * 1000;
/** How often the coarse clock re-checks whether the wall hour has flipped. */
const CLOCK_CHECK_MS = 60_000;

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

/**
 * A clock re-stamped when the wall hour flips: the `buildOnTheWay` memo input
 * that makes an episode airing while the home screen sits open drop from
 * "Tonight" within the hour, instead of lingering until the day flips.
 */
export function useOnTheWayDays(days: readonly CalendarDay[]): readonly OnTheWayDay[] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (Math.floor(Date.now() / HOUR_MS) !== Math.floor(now / HOUR_MS)) setNow(Date.now());
    }, CLOCK_CHECK_MS);
    return () => clearInterval(timer);
  }, [now]);
  return useMemo(() => buildOnTheWay(days, now, MAX_ROWS), [days, now]);
}

interface OnTheWayProps {
  readonly days: readonly OnTheWayDay[];
}

/** "On the way": the next 72 hours of scheduled episodes, no checks (nothing to
 * mark yet), each row linking to its show. Omitted entirely when empty. */
export function OnTheWay({ days }: OnTheWayProps): ReactElement | null {
  if (days.length === 0) return null;
  return (
    <section className="home-section" data-testid="on-the-way">
      <SectionHeader
        label="On the way"
        link={{ label: "Calendar", to: "/calendar", testId: "on-the-way-calendar" }}
      />
      {days.map((day) => (
        <Fragment key={day.key}>
          <h3 className="day-subheader">{day.label}</h3>
          <ul className="row-list">
            {day.rows.map((row) => (
              <li key={row.ids.trakt}>
                <EpisodeRow
                  variant="on-the-way"
                  testId="on-the-way-row"
                  showId={row.showId}
                  art={<Poster title={row.showTitle} posters={row.posters} variant="s40" />}
                  title={row.showTitle}
                  meta={
                    <>
                      <span className="ep-row__code">{epCode(row.season, row.number)}</span>
                      {` · ${timeFmt.format(new Date(row.firstAired))}`}
                    </>
                  }
                  trailing={
                    day.offset > 0 ? <Badge variant="countdown">{day.offset}d</Badge> : undefined
                  }
                  link={{ to: "/show/$showId", params: { showId: String(row.showId) } }}
                  linkLabel={`${row.showTitle}, ${epCode(row.season, row.number)}, ${timeFmt.format(
                    new Date(row.firstAired),
                  )}`}
                />
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
}
