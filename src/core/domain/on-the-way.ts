import type { CalendarDay, CalendarRow } from "./calendar";
import { dayKeyOf, dayOffset } from "./day";
import { DAY_MS, localTimeZone } from "./time";

const SCOPE_MS = 3 * DAY_MS;
const MAX_ROWS = 3;

export interface OnTheWayDay {
  readonly key: string;
  readonly label: string;
  readonly offset: number;
  readonly rows: readonly CalendarRow[];
}

const weekdayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  weekday: "long",
});

export function buildOnTheWay(days: readonly CalendarDay[], now: number): OnTheWayDay[] {
  const todayKey = dayKeyOf(localTimeZone(), now);
  const out: OnTheWayDay[] = [];
  let taken = 0;
  for (const day of days) {
    if (taken >= MAX_ROWS) break;
    const rows = day.rows.filter((row) => {
      const ms = Date.parse(row.firstAired);
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
          : weekdayFmt.format(Date.parse(`${day.dayKey}T12:00`));
    out.push({ key: day.dayKey, label, offset, rows: kept });
  }
  return out;
}
