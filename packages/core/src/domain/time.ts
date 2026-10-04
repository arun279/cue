export const DAY_MS = 24 * 60 * 60 * 1000;

export function toMs(iso: string | null | undefined): number | null {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface WatchTime {
  readonly value: string;
  readonly unit: string;
  readonly detail: string;
}

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

export function isAired(firstAired: string | null | undefined, now: number): boolean {
  const t = toMs(firstAired);
  return t !== null && t <= now;
}
