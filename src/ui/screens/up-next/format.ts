/** Presentation helpers shared by the Up Next spotlight and its queue rows. */

const MONTHS = [
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
] as const;

export function episodeCode(season: number, number: number): string {
  return `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`;
}

/** "Mar 16, 2008" (UTC, timezone-stable so the same episode reads the same everywhere). */
export function formatAirDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** Trakt genre slugs arrive lowercase ("crime"); the chips read as titles ("Crime"). */
export function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Whole-percent watched, clamped to 0–100; 0 when nothing has aired yet. */
export function watchedPercent(completed: number, aired: number): number {
  if (aired <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / aired) * 100)));
}
