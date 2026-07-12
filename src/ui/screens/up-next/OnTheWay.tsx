import type { CalendarDay, CalendarRow } from "@domain/calendar";
import { dayKeyOf } from "@domain/day";
import { localTimeZone } from "@domain/time";
import { Badge } from "@ui/components/Badge";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { SectionHeader } from "@ui/components/SectionHeader";
import { epCode } from "@ui/format";
import { Poster } from "@ui/screens/up-next/Poster";
import { Fragment, type ReactElement, useEffect, useState } from "react";

const SCOPE_MS = 72 * 60 * 60 * 1000;
const MAX_ROWS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** How often the coarse clock re-checks whether the wall hour has flipped. */
const CLOCK_CHECK_MS = 60_000;

export interface OnTheWayDay {
  readonly key: string;
  readonly label: string;
  /** Whole local days from today; 0 = tonight. */
  readonly offset: number;
  readonly rows: readonly CalendarRow[];
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

const weekdayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  weekday: "long",
});

/** "YYYY-MM-DD" → whole-day distance, as pure UTC date arithmetic. */
function dayOffset(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS);
}

/**
 * A clock re-stamped when the wall hour flips: the `buildOnTheWay` memo input
 * that makes an episode airing while the home screen sits open drop from
 * "Tonight" within the hour, instead of lingering until the day flips.
 */
export function useOnTheWayClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (Math.floor(Date.now() / HOUR_MS) !== Math.floor(now / HOUR_MS)) setNow(Date.now());
    }, CLOCK_CHECK_MS);
    return () => clearInterval(timer);
  }, [now]);
  return now;
}

/**
 * The home slice of the calendar read: not-yet-aired episodes within the next
 * 72 hours, capped at six rows, day labels re-voiced for the home scroll
 * (Tonight / Tomorrow / weekday). Aired episodes never appear because they already
 * live in the queue, one home per action.
 */
export function buildOnTheWay(days: readonly CalendarDay[], now: number): OnTheWayDay[] {
  // Derived from the clock, not the sparse groups: on a day with no airing,
  // no group is labeled "Today", yet offsets must still count from today.
  const todayKey = dayKeyOf(localTimeZone(), now);
  const out: OnTheWayDay[] = [];
  let taken = 0;
  for (const day of days) {
    if (taken >= MAX_ROWS) break;
    const rows = day.rows.filter((row) => {
      const ms = Date.parse(row.firstAired);
      // `ms > now` is the direct check (NaN also fails it); the `aired` flag
      // alone can be stale. It was stamped by the calendar grouping's own
      // clock, which only re-anchors on a day flip.
      return !row.aired && ms > now && ms - now <= SCOPE_MS;
    });
    if (rows.length === 0) continue;
    const kept = rows.slice(0, MAX_ROWS - taken);
    taken += kept.length;
    const offset = dayOffset(todayKey, day.dayKey);
    const label =
      day.label === "Today"
        ? "Tonight"
        : day.label === "Tomorrow"
          ? "Tomorrow"
          : weekdayFmt.format(Date.parse(kept[0]?.firstAired ?? day.dayKey));
    out.push({ key: day.dayKey, label, offset, rows: kept });
  }
  return out;
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
                  linkLabel={row.showTitle}
                />
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
}
