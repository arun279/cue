import type { CalendarDay, CalendarRow } from "@cue/core/domain/calendar";
import { localTimeZone } from "@cue/core/domain/time";

const DAY_MS = 24 * 60 * 60 * 1000;

interface AgendaHeader {
  readonly kind: "header";
  readonly dayKey: string;
  readonly label: string;
  readonly count: number;
}

interface AgendaEpisode {
  readonly kind: "episode";
  readonly row: CalendarRow;
  /** Whole local days from today; 0 = today. */
  readonly offset: number;
}

export type AgendaItem = AgendaHeader | AgendaEpisode;

/** "YYYY-MM-DD" → whole-day distance, as pure UTC date arithmetic (DST-safe). */
function dayOffset(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS);
}

/**
 * Flatten the grouped calendar days into one window-friendly sequence of
 * sticky day headers and episode rows. Every row carries its day's distance from
 * today so the countdown chips and the day labels can never disagree. Both
 * derive from the same frozen `now`.
 */
export function buildAgenda(
  days: readonly CalendarDay[],
  now: number,
  timeZone: string = localTimeZone(),
): AgendaItem[] {
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const items: AgendaItem[] = [];
  for (const day of days) {
    if (day.rows.length === 0) continue;
    const offset = Math.max(0, dayOffset(todayKey, day.dayKey));
    items.push({ kind: "header", dayKey: day.dayKey, label: day.label, count: day.rows.length });
    for (const row of day.rows) items.push({ kind: "episode", row, offset });
  }
  return items;
}

/**
 * The row's trailing countdown chip: days away for future days, air time for
 * today's still-unaired episodes, nothing once aired (the "Aired 8:00 PM" text
 * line takes over, and there is never a check here; marking lives in Up Next).
 */
export function trailingChip(offset: number, aired: boolean, timeLabel: string): string | null {
  if (aired) return null;
  return offset > 0 ? `${offset}d` : timeLabel;
}
