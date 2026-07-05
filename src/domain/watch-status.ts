import type { LibraryShow } from "./model/library";
import { isAired } from "./time";

/**
 * Aired-based library buckets. `stopped` (a hidden show) overrides
 * everything; the two "caught up" buckets split on whether a future episode is
 * announced (`coming-soon`) or not (`up-to-date`); `to-watch` is a watchlisted
 * show not yet started.
 */
export type WatchStatus =
  | "stopped"
  | "not-started"
  | "to-watch"
  | "watching"
  | "up-to-date"
  | "coming-soon"
  | "ended";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["ended", "canceled", "cancelled"]);

export function computeWatchStatus(show: LibraryShow, now: number): WatchStatus {
  if (show.hidden) return "stopped";
  const { aired, completed } = show;
  if (completed <= 0) return show.inWatchlist ? "to-watch" : "not-started";
  if (completed < aired) return "watching";
  // Caught up to what has aired (`completed >= aired`).
  if (TERMINAL_STATUSES.has(show.status.toLowerCase())) return "ended";
  const next = show.nextEpisode;
  if (next !== null && !isAired(next.firstAired, now)) return "coming-soon";
  return "up-to-date";
}
