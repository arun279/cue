import { dayLabeler } from "./day";
import type { EpisodeIds, MovieIds } from "./model/ids";
import { toMs } from "./time";

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

export function historyRange(year: number, month?: number): HistoryRange {
  if (month === undefined) {
    return {
      startAt: `${year}-01-01T00:00:00.000Z`,
      endAt: `${year}-12-31T23:59:59.999Z`,
    };
  }
  const start = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  const nextMonth = Date.UTC(year, month, 1, 0, 0, 0, 0);
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(nextMonth - 1).toISOString(),
  };
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
      groups: groupDay(rows.sort((a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt))),
    }));
}
