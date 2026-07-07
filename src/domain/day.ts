/**
 * Local-day grouping primitives shared by the Calendar (upcoming days) and the
 * Diary (watch-history days) so both bucket and shift days the same way — the one
 * source of truth for "which local day does this instant fall on".
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/** `ms → "YYYY-MM-DD"` in `timeZone` (en-CA renders the ISO date order). */
export function dayKeyFormatter(timeZone: string): (ms: number) => string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (ms) => fmt.format(ms);
}

/**
 * The day-key `deltaDays` away from `key`, computed as pure Y-M-D arithmetic in
 * UTC (DST-safe: it never crosses a wall-clock offset that a local `Date` would).
 */
export function shiftDayKey(key: string, deltaDays: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + deltaDays));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
