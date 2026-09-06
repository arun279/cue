/** Presentation helpers shared across screens (dates, episode codes, progress). */

import { localTimeZone } from "./domain/time";

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

/** "Mar 16, 2008" (UTC, timezone-stable so the same episode reads the same everywhere). */
export function formatAirDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** "Mar 16, 2008" in the viewer's LOCAL day. Unlike an air date (a fixed
 * broadcast fact that reads the same everywhere), a watched date is a real
 * per-viewer event, the same instant the Diary buckets by local day, so a
 * late-evening play that lands after UTC midnight must read as the local day it
 * was watched, not a day ahead. */
const watchedDateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatWatchedDate(iso: string | null): string | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : watchedDateFmt.format(t);
}

/** Trakt genre slugs arrive lowercase ("crime"); the chips read as titles ("Crime"). */
export function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "today" / "yesterday" / "N days ago" / "N weeks ago" for the lapsed drawer,
 * where relative time IS the signal. Weeks take over at 14 days (two full weeks);
 * below that days stay the honest unit. Null when absent, unparseable, or future.
 */
export function lastWatchedPhrase(iso: string | null, now: number): string | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((now - t) / DAY_MS);
  if (days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

/**
 * Middle-truncate a long title so a snackbar keeps both the recognizable head
 * and the distinguishing tail; the episode code that follows is never the part
 * that gives way.
 */
export function middleTruncate(value: string, max = 28): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) * 0.6);
  const tail = max - 1 - head;
  return `${value.slice(0, head).trimEnd()}…${value.slice(value.length - tail).trimStart()}`;
}

/** Whole-percent watched, clamped to 0-100; 0 when nothing has aired yet. */
export function watchedPercent(completed: number, aired: number): number {
  if (aired <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / aired) * 100)));
}

/** Aired-but-unwatched count: the "3 left" beside a progress bar. */
export function episodesLeft(aired: number, completed: number): number {
  return Math.max(0, aired - completed);
}
