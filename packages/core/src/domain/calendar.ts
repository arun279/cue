import { dayLabeler } from "./day";
import type { EpisodeIds } from "./model/ids";
import { DAY_MS, localTimeZone, toMs } from "./time";

export const CALENDAR_WINDOW_DAYS = 28;
export const RECENT_CALENDAR_WINDOW_DAYS = 33;

export interface CalendarEntry {
  readonly showId: number;
  readonly showTitle: string;
  readonly season: number;
  readonly number: number;
  readonly episodeTitle: string | null;
  readonly firstAired: string;
  readonly ids: EpisodeIds;
  readonly posters: readonly string[];
  readonly network: string | null;
  readonly tmdbId: number | null;
}

export interface CalendarRow extends CalendarEntry {
  readonly aired: boolean;
}

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

interface CalendarSnapshot {
  readonly entries: readonly CalendarEntry[];
  readonly hiddenShowIds: readonly number[];
}

export function selectVisibleEntries(data: CalendarSnapshot): CalendarEntry[] {
  const hidden = new Set(data.hiddenShowIds);
  return data.entries.filter((entry) => !hidden.has(entry.showId));
}

export function buildCalendarDays(
  data: CalendarSnapshot,
  now: number,
  timeZone: string,
  startDate: string,
  windowDays: number,
): readonly CalendarDay[] {
  return sliceCalendarDays(
    groupCalendar(data.entries, {
      now,
      timeZone,
      hiddenShowIds: new Set(data.hiddenShowIds),
    }),
    startDate,
    windowDays,
    CALENDAR_WINDOW_DAYS,
  );
}

export interface AiringGrammar {
  readonly chip: string | null;
  readonly line: string | null;
  readonly spoken: string;
}

let timeFmt: Intl.DateTimeFormat | null = null;

export function airingGrammar(row: CalendarRow, offset: number): AiringGrammar {
  timeFmt ??= new Intl.DateTimeFormat("en-US", {
    timeZone: localTimeZone(),
    hour: "numeric",
    minute: "2-digit",
  });
  const time = timeFmt.format(toMs(row.firstAired) ?? 0);
  const spoken = [row.aired ? `Aired ${time}` : time, row.network].filter(Boolean).join(" · ");
  if (row.aired) return { chip: null, line: spoken, spoken };
  return {
    chip: offset > 0 ? `${offset}d` : time,
    line: offset > 0 ? spoken : row.network,
    spoken,
  };
}

export function recentCalendarStart(dayKey: string): string {
  return new Date(Date.parse(dayKey) - (RECENT_CALENDAR_WINDOW_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function sliceCalendarDays(
  days: readonly CalendarDay[],
  startKey: string,
  windowDays: number,
  fullWindowDays = 28,
): readonly CalendarDay[] {
  if (windowDays >= fullWindowDays) return days;
  const limit = Date.parse(startKey) + windowDays * DAY_MS;
  return days.filter((day) => Date.parse(day.dayKey) < limit);
}

export function groupCalendar(
  entries: readonly CalendarEntry[],
  options: GroupCalendarOptions,
): CalendarDay[] {
  const { now, timeZone, hiddenShowIds } = options;
  const { keyOf: dayKeyOf, label: labelFor } = dayLabeler(timeZone, now, {
    delta: 1,
    label: "Tomorrow",
  });

  const byDay = new Map<string, { readonly sample: number; readonly rows: CalendarRow[] }>();
  for (const entry of entries) {
    if (hiddenShowIds.has(entry.showId)) continue;
    const ms = toMs(entry.firstAired);
    if (ms === null) continue;
    const key = dayKeyOf(ms);
    const day = byDay.get(key) ?? { sample: ms, rows: [] };
    day.rows.push({ ...entry, aired: ms <= now });
    byDay.set(key, day);
  }

  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, { sample, rows }]) => ({
      dayKey,
      label: labelFor(dayKey, sample),
      rows: rows.sort((a, b) => Date.parse(a.firstAired) - Date.parse(b.firstAired)),
    }));
}
