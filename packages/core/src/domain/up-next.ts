import type { EpisodeRef, LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus, type WatchStatus } from "./watch-status";

export interface UpNextItem {
  readonly showId: number;
  readonly title: string;
  readonly episode: EpisodeRef | null;
  readonly lastWatchedAt: string | null;
  readonly backlog: number;
}

export interface UpNextGroups {
  readonly queue: UpNextItem[];
  readonly lapsed: UpNextItem[];
}

type UpNextGroup = keyof UpNextGroups;

const NOTHING_TO_QUEUE: ReadonlySet<WatchStatus> = new Set(["abandoned", "not-started", "ended"]);

function hasSomethingToWatch(show: LibraryShow, status: WatchStatus, now: number): boolean {
  if (status !== "watching" && status !== "lapsed") return false;
  const airedMs = show.nextEpisode === null ? null : toMs(show.nextEpisode.firstAired);
  return airedMs !== null && airedMs <= now;
}

function classifyUpNextShow(
  show: LibraryShow,
  status: WatchStatus,
  now: number,
): UpNextGroup | null {
  if (NOTHING_TO_QUEUE.has(status)) return null;
  if (show.pendingAdvance) return "queue";
  if (!hasSomethingToWatch(show, status, now)) return null;
  return status === "lapsed" ? "lapsed" : "queue";
}

function toUpNextItem(show: LibraryShow): UpNextItem {
  return {
    showId: show.showId,
    title: show.title,
    episode: show.nextEpisode,
    lastWatchedAt: show.lastWatchedAt,
    backlog: Math.max(0, show.aired - show.completed),
  };
}

export function groupUpNext(
  shows: readonly LibraryShow[],
  now: number,
  thresholdMs: number,
): UpNextGroups {
  const groups: UpNextGroups = { queue: [], lapsed: [] };
  for (const show of shows) {
    const group = classifyUpNextShow(show, computeWatchStatus(show, now, thresholdMs), now);
    if (group !== null) groups[group].push(toUpNextItem(show));
  }
  return groups;
}

export function activeShowIds(
  shows: readonly LibraryShow[],
  now: number,
  thresholdMs: number,
): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const show of shows) {
    const status = computeWatchStatus(show, now, thresholdMs);
    if (
      status === "watching" ||
      status === "caught-up" ||
      classifyUpNextShow(show, status, now) === "queue"
    ) {
      ids.add(show.showId);
    }
  }
  return ids;
}

export type UpNextEmptyKind =
  | "nothing-tracked"
  | "only-stopped"
  | "nothing-started"
  | "unresolved"
  | "caught-up";

export interface UpNextComposition {
  readonly queued: number;
  readonly totalCount: number;
  readonly trackedCount: number;
  readonly startedCount: number;
  readonly unresolvedCount: number;
  readonly hasData: boolean;
}

export function upNextEmptyKind(view: UpNextComposition): UpNextEmptyKind | null {
  if (!view.hasData || view.queued > 0) return null;
  if (view.totalCount === 0) return "nothing-tracked";
  if (view.trackedCount === 0) return "only-stopped";
  if (view.startedCount === 0) return "nothing-started";
  return view.unresolvedCount > 0 ? "unresolved" : "caught-up";
}
