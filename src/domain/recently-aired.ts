import type { CalendarEntry } from "./calendar";
import { compareEpisodeKeys, type LibraryShow } from "./model/library";
import { isAired } from "./time";

/**
 * Reconcile each show's cached progress with what the personal calendar says has
 * aired since that snapshot was taken. Trakt's per-user progress refreshes only
 * when the user writes history for the show, so a show finished last season still
 * reads `next_episode: null` after its new season lands. The calendar is the cheap
 * whole-library detector: every aired regular episode beyond the snapshot's
 * `lastAired` frontier raises `aired` and moves that frontier. It does not place
 * the queue; flagged shows resolve their position from the complete season tree.
 */
export function reconcileRecentlyAired<T extends LibraryShow>(
  shows: readonly T[],
  calendar: readonly CalendarEntry[],
  now: number,
): T[] {
  const airedByShow = new Map<number, CalendarEntry[]>();
  for (const entry of calendar) {
    if (entry.season === 0 || !isAired(entry.firstAired, now)) continue;
    const list = airedByShow.get(entry.showId) ?? [];
    list.push(entry);
    airedByShow.set(entry.showId, list);
  }

  return shows.map((show) => {
    const recent = airedByShow.get(show.showId);
    if (show.completed <= 0 || recent === undefined) return show;
    const frontier = show.lastAired;
    const unknown = recent
      .filter((entry) => frontier === null || compareEpisodeKeys(entry, frontier) > 0)
      .sort(compareEpisodeKeys);
    const last = unknown[unknown.length - 1];
    if (last === undefined) return show;
    return {
      ...show,
      aired: show.aired + unknown.length,
      lastAired: { season: last.season, number: last.number },
    };
  });
}

/**
 * Does this show have aired episodes the queue cannot place? Callers pair this
 * predicate with calendar reconciliation so unrelated gaps in a progress snapshot
 * do not trigger a season-tree read. A provisional post-mark projection
 * (`ids.trakt === 0`) is a next in flight, not a gap.
 */
export function needsNextEpisode(show: LibraryShow, now: number): boolean {
  const next = show.nextEpisode;
  return (
    show.completed > 0 &&
    show.aired > show.completed &&
    !(next !== null && (next.ids.trakt === 0 || isAired(next.firstAired, now)))
  );
}
