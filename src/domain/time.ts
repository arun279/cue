/** Parse an ISO timestamp to epoch ms, or `null` when absent/unparseable. */
export function toMs(iso: string | null | undefined): number | null {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * The viewer's real device timezone (IANA), the honest basis for grouping dated
 * things by "local day" — the Calendar's upcoming days and the Diary's watch
 * history alike. Reading it from the runtime rather than hardcoding a fixed zone
 * means a day-boundary label ("Today" / "Yesterday") reflects where the user
 * actually is, so it never mislabels a late-evening watch as the wrong day.
 * Falls back to UTC on the rare host that reports no zone.
 */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** A watch-time figure split for the Profile theatre: a dominant `value`+`unit`
 * headline (e.g. `18` `days`) and a finer `detail` remainder (e.g. `6 hr 30 min`). */
export interface WatchTime {
  readonly value: string;
  readonly unit: string;
  readonly detail: string;
}

/**
 * Humanize a total watch-time in minutes into a headline unit + a finer detail
 * line. Days lead once past 24h (with an hr/min remainder), then hours (with a
 * min remainder), then minutes — so the biggest true unit is always the number
 * the eye lands on. Abbreviated remainders stay singular (`6 hr 30 min`).
 * Negative/NaN inputs clamp to zero.
 */
export function humanizeWatchMinutes(minutes: number): WatchTime {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) {
    return {
      value: String(days),
      unit: days === 1 ? "day" : "days",
      detail: `${hours} hr ${mins} min`,
    };
  }
  if (hours > 0) {
    return { value: String(hours), unit: hours === 1 ? "hour" : "hours", detail: `${mins} min` };
  }
  return { value: String(mins), unit: mins === 1 ? "minute" : "minutes", detail: "keep watching" };
}

/**
 * Has this episode aired at or before `now`? A missing/unparseable air date is
 * treated as not-yet-aired — the aired-only surfaces must never surface an
 * episode whose air date we can't establish.
 */
export function isAired(firstAired: string | null | undefined, now: number): boolean {
  const t = toMs(firstAired);
  return t !== null && t <= now;
}
