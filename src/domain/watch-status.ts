import type { LibraryShow } from "./model/library";
import { isAired, toMs } from "./time";

export type WatchStatus =
  | "abandoned"
  | "not-started"
  | "watching"
  | "lapsed"
  | "caught-up"
  | "ended";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["ended", "canceled", "cancelled"]);

/**
 * 21 days = three stacked unwatched weekly episodes: the knee past
 * single-skip tolerance, before backlog dread.
 */
export const DEFAULT_STALENESS_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000;

export function computeWatchStatus(
  show: LibraryShow,
  now: number,
  thresholdMs: number,
): WatchStatus {
  if (show.hidden) return "abandoned";
  const { aired, completed, nextEpisode, status } = show;
  if (completed <= 0) return "not-started";
  if (TERMINAL_STATUSES.has(status.toLowerCase()) && completed >= aired) return "ended";
  const hasAiredNext = nextEpisode !== null && isAired(nextEpisode.firstAired, now);
  if (!hasAiredNext) return "caught-up";
  const last = toMs(show.lastWatchedAt);
  return last !== null && now - last <= thresholdMs ? "watching" : "lapsed";
}
