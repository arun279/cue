import { dayLabeler } from "./day";
import type { EpisodeIds } from "./model/ids";
import { toMs } from "./time";

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

/**
 * Group upcoming episodes by their local calendar day: exclude
 * hidden shows (Cue's client-side exclusion: Trakt still lists them), bucket by
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
  const { keyOf: dayKeyOf, label: labelFor } = dayLabeler(timeZone, now, {
    delta: 1,
    label: "Tomorrow",
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
      return { dayKey, label: labelFor(dayKey, sample), rows: ordered };
    });
}
