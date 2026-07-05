import type { EpisodeIds } from "./model/ids";
import { toMs } from "./time";

/**
 * Fixed IANA zone the calendar groups + localizes against. A deterministic
 * stand-in for the per-user timezone preference; a real
 * non-UTC offset so day-grouping is genuinely localized (an episode airing near
 * UTC midnight lands on the correct local day, not the UTC one).
 * TODO(m9-tz): read this from the user's timezone preference once Settings lands.
 */
export const CALENDAR_TIME_ZONE = "America/New_York";

/** One upcoming/aired episode, flattened from a `/calendars/my/shows` row. */
export interface CalendarEntry {
  readonly showId: number;
  readonly showTitle: string;
  readonly season: number;
  readonly number: number;
  readonly episodeTitle: string | null;
  readonly firstAired: string;
  readonly ids: EpisodeIds;
  readonly posters: readonly string[];
  readonly tmdbId: number | null;
}

export interface CalendarRow extends CalendarEntry {
  /** Aired at/-before `now` → eligible for the quick mark-watched affordance. */
  readonly aired: boolean;
}

/** Episodes sharing one local calendar day, with a human day label. */
export interface CalendarDay {
  readonly dayKey: string;
  readonly label: string;
  readonly rows: readonly CalendarRow[];
}

export interface GroupCalendarOptions {
  readonly now: number;
  readonly timeZone: string;
  readonly hiddenShowIds: ReadonlySet<number>;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `ms → "YYYY-MM-DD"` in `timeZone` (en-CA renders the ISO date order). */
function dayKeyFormatter(timeZone: string): (ms: number) => string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (ms) => fmt.format(ms);
}

/** The calendar date one day after `key`, computed as pure Y-M-D arithmetic (DST-safe). */
function nextDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Group upcoming episodes by their local calendar day: exclude
 * hidden shows (Cue's client-side exclusion — Trakt still lists them), bucket by
 * the day the episode airs in `timeZone`, sort days ascending and episodes within
 * a day by air time, and label each day Today / Tomorrow / weekday-date. Each row
 * carries an `aired` flag so the UI can offer quick mark-watched only on episodes
 * that have already aired. Unparseable air dates are dropped, never mis-grouped.
 */
export function groupCalendar(
  entries: readonly CalendarEntry[],
  options: GroupCalendarOptions,
): CalendarDay[] {
  const { now, timeZone, hiddenShowIds } = options;
  const dayKeyOf = dayKeyFormatter(timeZone);
  const todayKey = dayKeyOf(now);
  const tomorrowKey = nextDayKey(todayKey);
  const labelFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const byDay = new Map<string, CalendarRow[]>();
  for (const entry of entries) {
    if (hiddenShowIds.has(entry.showId)) continue;
    const ms = toMs(entry.firstAired);
    if (ms === null) continue;
    const key = dayKeyOf(ms);
    const list = byDay.get(key) ?? [];
    list.push({ ...entry, aired: ms <= now });
    byDay.set(key, list);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dayKey, rows]) => {
      const ordered = [...rows].sort(
        (a, b) => (toMs(a.firstAired) ?? 0) - (toMs(b.firstAired) ?? 0),
      );
      const sample = toMs(ordered[0]?.firstAired) ?? now;
      const label =
        dayKey === todayKey
          ? "Today"
          : dayKey === tomorrowKey
            ? "Tomorrow"
            : labelFmt.format(sample);
      return { dayKey, label, rows: ordered };
    });
}
