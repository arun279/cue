import { dayLabeler } from "./day";
import type { EpisodeIds, MovieIds } from "./model/ids";
import { toMs } from "./time";

/**
 * One watch-history play, flattened from a `/users/me/history` row. The
 * `historyId` is Trakt's per-play event id — the handle that lets a single play be
 * removed WITHOUT touching the item's other plays/rewatches. `ids` is the item's
 * own id block, kept for the best-effort restore (re-adding the play by item).
 */
export interface HistoryEntry {
  readonly historyId: number;
  readonly watchedAt: string;
  readonly type: "episode" | "movie";
  /** The show (episode) or movie trakt id — the poster subject + detail link. */
  readonly mediaId: number;
  readonly ids: EpisodeIds | MovieIds;
  readonly title: string;
  /** Movie release year; null for episodes. */
  readonly year: number | null;
  readonly season: number | null;
  readonly number: number | null;
  readonly episodeTitle: string | null;
  readonly posters: readonly string[];
  readonly tmdbId: number | null;
}

/**
 * A run of history rows collapsed under one card. A lone play (or movie) is a
 * one-entry group; consecutive same-show episodes on the same day fold into a
 * multi-entry group with an expand affordance. `loggedTogether` marks a group
 * whose plays all share the same minute — a bulk "mark season/all", where the
 * timestamps are a best-effort stamp, not real per-episode watch times, so the UI
 * says "Logged together" and hides the (synthetic) per-play clock.
 */
export interface HistoryGroup {
  readonly key: string;
  readonly entries: readonly HistoryEntry[];
  readonly loggedTogether: boolean;
}

/** One local day of history, newest-first, with a quiet play-count rollup. */
export interface HistoryDay {
  readonly dayKey: string;
  readonly label: string;
  readonly episodeCount: number;
  readonly movieCount: number;
  readonly groups: readonly HistoryGroup[];
}

export interface GroupHistoryOptions {
  readonly now: number;
  readonly timeZone: string;
}

/** A closed datetime window for the Trakt history `start_at`/`end_at` params. */
export interface HistoryRange {
  readonly startAt: string;
  readonly endAt: string;
}

/**
 * The UTC datetime bounds of a year (or a month within it) for the decade-jump
 * scope — fed to Trakt's history `start_at`/`end_at`. `watched_at` is stored UTC,
 * so UTC bounds keep the scope deterministic: a coarse "everything I watched in
 * 2019 / March 2019" teleport, not a per-timezone-exact filter (the visible rows
 * are still re-bucketed by the viewer's local day). A year is
 * [Jan 1 00:00:00, Dec 31 23:59:59.999]; a month narrows to its own span.
 */
export function historyRange(year: number, month?: number): HistoryRange {
  if (month === undefined) {
    return {
      startAt: `${year}-01-01T00:00:00.000Z`,
      endAt: `${year}-12-31T23:59:59.999Z`,
    };
  }
  const start = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  const nextMonth = Date.UTC(year, month, 1, 0, 0, 0, 0);
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(nextMonth - 1).toISOString(),
  };
}

/**
 * The stable scope segment shared by the history query key and the `/history` URL
 * — `"recent"` (unbounded feed), `"2019"` (a year), or `"2019-03"` (a month). A
 * pure string so the infinite query caches each scope separately while
 * `historyPrefix()` still invalidates them as one.
 */
export function historyScopeKey(year?: number, month?: number): string {
  if (year === undefined) return "recent";
  if (month === undefined) return String(year);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Minute bucket of an instant — the honest precision Trakt normalizes plays to. */
function minuteOf(ms: number): number {
  return Math.floor(ms / 60_000);
}

/** Same show, both episodes — the only pair that folds into one card. */
function sameShowEpisodes(a: HistoryEntry, b: HistoryEntry): boolean {
  return a.type === "episode" && b.type === "episode" && a.mediaId === b.mediaId;
}

/** Fold a day's newest-first plays into groups, collapsing consecutive same-show episodes. */
function groupDay(entries: readonly HistoryEntry[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  let run: HistoryEntry[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const head = run[0] as HistoryEntry;
    const minutes = new Set(run.map((e) => minuteOf(Date.parse(e.watchedAt))));
    groups.push({
      key: `${head.type}:${head.historyId}`,
      entries: run,
      loggedTogether: run.length > 1 && minutes.size === 1,
    });
    run = [];
  };
  for (const entry of entries) {
    const prev = run[run.length - 1];
    if (prev !== undefined && !sameShowEpisodes(prev, entry)) flush();
    run.push(entry);
  }
  flush();
  return groups;
}

/**
 * Group a reverse-chronological history feed by the viewer's local day, newest
 * day first and newest play first within each day, and collapse consecutive
 * same-show episodes into one expandable card. Each day carries a play-count
 * rollup split by medium. Rows with an unparseable `watched_at` are dropped, never
 * mis-dated. `now` supplies the Today/Yesterday anchors.
 */
export function groupHistory(
  entries: readonly HistoryEntry[],
  options: GroupHistoryOptions,
): HistoryDay[] {
  const { now, timeZone } = options;
  const { keyOf: dayKeyOf, label: labelFor } = dayLabeler(timeZone, now, {
    delta: -1,
    label: "Yesterday",
  });

  const byDay = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const ms = toMs(entry.watchedAt);
    if (ms === null) continue;
    const key = dayKeyOf(ms);
    const list = byDay.get(key) ?? [];
    list.push(entry);
    byDay.set(key, list);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([dayKey, rows]) => {
      const ordered = [...rows].sort((a, b) => (toMs(b.watchedAt) ?? 0) - (toMs(a.watchedAt) ?? 0));
      return {
        dayKey,
        label: labelFor(dayKey, toMs(ordered[0]?.watchedAt ?? null) ?? now),
        episodeCount: ordered.filter((e) => e.type === "episode").length,
        movieCount: ordered.filter((e) => e.type === "movie").length,
        groups: groupDay(ordered),
      };
    });
}
