import type { HistoryDay, HistoryEntry } from "@cue/core/domain/history";
import { epCode } from "@cue/core/domain/model/library";

export interface HistoryRowModel {
  readonly entry: HistoryEntry;
  readonly plays: number;
}

export function itemKey(entry: HistoryEntry): string {
  return `${entry.type}:${entry.mediaId}:${entry.season}:${entry.number}`;
}

export function entryDetail(entry: HistoryEntry): string {
  if (entry.type === "movie") return entry.year === null ? "Movie" : String(entry.year);
  return [epCode(entry.season ?? 0, entry.number ?? 0), entry.episodeTitle]
    .filter(Boolean)
    .join(" ");
}

export function historySections(days: readonly HistoryDay[], filter: string) {
  let previousYear = "";
  let rowIndex = 0;
  return days.flatMap((day) => {
    const rows = new Map<string, HistoryRowModel>();
    for (const entry of day.groups.flatMap((group) => group.entries)) {
      if (!entry.title.toLowerCase().includes(filter.trim().toLowerCase())) continue;
      const key = itemKey(entry);
      const existing = rows.get(key);
      rows.set(key, { entry: existing?.entry ?? entry, plays: (existing?.plays ?? 0) + 1 });
    }
    if (rows.size === 0) return [];
    const data = [...rows.values()].map((row) => ({ ...row, index: rowIndex++ }));
    const year = day.dayKey.slice(0, 4);
    const yearHeading = previousYear !== "" && previousYear !== year ? year : null;
    previousYear = year;
    const rollup = (["episode", "movie"] as const)
      .flatMap((type) => {
        const count = data.reduce((sum, row) => sum + (row.entry.type === type ? row.plays : 0), 0);
        return count === 0 ? [] : [`${count} ${type}${count === 1 ? "" : "s"}`];
      })
      .join(" · ");
    return [{ key: day.dayKey, label: `${day.label} · ${rollup}`, yearHeading, data }];
  });
}

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function jumpLabel(year?: number, month?: number): string {
  if (year === undefined) return `${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`;
  return month === undefined ? String(year) : `${MONTHS[month - 1]} ${year}`;
}
