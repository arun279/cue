import { dayKeyFormatter, shiftDayKey } from "./day";
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
  const dayKeyOf = dayKeyFormatter(timeZone);
  const todayKey = dayKeyOf(now);
  const yesterdayKey = shiftDayKey(todayKey, -1);
  const labelFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
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
      const label =
        dayKey === todayKey
          ? "Today"
          : dayKey === yesterdayKey
            ? "Yesterday"
            : labelFmt.format(toMs(ordered[0]?.watchedAt ?? null) ?? now);
      return {
        dayKey,
        label,
        episodeCount: ordered.filter((e) => e.type === "episode").length,
        movieCount: ordered.filter((e) => e.type === "movie").length,
        groups: groupDay(ordered),
      };
    });
}
