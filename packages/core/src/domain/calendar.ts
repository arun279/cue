import { dayLabeler } from "./day";
import type { EpisodeIds } from "./model/ids";
import { compareEpisodeKeys, type EpisodeKey, epCode } from "./model/library";
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
  readonly episodes: readonly EpisodeKey[];
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
  readonly playedShowIds?: ReadonlySet<number>;
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
  playedShowIds?: ReadonlySet<number>,
): readonly CalendarDay[] {
  return sliceCalendarDays(
    groupCalendar(data.entries, {
      now,
      timeZone,
      hiddenShowIds: new Set(data.hiddenShowIds),
      playedShowIds,
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

export interface EpisodeLine {
  readonly code: string;
  readonly spoken: string;
  readonly detail: string | null;
}

export function isEpisodeRun(episodes: readonly EpisodeKey[]): boolean {
  const [first] = episodes;
  return episodes.every(
    (episode, index) => episode.season === first?.season && episode.number === first.number + index,
  );
}

export function episodeLine(row: CalendarRow): EpisodeLine {
  const last = row.episodes.at(-1);
  if (last === undefined || row.episodes.length === 1) {
    const code = epCode(row.season, row.number);
    return { code, spoken: code, detail: row.episodeTitle };
  }
  const detail = `${row.episodes.length} episodes`;
  if (isEpisodeRun(row.episodes)) {
    return {
      code: `S${row.season} E${row.number}–E${last.number}`,
      spoken: `season ${row.season}, episodes ${row.number} to ${last.number}`,
      detail,
    };
  }
  if (last.season === row.season) {
    return { code: `S${row.season}`, spoken: `season ${row.season}`, detail };
  }
  return {
    code: `S${row.season}–S${last.season}`,
    spoken: `seasons ${row.season} to ${last.season}`,
    detail,
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
  const { now, timeZone, hiddenShowIds, playedShowIds } = options;
  const { keyOf: dayKeyOf, label: labelFor } = dayLabeler(timeZone, now, {
    delta: 1,
    label: "Tomorrow",
  });

  const drops = new Map<string, { readonly ms: number; readonly entries: CalendarEntry[] }>();
  for (const entry of entries) {
    if (hiddenShowIds.has(entry.showId)) continue;
    const ms = toMs(entry.firstAired);
    if (ms === null) continue;
    const key = `${entry.showId}@${ms}`;
    const drop = drops.get(key);
    if (drop === undefined) drops.set(key, { ms, entries: [entry] });
    else drop.entries.push(entry);
  }

  const byDay = new Map<string, { readonly sample: number; readonly rows: CalendarRow[] }>();
  for (const { ms, entries: dropped } of drops.values()) {
    const first = dropped.reduce((low, entry) =>
      compareEpisodeKeys(entry, low) < 0 ? entry : low,
    );
    const episodes = dropped
      .map(({ season, number }) => ({ season, number }))
      .sort(compareEpisodeKeys);
    if (
      playedShowIds !== undefined &&
      !playedShowIds.has(first.showId) &&
      !episodes.some(({ number }) => number === 1)
    ) {
      continue;
    }
    const key = dayKeyOf(ms);
    const day = byDay.get(key) ?? { sample: ms, rows: [] };
    day.rows.push({ ...first, aired: ms <= now, episodes });
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
