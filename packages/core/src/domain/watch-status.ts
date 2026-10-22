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
  if (neverWatched(show)) return "not-started";
  const caughtUp = show.completed >= show.aired;
  if (caughtUp && isTerminalStatus(show.status)) return "ended";
  const nextAiredMs = airedBy(show.nextEpisode, now);
  if (caughtUp && nextAiredMs === null) return "caught-up";
  const idleSince = Math.max(
    toMs(show.lastWatchedAt) ?? Number.NEGATIVE_INFINITY,
    nextAiredMs ?? Number.NEGATIVE_INFINITY,
  );
  return now - idleSince <= thresholdMs ? "watching" : "lapsed";
}

function neverWatched(show: LibraryShow): boolean {
  return show.completed <= 0 && show.lastWatchedAt === null;
}

function airedBy(episode: LibraryShow["nextEpisode"], now: number): number | null {
  const airedMs = episode === null ? null : toMs(episode.firstAired);
  return airedMs !== null && airedMs <= now ? airedMs : null;
}
