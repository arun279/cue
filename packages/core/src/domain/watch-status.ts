import type { LibraryShow } from "./model/library";
import { DAY_MS, toMs } from "./time";

export type WatchStatus =
  | "abandoned"
  | "not-started"
  | "watching"
  | "lapsed"
  | "caught-up"
  | "ended";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["ended", "canceled", "cancelled"]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

export const DEFAULT_STALENESS_THRESHOLD_MS = 21 * DAY_MS;

export function computeWatchStatus(
  show: LibraryShow,
  now: number,
  thresholdMs: number,
): WatchStatus {
  if (show.hidden) return "abandoned";
  const { aired, completed, nextEpisode, status } = show;
  if (completed <= 0) return "not-started";
  if (isTerminalStatus(status) && completed >= aired) return "ended";
  const nextAiredMs = nextEpisode === null ? null : toMs(nextEpisode.firstAired);
  const hasAiredNext = nextAiredMs !== null && nextAiredMs <= now;
  if (!hasAiredNext && completed >= aired) return "caught-up";
  const idleSince = Math.max(
    toMs(show.lastWatchedAt) ?? Number.NEGATIVE_INFINITY,
    hasAiredNext ? nextAiredMs : Number.NEGATIVE_INFINITY,
  );
  return now - idleSince <= thresholdMs ? "watching" : "lapsed";
}
