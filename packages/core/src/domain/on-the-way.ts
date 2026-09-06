import type { CalendarDay, CalendarRow } from "./calendar";
import { dayKeyOf } from "./day";
import { localTimeZone } from "./time";

const SCOPE_MS = 72 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OnTheWayDay {
  readonly key: string;
  readonly label: string;
  /** Whole local days from today; 0 = tonight. */
  readonly offset: number;
  readonly rows: readonly CalendarRow[];
}

const weekdayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  weekday: "long",
});

/** "YYYY-MM-DD" → whole-day distance, as pure UTC date arithmetic. */
function dayOffset(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS);
}

/**
 * The home slice of the calendar read: not-yet-aired episodes within the next
 * 72 hours, capped at `maxRows`, day labels re-voiced for the home scroll
 * (Tonight / Tomorrow / weekday). Aired episodes never appear because they
 * already live in the queue, one home per action.
 *
 * The cap is the caller's, because it is a decision about how much of a screen
 * the section is worth rather than about what the next 72 hours hold.
 */
export function buildOnTheWay(
  days: readonly CalendarDay[],
  now: number,
  maxRows: number,
): OnTheWayDay[] {
  // Derived from the clock, not the sparse groups: on a day with no airing,
  // no group is labeled "Today", yet offsets must still count from today.
  const todayKey = dayKeyOf(localTimeZone(), now);
  const out: OnTheWayDay[] = [];
  let taken = 0;
  for (const day of days) {
    if (taken >= maxRows) break;
    const rows = day.rows.filter((row) => {
      const ms = Date.parse(row.firstAired);
      // `ms > now` is the direct check (NaN also fails it); the `aired` flag
      // alone can be stale. It was stamped by the calendar grouping's own
      // clock, which only re-anchors on a day flip.
      return !row.aired && ms > now && ms - now <= SCOPE_MS;
    });
    if (rows.length === 0) continue;
    const kept = rows.slice(0, maxRows - taken);
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
