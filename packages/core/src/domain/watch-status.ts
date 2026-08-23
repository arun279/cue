import type { LibraryShow } from "./model/library";
import { toMs } from "./time";

export type WatchStatus =
  | "abandoned"
  | "not-started"
  | "watching"
  | "lapsed"
  | "caught-up"
  | "ended";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["ended", "canceled", "cancelled"]);

/** A show whose run is over (ended/canceled): the last aired episode is genuinely
 * the last one, so finishing it is a real closure moment rather than a pause. */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

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
  if (isTerminalStatus(status) && completed >= aired) return "ended";
  const nextAiredMs = nextEpisode === null ? null : toMs(nextEpisode.firstAired);
  const hasAiredNext = nextAiredMs !== null && nextAiredMs <= now;
  // Unwatched aired episodes make a show in-progress whether or not the next one
  // is named: a show past the cold-sync progress budget has real counts but no
  // `nextEpisode`, and must not be filed as caught up on the strength of that gap.
  if (!hasAiredNext && completed >= aired) return "caught-up";
  // Idleness runs from the last chance to watch, not the last watch: a show
  // finished a year ago whose new season landed yesterday has been waiting one
  // day, not a year. The show has been ignorable only since BOTH the user's last
  // play AND the next episode's air date.
  const idleSince = Math.max(
    toMs(show.lastWatchedAt) ?? Number.NEGATIVE_INFINITY,
    hasAiredNext ? nextAiredMs : Number.NEGATIVE_INFINITY,
  );
  return now - idleSince <= thresholdMs ? "watching" : "lapsed";
}
