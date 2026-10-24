import { dayKeyOf, dayLabeler, startOfLocalDay } from "./day";
import type { EpisodeIds, MovieIds } from "./model/ids";
import { localTimeZone, toMs } from "./time";

interface Play {
  readonly historyId: number;
  readonly watchedAt: string;
  readonly mediaId: number;
  readonly ids: EpisodeIds | MovieIds;
  readonly title: string;
  readonly year: number | null;
  readonly episodeTitle: string | null;
  readonly posters: readonly string[];
  readonly tmdbId: number | null;
}

export type HistoryEntry = Play &
  (
    | { readonly type: "episode"; readonly season: number; readonly number: number }
    | { readonly type: "movie"; readonly season: null; readonly number: null }
  );

interface HistoryGroup {
  readonly key: string;
  readonly entries: readonly HistoryEntry[];
  readonly loggedTogether: boolean;
}

export interface HistoryDay {
  readonly dayKey: string;
  readonly label: string;
  readonly groups: readonly HistoryGroup[];
}

export interface GroupHistoryOptions {
  readonly now: number;
  readonly timeZone: string;
}

export interface HistoryRange {
  readonly startAt: string;
  readonly endAt: string;
}

const pad = (value: number): string => String(value).padStart(2, "0");

export function historyRange(
  year: number,
  month?: number,
  timeZone: string = localTimeZone(),
): HistoryRange {
  const first = month ?? 1;
  const [endYear, endMonth] =
    month === undefined || month === 12 ? [year + 1, 1] : [year, month + 1];
  const start = startOfLocalDay(timeZone, `${year}-${pad(first)}-01`);
  const end = startOfLocalDay(timeZone, `${endYear}-${pad(endMonth)}-01`);
  return { startAt: new Date(start).toISOString(), endAt: new Date(end - 1).toISOString() };
}

interface YearMonth {
  readonly year: number;
  readonly month: number;
}

export interface JumpRange {
  readonly first: YearMonth;
  readonly last: YearMonth;
}

function yearMonthOf(timeZone: string, ms: number): YearMonth {
  const key = dayKeyOf(timeZone, ms);
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

export function jumpRange(
  firstPlayAt: string | null,
  now: number,
  timeZone: string = localTimeZone(),
): JumpRange {
  const last = yearMonthOf(timeZone, now);
  const firstMs = toMs(firstPlayAt);
  return {
    first: firstMs === null || firstMs > now ? last : yearMonthOf(timeZone, firstMs),
    last,
  };
}

export function jumpYears({ first, last }: JumpRange): number[] {
  return Array.from({ length: last.year - first.year + 1 }, (_, i) => last.year - i);
}

export function jumpMonths({ first, last }: JumpRange, year: number): number[] {
  const from = year === first.year ? first.month : 1;
  const to = year === last.year ? last.month : 12;
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

export function historyScopeKey(year?: number, month?: number): string {
  if (year === undefined) return "recent";
  if (month === undefined) return String(year);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function minuteOf(ms: number): number {
  return Math.floor(ms / 60_000);
}

function sameShowEpisodes(a: HistoryEntry, b: HistoryEntry): boolean {
  return a.type === "episode" && b.type === "episode" && a.mediaId === b.mediaId;
}

const newestFirst = (a: HistoryEntry, b: HistoryEntry): number =>
  Date.parse(b.watchedAt) - Date.parse(a.watchedAt) ||
  a.type.localeCompare(b.type) ||
  a.mediaId - b.mediaId ||
  Number(b.season) - Number(a.season) ||
  Number(b.number) - Number(a.number);

function groupDay(entries: readonly HistoryEntry[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  let run: HistoryEntry[] = [];
  const flush = (): void => {
    const head = run[0] as HistoryEntry;
    const minutes = new Set(run.map((e) => minuteOf(Date.parse(e.watchedAt))));
    groups.push({
      key: `${head.type}:${head.historyId}`,
      entries: run,
      loggedTogether: run.length > 1 && minutes.size === 1,
    });
    run = [];
  };
  for (const entry of entries) {
    const prev = run[run.length - 1];
    if (prev !== undefined && !sameShowEpisodes(prev, entry)) flush();
    run.push(entry);
  }
  flush();
  return groups;
}

export function groupHistory(
  entries: readonly HistoryEntry[],
  options: GroupHistoryOptions,
): HistoryDay[] {
  const { now, timeZone } = options;
  const { keyOf: dayKeyOf, label: labelFor } = dayLabeler(timeZone, now, {
    delta: -1,
    label: "Yesterday",
  });

  const byDay = new Map<string, { readonly sample: number; readonly rows: HistoryEntry[] }>();
  for (const entry of entries) {
    const ms = toMs(entry.watchedAt);
    if (ms === null) continue;
    const key = dayKeyOf(ms);
    const day = byDay.get(key) ?? { sample: ms, rows: [] };
    day.rows.push(entry);
    byDay.set(key, day);
  }

  return [...byDay]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dayKey, { sample, rows }]) => ({
      dayKey,
      label: labelFor(dayKey, sample),
      groups: groupDay(rows.sort(newestFirst)),
    }));
}
