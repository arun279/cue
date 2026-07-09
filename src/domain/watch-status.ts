import type { LibraryShow } from "./model/library";
import { isAired, toMs } from "./time";

export type WatchStatus =
  | "abandoned"
  | "not-started"
  | "watching"
  | "lapsed"
  | "caught-up"
  | "sync-pending"
  | "ended";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["ended", "canceled", "cancelled"]);

/** A show whose run is over (ended/canceled) — the last aired episode is genuinely
 * the last one, so finishing it is a real closure moment rather than a pause. */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

/**
 * 21 days = three stacked unwatched weekly episodes: the knee past
 * single-skip tolerance, before backlog dread.
 */
export const DEFAULT_STALENESS_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * 7 days = one weekly release cycle — the window in which the next unwatched
 * episode counts as this week's fresh drop and pulls its show into the "New"
 * group. Grounded, not a round guess: it is the same weekly-cadence family as the
 * 21-day (3-week) lapse threshold above, one cycle rather than three. Flagged as a
 * value to revisit — ideally personalized to a show's own inter-episode cadence
 * (a daily-drop and a weekly-drop shouldn't share one window), never a
 * round-number-from-air.
 */
export const DEFAULT_NEW_EPISODE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function computeWatchStatus(
  show: LibraryShow,
  now: number,
  thresholdMs: number,
): WatchStatus {
  if (show.hidden) return "abandoned";
  // Beyond the cold-sync progress budget: `aired` is unknown, so the
  // show's real progress can't be derived. It is neither fabricated caught-up nor
  // misfiled not-started — it is honestly "still syncing" until its progress is read.
  if (!show.progressKnown) return "sync-pending";
  const { aired, completed, nextEpisode, status } = show;
  if (completed <= 0) return "not-started";
  if (isTerminalStatus(status) && completed >= aired) return "ended";
  const hasAiredNext = nextEpisode !== null && isAired(nextEpisode.firstAired, now);
  if (!hasAiredNext) return "caught-up";
  const last = toMs(show.lastWatchedAt);
  return last !== null && now - last <= thresholdMs ? "watching" : "lapsed";
}
